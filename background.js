'use strict';

const DEFAULTS = {
  ads: [], scrollCount: 0, history: [], competitors: [], competitorStats: {},
  settings: { autoScroll: true, speed: 'medium', maxAds: 100 },
  telegramStatus: { enabled: false, tokenConfigured: false, chatId: '' },
  filters: { mediaType: 'all', platform: 'all' }, scan: { running: false, reason: '' }
};
// Content scripts never need access to bot credentials.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
// Only public counters live in session storage; credentials stay in trusted local storage.
const sessionReady = chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
sessionReady.catch(() => {});

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
function progressStatus(scan) {
  return scan.running ? 'scanning' : ['limit','visible-complete','no-new-ads','meta-exhausted'].includes(scan.reason) ? 'completed' : scan.reason ? 'stopped' : 'ready';
}
async function publishProgress(state, override = null) {
  await sessionReady;
  const saved = await chrome.storage.session.get(['scanProgress','scanProgressRevision']);
  const previous = saved.scanProgress;
  const sameRunning = state.scan.running && previous?.sessionId === state.scan.sessionId;
  const progress = { ads: sameRunning ? Math.max(state.ads.length,previous.ads) : state.ads.length,
    scrolls: sameRunning ? Math.max(state.scrollCount,previous.scrolls) : state.scrollCount,
    reportedTotal:state.scan.discovery?.reportedTotal??state.scan.reportedTotal??null,versionEncounters:state.scan.discovery?.versionEncounters||0,recoveryRound:state.scan.running?(state.scan.discovery?.recoveryRound||0):0,reason:state.scan.reason, status: progressStatus(state.scan), ...override, sessionId: state.scan.sessionId || null,
    revision: (saved.scanProgressRevision || 0) + 1 };
  await chrome.storage.session.set({ scanProgress: progress, scanProgressRevision: progress.revision });
  void chrome.runtime.sendMessage({ type:'SCAN_PROGRESS', ...progress }).catch(() => {});
  return progress;
}
async function finish(state, reason, results = {}) {
  if (!state.scan.running) return;
  let ads = results.ads ?? state.ads;
  const {pendingScan,scanProgress}=await chrome.storage.session.get(['pendingScan','scanProgress']);
  if(pendingScan?.sessionId===state.scan.sessionId)ads=[...new Map([...ads,...pendingScan.ads].map(ad=>[ad.id,ad])).values()];
  const scrollCount = Math.max(results.scrollCount ?? state.scrollCount,scanProgress?.sessionId===state.scan.sessionId?scanProgress.scrolls:0);
  const scan = { ...state.scan, running: false, stopping: false, reason, updatedAt: Date.now() };
  const entry = { sessionId: scan.sessionId, createdAt: scan.startedAt, adCount: ads.length, scrollCount,
    reason, settings: state.settings, sourceUrl: scan.sourceUrl, ads };
  const telegram = await chrome.storage.local.get(['telegramConfig', 'telegramOutbox']);
  const enabled = telegram.telegramConfig?.enabled;
  const canQueue = enabled && (telegram.telegramOutbox || []).length < 50;
  entry.telegram = enabled ? (canQueue ? 'queued' : 'queue-full') : 'disabled';
  const history = archiveHistory([entry, ...state.history].slice(0, 100));
  const outbox = canQueue ? [...(telegram.telegramOutbox || []), makeNotification(entry)].slice(-50) : (telegram.telegramOutbox || []);
  const competitorStats = { ...state.competitorStats };
  let query = '';
  try { query = new URL(scan.sourceUrl).searchParams.get('q')?.trim().toLocaleLowerCase('tr-TR') || ''; } catch {}
  for (const name of state.competitors) {
    const normalized = name.toLocaleLowerCase('tr-TR');
    const matching = ads.filter((ad) => query === normalized || ad.advertiser?.trim().toLocaleLowerCase('tr-TR') === normalized);
    if (!matching.length && query !== normalized) continue;
    const previous = new Set(competitorStats[name]?.ids || []);
    const ids = matching.map((ad) => ad.id);
    competitorStats[name] = { ids, count: ids.length, newCount: ids.filter((id) => !previous.has(id)).length, updatedAt: Date.now() };
  }
  try {
    await chrome.storage.local.set({ ads, scrollCount, scan, history, telegramOutbox: outbox, competitorStats });
    await publishProgress({ ...state, ads, scrollCount, scan });
    await chrome.storage.session.set({pendingScan:null});
    if (canQueue) { scheduleDelivery(); }
  } catch (error) {
    // If even the history entry exceeds quota, release ownership without rewriting results.
    await chrome.storage.local.set({ scan: { running: false, reason: 'storage-error' } });
    await publishProgress({ ...state, scan: { running:false, reason:'storage-error' } });
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
function sanitizeDiscovery(value) {
  if (!value || !Number.isInteger(value.candidates) || !Number.isInteger(value.matched)) return null;
  return { candidates: Math.max(0, value.candidates), matched: Math.max(0, value.matched), version: String(value.version || '').slice(0, 20), reportedTotal:Number.isSafeInteger(value.reportedTotal)?value.reportedTotal:null, versionEncounters:Number.isSafeInteger(value.versionEncounters)?value.versionEncounters:0,recoveryRound:Number.isInteger(value.recoveryRound)?value.recoveryRound:0, libraryCodeTexts: Math.max(0, Number.isInteger(value.libraryCodeTexts) ? value.libraryCodeTexts : 0) };
}
async function handle(message, sender) {
  const state = await readState();
  const type = message?.type;
  // Content scripts can only report results for their own active session.
  if (sender.tab) {
    if (!['META_SCAN_PROGRESS', 'META_SCAN_FINISHED', 'SCAN_PROGRESS'].includes(type) || sender.frameId !== 0 ||
        !isLibrary(sender.url) || !state.scan.running || sender.tab.id !== state.scan.tabId ||
        message.sessionId !== state.scan.sessionId) throw new Error('Tarama oturumu artık etkin değil.');
    if (type === 'SCAN_PROGRESS') {
      const { scanProgress } = await chrome.storage.session.get('scanProgress');
      if (!Number.isInteger(message.ads) || message.ads < state.ads.length || message.ads > state.settings.maxAds ||
          !Number.isInteger(message.scrolls) || message.scrolls < state.scrollCount ||
          (scanProgress?.sessionId === state.scan.sessionId && (message.ads < scanProgress.ads || message.scrolls < scanProgress.scrolls)) ||
          !['scanning','stopped','completed'].includes(message.status)) throw new Error('Geçersiz canlı sayaç.');
      if(message.record){
        if(typeof message.record.id!=='string'||!/^\d{10,}$/.test(message.record.id))throw new Error('Geçersiz reklam kaydı.');
        const {pendingScan}=await chrome.storage.session.get('pendingScan');
        const records=pendingScan?.sessionId===state.scan.sessionId?pendingScan.ads:[];
        await chrome.storage.session.set({pendingScan:{sessionId:state.scan.sessionId,ads:[...new Map([...records,message.record].map(ad=>[ad.id,ad])).values()]}});
      }
      return { ok:true, progress:await publishProgress(state,{ads:message.ads,scrolls:message.scrolls,status:message.status,reportedTotal:Number.isSafeInteger(message.reportedTotal)?message.reportedTotal:null,versionEncounters:Number.isSafeInteger(message.versionEncounters)?message.versionEncounters:0,recoveryRound:Number.isInteger(message.recoveryRound)?message.recoveryRound:0}) };
    }
    const results = validateResults(message, state);
    try {
      if (type === 'META_SCAN_FINISHED') {
        const reasons = ['stopped', 'limit', 'visible-complete', 'no-new-ads', 'no-cards', 'meta-exhausted', 'page-changed', 'error'];
        await finish({...state,scan:{...state.scan,discovery:sanitizeDiscovery(message.discovery)}}, reasons.includes(message.reason) ? message.reason : 'error', results);
      } else {
        await chrome.storage.local.set({ ...results, scan: { ...state.scan, updatedAt: Date.now(), discovery: sanitizeDiscovery(message.discovery) } });
        await chrome.storage.session.set({pendingScan:null});
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
    case 'GET_STATE': { const current = await reconcile(); await publishProgress(current); return { ok:true, state:current }; }
    case 'START_SCAN':
    case 'RESUME_SCAN': {
      const current = await reconcile();
      if (current.scan.running) throw new Error('Önce çalışan taramayı durdur.');
      const settings = validateSettings(message.settings || current.settings);
      const resuming = type === 'RESUME_SCAN';
      if(resuming && !current.ads.length)throw new Error('Devam edilecek kayıt yok.');
      if(resuming && settings.maxAds<=current.ads.length)throw new Error('Devam etmek için maksimum reklam sayısını artır.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!Number.isInteger(tab?.id) || !isLibrary(tab.url)) throw new Error('Önce Meta Reklam Kütüphanesi sekmesini aç.');
      let collector;
      try { collector = await chrome.tabs.sendMessage(tab.id, { type: 'META_SCAN_STATUS' }, { frameId: 0 }); }
      catch {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['ad-data.js','scan-loop.js','content.js'] });
        collector = await chrome.tabs.sendMessage(tab.id, { type: 'META_SCAN_STATUS' }, { frameId: 0 });
      }
      if (collector?.version !== '0.8.0') throw new Error('Meta sekmesinde eski tarama kodu çalışıyor. Sayfayı yenile; panelde v0.8.0 görünmelidir.');
      const scan = { running: true, stopping: false, tabId: tab.id, sessionId: crypto.randomUUID(),
        sourceUrl: tab.url, startedAt: Date.now(), updatedAt: Date.now(), reason: 'running' };
      // Save ownership before starting; queued progress cannot overtake this write.
      await chrome.storage.session.set({pendingScan:null});
      const initialAds=resuming?current.ads:[], initialScrolls=resuming?current.scrollCount:0;
      scan.reportedTotal=resuming?current.scan.reportedTotal??current.scan.discovery?.reportedTotal??null:null;
      await chrome.storage.local.set({ ads:initialAds, scrollCount:initialScrolls, settings, scan });
      await publishProgress({ ...current, ads:initialAds, scrollCount:initialScrolls, scan },{ ads:initialAds.length, scrolls:initialScrolls });
      try {
        const startMessage = { type: 'META_SCAN_START', settings, tabId: tab.id, sessionId: scan.sessionId, resumeAds:initialAds, resumeScrolls:initialScrolls, resumeVersionEncounters:resuming?current.scan.discovery?.versionEncounters||0:0,resumeReportedTotal:scan.reportedTotal };
        let response;
        try { response = await chrome.tabs.sendMessage(tab.id, startMessage, { frameId: 0 }); }
        catch {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['ad-data.js','scan-loop.js','content.js'] });
          response = await chrome.tabs.sendMessage(tab.id, startMessage, { frameId: 0 });
        }
        if (!response?.ok) throw new Error(response?.error || 'Tarama başlatılamadı.');
      } catch (error) {
        // A failed start must not erase the previous exported results.
        await chrome.storage.local.set({ ads: current.ads, scrollCount: current.scrollCount,
          scan: { ...scan, running: false, reason: 'start-error' } });
        await publishProgress({ ...current, scan: { ...scan, running:false, reason:'start-error' } });
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
      await publishProgress({ ...state, ads:[], scrollCount:0, scan:{running:false,reason:''} });
      break;
    case 'CLEAR_HISTORY': await chrome.storage.local.set({ history: [], telegramOutbox: [] }); break;
    case 'SAVE_TELEGRAM': {
      const { telegramConfig: old = {} } = await chrome.storage.local.get('telegramConfig');
      const token = typeof message.token === 'string' && message.token.trim() ? message.token.trim() : old.token || '';
      const chatId = typeof message.chatId === 'string' ? message.chatId.trim() : '';
      if (typeof message.enabled !== 'boolean' || (token && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) ||
          (chatId && !/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,})$/.test(chatId)) || (message.enabled && (!token || !chatId))) {
        throw new Error('Geçerli Telegram Bot Token ve Chat ID gir.');
      }
      await chrome.storage.local.set({ telegramConfig: { token, chatId, enabled: message.enabled },
        telegramStatus: { enabled: message.enabled, tokenConfigured: Boolean(token), chatId } });
      break;
    }
    case 'REMOVE_TELEGRAM':
      await chrome.storage.local.set({ telegramConfig: {}, telegramStatus: DEFAULTS.telegramStatus, telegramOutbox: [] });
      break;
    case 'TEST_TELEGRAM': {
      const { telegramConfig: config } = await chrome.storage.local.get('telegramConfig');
      await sendTelegram(config, 'Meta Reklam Botu: Telegram bağlantısı başarılı.');
      break;
    }
    case 'SEND_SUMMARY': {
      const entry = state.history.find((item) => item.sessionId === message.sessionId);
      if (!entry) throw new Error('Geçmiş oturumu bulunamadı.');
      const { telegramConfig: config, telegramOutbox = [] } = await chrome.storage.local.get(['telegramConfig', 'telegramOutbox']);
      if (!config?.enabled || !config.token || !config.chatId) throw new Error('Önce Telegram bildirimlerini kaydet ve etkinleştir.');
      if (telegramOutbox.length >= 50) throw new Error('Telegram kuyruğu dolu. Önce bekleyen gönderimleri tamamla.');
      if (telegramOutbox.some((job) => job.sessionId === entry.sessionId)) throw new Error('Bu rapor zaten gönderim sırasında.');
      await chrome.storage.local.set({ telegramOutbox: [...telegramOutbox, makeNotification(entry)].slice(-50) });
      scheduleDelivery();
      break;
    }
    case 'ADD_COMPETITOR': {
      const name = typeof message.name === 'string' ? message.name.trim() : '';
      if (!name || name.length > 100) throw new Error('1–100 karakter uzunluğunda bir marka adı gir.');
      if (state.competitors.some((item) => item.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'))) throw new Error('Bu marka zaten listende.');
      if (state.competitors.length >= 500) throw new Error('En fazla 500 marka saklanabilir.');
      await chrome.storage.local.set({ competitors: [...state.competitors, name] });
      break;
    }
    case 'REMOVE_COMPETITOR': {
      const competitorStats = { ...state.competitorStats }; delete competitorStats[message.name];
      await chrome.storage.local.set({ competitors: state.competitors.filter((name) => name !== message.name), competitorStats }); break;
    }
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
  if (sender.id !== chrome.runtime.id || (message?.type === 'SCAN_PROGRESS' && !sender.tab)) return;
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


// Keep detailed archives within a conservative budget; preserve older summaries.
function archiveHistory(history) {
  let budget = 3 * 1024 * 1024;
  return history.map((entry) => {
    if (!Array.isArray(entry.ads)) return entry;
    const bytes = JSON.stringify(entry.ads).length * 2;
    if (bytes <= budget) { budget -= bytes; return entry; }
    const { ads, ...summary } = entry;
    return { ...summary, archiveExpired: true };
  });
}
function makeNotification(entry) {
  return { id: crypto.randomUUID(), sessionId: entry.sessionId, attempts: 0, nextAttempt: Date.now(),
    text: `Meta Reklam Botu — Tarama raporu\nReklam: ${entry.adCount}\nScroll: ${entry.scrollCount}\nDurum: ${entry.reason}\n${entry.sourceUrl || ''}`.slice(0, 4000) };
}
async function sendTelegram(config, text) {
  if (!config?.token || !config.chatId) throw new Error('Önce Telegram Bot Token ve Chat ID kaydet.');
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(10000), redirect: 'error', credentials: 'omit'
    });
  } catch {
    const error = new Error('Telegram ağına ulaşılamadı. Bağlantıyı kontrol et.');
    error.retryable = true; throw error;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    // Never include Telegram's raw response or request URL: both can reveal credentials.
    const error = new Error(response.status === 429 ? 'Telegram hız sınırına ulaşıldı.' : 'Telegram gönderimi reddetti. Token, Chat ID ve bot erişimini kontrol et.');
    error.retryable = response.status === 429 || response.status >= 500;
    error.retryAfter = Math.min(3600, Math.max(60, Number(result.parameters?.retry_after) || 60));
    throw error;
  }
}
let delivering = false;
function scheduleDelivery() {
  chrome.alarms.create('telegram-delivery', { delayInMinutes: 1 }).catch(() => {});
  // Schedule outside the mutation queue; a slow network must not block scanning.
  void deliverNotifications().catch(() => {});
}
async function deliverNotifications() {
  if (delivering) return;
  delivering = true;
  try {
    while (true) {
      const job = await enqueue(async () => {
        const { telegramOutbox = [], telegramConfig } = await chrome.storage.local.get(['telegramOutbox', 'telegramConfig']);
        if (!telegramConfig?.enabled) return null;
        const next = telegramOutbox.find((item) => item.nextAttempt <= Date.now());
        if (!next) return null;
        // Lease survives worker suspension. Telegram sendMessage has no idempotency key.
        next.nextAttempt = Date.now() + 60000;
        await chrome.storage.local.set({ telegramOutbox });
        return { ...next, config: telegramConfig };
      });
      if (!job) break;
      let failure;
      try { await sendTelegram(job.config, job.text); } catch (error) { failure = error; }
      await enqueue(async () => {
        const { telegramOutbox = [], history = [] } = await chrome.storage.local.get(['telegramOutbox', 'history']);
        const pending = telegramOutbox.find((item) => item.id === job.id);
        if (!pending) return;
        const retry = failure?.retryable && pending.attempts < 2;
        pending.attempts++;
        pending.nextAttempt = Date.now() + (failure?.retryAfter || 60 * pending.attempts) * 1000;
        const status = retry ? 'retrying' : failure ? 'failed' : 'sent';
        await chrome.storage.local.set({ telegramOutbox: retry ? telegramOutbox : telegramOutbox.filter((item) => item.id !== job.id),
          history: history.map((entry) => entry.sessionId === job.sessionId ? { ...entry, telegram: status } : entry) });
      });
    }
  } finally {
    delivering = false;
    const { telegramOutbox = [] } = await chrome.storage.local.get('telegramOutbox');
    if (telegramOutbox.length) await chrome.alarms.create('telegram-delivery', { delayInMinutes: 1 });
  }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'telegram-delivery') void deliverNotifications().catch(() => {});
});
chrome.runtime.onStartup.addListener(scheduleDelivery);
chrome.runtime.onInstalled.addListener(scheduleDelivery);
