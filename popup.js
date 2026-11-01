'use strict';

const $ = (selector) => document.querySelector(selector);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const feedback = (message) => { $('#feedback').textContent = message; };
let running = false;
let ready = false;
let busy = false;
let refreshQueue = Promise.resolve();
let state = { telegramStatus: { enabled: false, tokenConfigured: false, chatId: '' }, ads: [], scrollCount: 0, settings: { autoScroll: true, speed: 'medium', maxAds: 100 }, history: [], competitors: [], competitorStats: {}, filters: { mediaType: 'all', platform: 'all' } };

function activateTab(tab) {
  tabs.forEach((item) => {
    const active = item === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  });
  feedback('');
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    activateTab(tabs[next]);
    tabs[next].focus();
  });
});

function render() {
  renderScan();
  $('#history-list').replaceChildren();
  state.history.forEach((entry) => {
    const li = document.createElement('li');
    const text = document.createElement('div');
    text.textContent = entry.query || 'Tarama oturumu';
    const detail = document.createElement('small');
    detail.textContent = `${entry.adCount ?? 0} reklam · ${new Date(entry.createdAt).toLocaleString('tr-TR')}`;
    text.append(detail);
    const archive = Array.isArray(entry.ads);
    const status = document.createElement('small');
    const telegramLabels = { queued: 'Telegram sırada', retrying: 'Telegram yeniden denenecek', sent: 'Telegram gönderildi', failed: 'Telegram gönderilemedi', disabled: 'Telegram kapalı', 'queue-full': 'Telegram kuyruğu dolu' };
    status.textContent = `${archive ? 'Veriler arşivlendi' : 'Yalnızca özet (arşiv yok)'} · ${telegramLabels[entry.telegram] || ''}`;
    text.append(status);
    const actions = document.createElement('div');
    actions.className = 'history-actions';
    for (const format of ['csv', 'json']) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'remove'; button.textContent = format.toUpperCase();
      button.disabled = !archive || !entry.ads.length;
      button.setAttribute('aria-label', `${new Date(entry.createdAt).toLocaleString('tr-TR')} oturumunu ${format.toUpperCase()} indir`);
      button.addEventListener('click', () => downloadRecords(entry.ads, format, `oturum-${entry.sessionId || entry.createdAt}`));
      actions.append(button);
    }
    const summary = document.createElement('button');
    summary.type = 'button'; summary.className = 'remove'; summary.textContent = 'Telegram özeti';
    summary.disabled = !state.telegramStatus.enabled || !entry.sessionId;
    summary.addEventListener('click', () => perform(summary, async () => {
      await command('SEND_SUMMARY', { sessionId: entry.sessionId });
      feedback('Özet Telegram gönderim sırasına alındı.');
    }));
    actions.append(summary);
    li.className = 'history-item';
    li.append(text, actions);
    $('#history-list').append(li);
  });
  $('#history-empty').hidden = state.history.length > 0;
  $('#clear-history').hidden = state.history.length === 0;
  for (const id of ['history-csv', 'history-json']) document.getElementById(id).disabled = !ready || !state.history.some((entry) => entry.ads?.length);
  $('#competitor-list').replaceChildren();
  state.competitors.forEach((name) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = name;
    const stats = state.competitorStats[name];
    const detail = document.createElement('small');
    detail.textContent = stats ? `${stats.count} reklam · ${stats.newCount} yeni · ${new Date(stats.updatedAt).toLocaleDateString('tr-TR')}` : 'Henüz taranmadı';
    label.append(detail);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = 'Kaldır';
    remove.setAttribute('aria-label', `${name} markasını kaldır`);
    remove.addEventListener('click', () => perform(remove, async () => {
      await command('REMOVE_COMPETITOR', { name });
      await refreshState();
      feedback('Marka listeden kaldırıldı.');
    }));
    const link = document.createElement('a');
    link.textContent = 'Reklamları aç';
    link.href = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${encodeURIComponent(name)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    li.append(label, link, remove);
    $('#competitor-list').append(li);
  });
  $('#competitors-empty').hidden = state.competitors.length > 0;
}

async function command(type, payload = {}) {
  let response;
  try { response = await chrome.runtime.sendMessage({ type, ...payload }); }
  catch { throw new Error('Eklenti bağlantısı kurulamadı. Eklentiyi yeniden yükle.'); }
  if (!response?.ok) throw new Error(response?.error || 'İşlem tamamlanamadı.');
  return response;
}
async function perform(button, operation) {
  if (!ready || busy) return;
  busy = true;
  button.disabled = true;
  renderScan();
  try { await operation(); }
  catch (error) { feedback(error.message || 'İşlem tamamlanamadı.'); }
  finally { busy = false; if (button.isConnected) button.disabled = false; renderScan(); }
}

