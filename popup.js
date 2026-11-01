'use strict';

const $ = (selector) => document.querySelector(selector);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const feedback = (message) => { $('#feedback').textContent = message; };
let running = false;
let ready = false;
let busy = false;
let refreshVersion = 0;
let state = { ads: [], scrollCount: 0, settings: { autoScroll: true, speed: 'medium', maxAds: 100 }, history: [], competitors: [], filters: { mediaType: 'all', platform: 'all' } };

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
    li.append(text);
    $('#history-list').append(li);
  });
  $('#history-empty').hidden = state.history.length > 0;
  $('#clear-history').hidden = state.history.length === 0;
  $('#competitor-list').replaceChildren();
  state.competitors.forEach((name) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = name;
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
    const mediaMatch = media === 'all' || (media === 'video' ? ad.videos?.length > 0 : ad.images?.length > 0 && !ad.videos?.length);
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
  if (/^[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function exportAds(format) {
  if (!ready || busy || running) return;
  const ads = filteredAds();
  if (!ads.length) { feedback('Seçili filtrelere uygun sonuç yok.'); return; }
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
  link.download = `meta-reklamlar-${Date.now()}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  feedback(`${format.toUpperCase()} dosyası hazırlandı.`);
}
$('#export-csv').addEventListener('click', () => exportAds('csv'));
$('#export-json').addEventListener('click', () => exportAds('json'));

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
async function refreshState(reconcile = false) {
  const version = ++refreshVersion;
  const saved = reconcile ? (await command('GET_STATE')).state : await chrome.storage.local.get(Object.keys(state).concat('scan'));
  if (version !== refreshVersion) return;
  const oldScan = state.scan;
  state = { ...state, ...saved };
  running = Boolean(state.scan?.running);
  render();
  if (!running && state.scan?.reason && (oldScan?.running || oldScan?.reason !== state.scan.reason)) feedback(REASONS[state.scan.reason] || '');
}
async function init() {
  const buttons = [...document.querySelectorAll('button:not([role="tab"])')];
  buttons.forEach((button) => { button.disabled = true; });
  renderScan();
  try {
    await refreshState(true);
    $('#media-type').value = state.filters.mediaType;
    $('#platform').value = state.filters.platform;
    $('#auto-scroll').checked = state.settings.autoScroll;
    $('#scroll-speed').value = state.settings.speed;
    $('#max-ads').value = state.settings.maxAds;
    ready = true;
    buttons.forEach((button) => { button.disabled = false; });
    renderScan();
  } catch (error) { feedback(error.message); }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ['ads', 'scrollCount', 'scan', 'history', 'competitors', 'filters'].some((key) => key in changes)) {
    refreshState().catch(() => feedback('Tarama durumu okunamadı.'));
  }
});
init();
