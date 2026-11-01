'use strict';

const DEFAULTS = {
  ads: [], scrollCount: 0, history: [], competitors: [],
  settings: { autoScroll: true, speed: 'medium', maxAds: 100 },
  filters: { mediaType: 'all', platform: 'all' }, scan: { running: false, reason: '' }
};
// Serialize mutations, including tab events, to keep one scan and avoid lost writes.
// Durable state lives in storage, so worker suspension does not lose ownership.
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
async function readState() {
  const saved = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...saved };
}
function isLibrary(value) {
  try { const url = new URL(value); return url.origin === 'https://www.facebook.com' && /^\/ads\/library\/?$/.test(url.pathname); }
  catch { return false; }
}
function validateSettings(settings) {
  if (!settings || typeof settings.autoScroll !== 'boolean' || !['slow', 'medium', 'fast'].includes(settings.speed) ||
      !Number.isInteger(settings.maxAds) || settings.maxAds < 1 || settings.maxAds > 10000) {
    throw new Error('Tarama ayarları geçersiz.');
  }
  return { autoScroll: settings.autoScroll, speed: settings.speed, maxAds: settings.maxAds };
}
async function finish(state, reason, results = {}) {
  if (!state.scan.running) return;
  const ads = results.ads ?? state.ads;
  const scrollCount = results.scrollCount ?? state.scrollCount;
  const scan = { ...state.scan, running: false, stopping: false, reason, updatedAt: Date.now() };
  const entry = { sessionId: scan.sessionId, createdAt: scan.startedAt, adCount: ads.length, scrollCount,
    reason, settings: state.settings, sourceUrl: scan.sourceUrl };
  try {
    await chrome.storage.local.set({ ads, scrollCount, scan, history: [entry, ...state.history].slice(0, 100) });
  } catch (error) {
    // If even the history entry exceeds quota, release ownership without rewriting results.
    await chrome.storage.local.set({ scan: { running: false, reason: 'storage-error' } });
    throw error;
  }
}
async function reconcile() {
  let state = await readState();
  if (state.scan.running) {
    let status;
    try { status = await chrome.tabs.sendMessage(state.scan.tabId, { type: 'META_SCAN_STATUS' }, { frameId: 0 }); }
    catch { /* Tab closed, navigated, or extension reloaded. */ }
    if (!status?.running || status.sessionId !== state.scan.sessionId) {
      await finish(state, 'disconnected');
      state = await readState();
    }
  }
  return state;
}
function validateResults(message, state) {
  if (!Array.isArray(message.ads) || message.ads.length > state.settings.maxAds ||
      !Number.isInteger(message.scrollCount) || message.scrollCount < state.scrollCount ||
      message.ads.some((ad) => !ad || typeof ad.id !== 'string') ||
      new Set(message.ads.map((ad) => ad.id)).size !== message.ads.length) throw new Error('Geçersiz tarama verisi.');
  return { ads: message.ads, scrollCount: message.scrollCount };
}
async function handle(message, sender) {
  const state = await readState();
  const type = message?.type;
  // Content scripts can only report results for their own active session.
  if (sender.tab) {
    if (!['META_SCAN_PROGRESS', 'META_SCAN_FINISHED'].includes(type) || sender.frameId !== 0 ||
        !isLibrary(sender.url) || !state.scan.running || sender.tab.id !== state.scan.tabId ||
        message.sessionId !== state.scan.sessionId) throw new Error('Tarama oturumu artık etkin değil.');
    const results = validateResults(message, state);
    try {
      if (type === 'META_SCAN_FINISHED') {
        const reasons = ['stopped', 'limit', 'visible-complete', 'no-new-ads', 'page-changed', 'error'];
        await finish(state, reasons.includes(message.reason) ? message.reason : 'error', results);
      } else {
        await chrome.storage.local.set({ ...results, scan: { ...state.scan, updatedAt: Date.now() } });
      }
    } catch (error) {
      // Preserve last successfully saved results if the latest batch exceeds quota.
      await finish(state, 'storage-error');
      throw new Error('Sonuçlar kaydedilemedi. Depolama alanını kontrol et.');
    }
    return { ok: true };
  }
  if (sender.url !== chrome.runtime.getURL('popup.html')) throw new Error('Bilinmeyen mesaj kaynağı.');
  switch (type) {
    case 'GET_STATE': return { ok: true, state: await reconcile() };
    case 'START_SCAN': {
      const current = await reconcile();
      if (current.scan.running) throw new Error('Önce çalışan taramayı durdur.');
      const settings = validateSettings(message.settings);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!Number.isInteger(tab?.id) || !isLibrary(tab.url)) throw new Error('Önce Meta Reklam Kütüphanesi sekmesini aç.');
      const scan = { running: true, stopping: false, tabId: tab.id, sessionId: crypto.randomUUID(),
        sourceUrl: tab.url, startedAt: Date.now(), updatedAt: Date.now(), reason: 'running' };
      // Save ownership before starting; queued progress cannot overtake this write.
      await chrome.storage.local.set({ ads: [], scrollCount: 0, settings, scan });
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'META_SCAN_START', settings, tabId: tab.id,
          sessionId: scan.sessionId }, { frameId: 0 });
        if (!response?.ok) throw new Error(response?.error || 'Tarama başlatılamadı.');
      } catch (error) {
        // A failed start must not erase the previous exported results.
        await chrome.storage.local.set({ ads: current.ads, scrollCount: current.scrollCount,
          scan: { ...scan, running: false, reason: 'start-error' } });
        throw new Error(`${error.message} Meta sekmesini yenileyip tekrar dene.`);
      }
      return { ok: true };
    }
    case 'STOP_SCAN': {
      if (state.scan.running) {
        try {
          const response = await chrome.tabs.sendMessage(state.scan.tabId, { type: 'META_SCAN_STOP', sessionId: state.scan.sessionId }, { frameId: 0 });
          if (!response?.ok) throw new Error('Tarama bağlantısı kapandı.');
          await chrome.storage.local.set({ scan: { ...state.scan, stopping: true } });
        } catch { await finish(state, 'disconnected'); }
      }
      return { ok: true };
    }
    case 'CLEAR_RESULTS':
      if ((await reconcile()).scan.running) throw new Error('Önce taramayı durdur.');
      await chrome.storage.local.set({ ads: [], scrollCount: 0, scan: { running: false, reason: '' } });
      break;
    case 'CLEAR_HISTORY': await chrome.storage.local.set({ history: [] }); break;
    case 'ADD_COMPETITOR': {
      const name = typeof message.name === 'string' ? message.name.trim() : '';
      if (!name || name.length > 100) throw new Error('1–100 karakter uzunluğunda bir marka adı gir.');
      if (state.competitors.some((item) => item.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'))) throw new Error('Bu marka zaten listende.');
      if (state.competitors.length >= 500) throw new Error('En fazla 500 marka saklanabilir.');
      await chrome.storage.local.set({ competitors: [...state.competitors, name] });
      break;
    }
    case 'REMOVE_COMPETITOR': await chrome.storage.local.set({ competitors: state.competitors.filter((name) => name !== message.name) }); break;
    case 'SAVE_FILTERS':
      if (!message.filters || !['all', 'image', 'video'].includes(message.filters.mediaType) ||
          !['all', 'facebook', 'instagram'].includes(message.filters.platform)) throw new Error('Geçersiz filtre.');
      await chrome.storage.local.set({ filters: { mediaType: message.filters.mediaType, platform: message.filters.platform } });
      break;
    default: throw new Error('Bilinmeyen komut.');
  }
  return { ok: true };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  enqueue(() => handle(message, sender)).then(respond, (error) => respond({ ok: false, error: error.message }));
  return true;
});
function tabGone(tabId) {
  void enqueue(async () => { const state = await readState(); if (state.scan.running && state.scan.tabId === tabId) await finish(state, 'disconnected'); }).catch(console.warn);
}
chrome.tabs.onRemoved.addListener(tabGone);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') tabGone(tabId);
  else if (change.url) void enqueue(async () => {
    const state = await readState();
    if (state.scan.running && state.scan.tabId === tabId && change.url !== state.scan.sourceUrl) {
      await chrome.tabs.sendMessage(tabId, { type: 'META_SCAN_STOP', sessionId: state.scan.sessionId }, { frameId: 0 }).catch(() => {});
      await finish(state, 'page-changed');
    }
  }).catch(console.warn);
});
chrome.runtime.onStartup.addListener(() => { void enqueue(reconcile).catch(console.warn); });
chrome.runtime.onInstalled.addListener(() => { void enqueue(async () => {
  const saved = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const missing = Object.fromEntries(Object.entries(DEFAULTS).filter(([key]) => saved[key] === undefined));
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
  await reconcile();
}).catch(console.warn); });