function filteredAds() {
  return state.ads.filter((ad) => {
    const media = state.filters.mediaType;
    const mediaMatch = media === 'all' || (media === 'video' ? (ad.mediaType === 'video' || ad.videos?.length > 0) : (ad.mediaType === 'image' || ad.images?.length > 0) && ad.mediaType !== 'video' && !ad.videos?.length);
    return mediaMatch && (state.filters.platform === 'all' || ad.platforms?.includes(state.filters.platform));
  });
}

function renderScan() {
  $('#scan-status').textContent = !ready ? 'Yükleniyor…' : state.scan?.stopping ? 'Durduruluyor…' : running ? 'Çalışıyor…' : 'Hazır';
  $('#scan-status').classList.toggle('running', running);
  $('#export-summary').textContent = `${filteredAds().length} / ${state.ads.length} reklam dışa aktarılacak`;
  $('#ad-count').textContent = state.ads.length;
  $('#scroll-count').textContent = state.scrollCount;
  $('#start-scan').disabled = !ready || busy || running;
  $('#stop-scan').disabled = !ready || busy || !running || Boolean(state.scan?.stopping);
  $('#auto-scroll').disabled = !ready || busy || running;
  $('#scroll-speed').disabled = !ready || busy || running || !$('#auto-scroll').checked;
  $('#max-ads').disabled = !ready || busy || running;
  $('#clear-results').disabled = !ready || busy || running;
  $('#export-csv').disabled = !ready || busy || running || filteredAds().length === 0;
  $('#export-json').disabled = !ready || busy || running || filteredAds().length === 0;
}

$('#auto-scroll').addEventListener('change', renderScan);
$('#scan-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const maxAds = Number($('#max-ads').value);
  if (!Number.isInteger(maxAds) || maxAds < 1 || maxAds > 10000) {
    feedback('Maksimum reklam sayısı 1–10000 arasında bir tam sayı olmalı.'); return;
  }
  perform(event.submitter, async () => {
    const settings = { autoScroll: $('#auto-scroll').checked, speed: $('#scroll-speed').value, maxAds };
    await command('START_SCAN', { settings });
    state.settings = settings;
    await refreshState();
    feedback('Tarama başlatıldı. Açık Meta sayfasında devam eder.');
  }).then(renderScan);
});

$('#stop-scan').addEventListener('click', (event) => perform(event.currentTarget, async () => {
  await command('STOP_SCAN');
  await refreshState();
}).then(renderScan));

$('#clear-results').addEventListener('click', (event) => perform(event.currentTarget, async () => {
  await command('CLEAR_RESULTS');
  await refreshState();
  feedback('Tarama sonuçları temizlendi.');
}).then(renderScan));

function csvCell(value) {
  let text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  // Prevent spreadsheet formula execution when opening exported untrusted ad text.
  if (/^(?:\s*[=+\-@]|[\t\r\n])/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function exportAds(format) {
  if (!ready || busy || running) return;
  const ads = filteredAds();
  if (!ads.length) { feedback('Seçili filtrelere uygun sonuç yok.'); return; }
  downloadRecords(ads, format, 'meta-reklamlar');
}

function downloadRecords(ads, format, name) {
  if (!ready || !ads.length) { feedback('İndirilecek arşiv verisi bulunamadı.'); return; }
  let content = JSON.stringify(ads, null, 2);
  if (format === 'csv') {
    const columns = [...new Set(ads.flatMap((ad) => Object.keys(ad)))];
    content = '\uFEFF' + [columns.map(csvCell).join(','),
      ...ads.map((ad) => columns.map((key) => csvCell(ad[key])).join(','))].join('\r\n');
  }
  const blob = new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${Date.now()}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  feedback(`${format.toUpperCase()} dosyası hazırlandı.`);
}
$('#export-csv').addEventListener('click', () => exportAds('csv'));
$('#export-json').addEventListener('click', () => exportAds('json'));
for (const format of ['csv', 'json']) document.getElementById(`history-${format}`).addEventListener('click', () => {
  const records = state.history.flatMap((entry) => (entry.ads || []).map((ad) => ({ sessionId: entry.sessionId, sessionDate: new Date(entry.createdAt).toISOString(), ...ad })));
  downloadRecords(records, format, 'meta-gecmis');
});
$('#telegram-form').addEventListener('submit', (event) => {
  event.preventDefault();
  perform(event.submitter, async () => {
    await command('SAVE_TELEGRAM', { token: $('#telegram-token').value, chatId: $('#telegram-chat-id').value, enabled: $('#telegram-enabled').checked });
    $('#telegram-token').value = '';
    await refreshState();
    populateTelegram();
    feedback('Telegram ayarları kaydedildi. Test mesajıyla bağlantını kontrol edebilirsin.');
  });
});
$('#telegram-test').addEventListener('click', (event) => perform(event.currentTarget, async () => {
  await command('TEST_TELEGRAM'); feedback('Telegram test mesajı gönderildi.');
}));
$('#telegram-remove').addEventListener('click', (event) => perform(event.currentTarget, async () => {
  await command('REMOVE_TELEGRAM'); await refreshState(); populateTelegram(); $('#telegram-token').value = ''; feedback('Telegram bilgileri silindi.');
}));
function populateTelegram() {
  $('#telegram-enabled').checked = state.telegramStatus.enabled;
  $('#telegram-chat-id').value = state.telegramStatus.chatId;
  $('#token-status').textContent = state.telegramStatus.tokenConfigured ? 'Token kayıtlı. Değiştirmek için yenisini gir; boş bırakırsan korunur.' : 'Token henüz kaydedilmedi.';
}


$('#clear-history').addEventListener('click', (event) => perform(event.currentTarget, async () => {
  await command('CLEAR_HISTORY');
  await refreshState();
  feedback('Arama geçmişi temizlendi.');
}));

$('#competitor-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#competitor-name').value.trim();
  if (!name) { feedback('Bir marka adı gir.'); return; }
  if (state.competitors.some((item) => item.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'))) {
    feedback('Bu marka zaten listende.'); return;
  }
  perform(event.submitter, async () => {
    await command('ADD_COMPETITOR', { name });
    await refreshState();
    $('#competitor-name').value = '';
    render();
    feedback('Marka takip listesine eklendi.');
  });
});

$('#filters-form').addEventListener('submit', (event) => {
  event.preventDefault();
  perform(event.submitter, async () => {
    const filters = { mediaType: $('#media-type').value, platform: $('#platform').value };
    await command('SAVE_FILTERS', { filters });
    await refreshState();
    feedback('Filtre tercihlerin kaydedildi.');
  });
});

const REASONS = {
  limit: 'Maksimum reklam sayısına ulaşıldı.', 'visible-complete': 'Görünür reklamlar toplandı.',
  'no-new-ads': 'Yeni reklam bulunamadı. Sayfa yüklemesini ve dilini kontrol et.',
  'page-changed': 'Sayfa değiştiği için tarama durdu.', error: 'Tarama sırasında hata oluştu.',
  'storage-error': 'Sonuçlar kaydedilemedi. Depolama alanını kontrol et.', stopped: 'Tarama durduruldu.',
  disconnected: 'Tarama sekmesi kapandı, yenilendi veya bağlantısı kesildi.', 'start-error': 'Tarama başlatılamadı. Meta sekmesini yenile.'
};
function refreshState(reconcile = false) {
  const refresh = async () => {
  const saved = reconcile ? (await command('GET_STATE')).state : await chrome.storage.local.get(Object.keys(state).concat('scan'));
  const oldScan = state.scan;
  state = { ...state, ...saved };
  running = Boolean(state.scan?.running);
  render();
  if (!running && state.scan?.reason && (oldScan?.running || oldScan?.reason !== state.scan.reason)) feedback(REASONS[state.scan.reason] || '');
  };
  refreshQueue = refreshQueue.then(refresh, refresh);
  return refreshQueue;
}
async function init() {
  const buttons = [...document.querySelectorAll('button:not([role="tab"])')];
  buttons.forEach((button) => { button.disabled = true; });
  renderScan();
  try {
    await refreshState(true);
    populateTelegram();
    $('#media-type').value = state.filters.mediaType;
    $('#platform').value = state.filters.platform;
    $('#auto-scroll').checked = state.settings.autoScroll;
    $('#scroll-speed').value = state.settings.speed;
    $('#max-ads').value = state.settings.maxAds;
    ready = true;
    buttons.forEach((button) => { button.disabled = false; });
    render();
  } catch (error) { feedback(error.message); }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ['ads', 'scrollCount', 'scan', 'history', 'competitors', 'competitorStats', 'filters', 'telegramStatus'].some((key) => key in changes)) {
    refreshState().catch(() => feedback('Tarama durumu okunamadı.'));
  }
});
init();
