'use strict';

const $ = (selector) => document.querySelector(selector);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const feedback = (message) => { $('#feedback').textContent = message; };
let running = false;
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
      const competitors = state.competitors.filter((item) => item !== name);
      await chrome.storage.local.set({ competitors });
      state.competitors = competitors;
      render();
      feedback('Marka listeden kaldırıldı.');
    }));
    li.append(label, remove);
    $('#competitor-list').append(li);
  });
  $('#competitors-empty').hidden = state.competitors.length > 0;
}

async function perform(button, operation) {
  button.disabled = true;
  try { await operation(); }
  catch { feedback('Kayıt işlemi tamamlanamadı. Lütfen tekrar dene.'); }
  finally { button.disabled = false; }
}

function renderScan() {
  $('#scan-status').textContent = running ? 'Çalışıyor… (iskelet)' : 'Hazır';
  $('#scan-status').classList.toggle('running', running);
  $('#ad-count').textContent = state.ads.length;
  $('#scroll-count').textContent = state.scrollCount;
  $('#start-scan').disabled = running;
  $('#stop-scan').disabled = !running;
  $('#auto-scroll').disabled = running;
  $('#scroll-speed').disabled = running || !$('#auto-scroll').checked;
  $('#max-ads').disabled = running;
  $('#clear-results').disabled = running;
  $('#export-csv').disabled = running || state.ads.length === 0;
  $('#export-json').disabled = running || state.ads.length === 0;
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
    await chrome.storage.local.set({ settings });
    state.settings = settings;
    running = true;
    // Integration point: send settings to a future content script here.
    // No artificial advertisements or scroll events are generated.
    feedback('Kontrol oturumu başladı. Canlı scraping ve scroll bağlantısı henüz eklenmedi.');
  }).then(renderScan);
});

$('#stop-scan').addEventListener('click', (event) => perform(event.currentTarget, async () => {
  running = false;
  renderScan();
  const history = [{ createdAt: Date.now(), adCount: state.ads.length, scrollCount: state.scrollCount,
    settings: { ...state.settings } }, ...state.history].slice(0, 100);
  await chrome.storage.local.set({ history });
  state.history = history;
  render();
  feedback('Oturum durduruldu ve geçmişe kaydedildi.');
}).then(renderScan));

$('#clear-results').addEventListener('click', (event) => perform(event.currentTarget, async () => {
  await chrome.storage.local.set({ ads: [], scrollCount: 0 });
  state.ads = [];
  state.scrollCount = 0;
  render();
  feedback('Tarama sonuçları temizlendi.');
}).then(renderScan));

function csvCell(value) {
  let text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  // Prevent spreadsheet formula execution when opening exported untrusted ad text.
  if (/^[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function exportAds(format) {
  if (running || !state.ads.length) return;
  let content = JSON.stringify(state.ads, null, 2);
  if (format === 'csv') {
    const columns = [...new Set(state.ads.flatMap((ad) => Object.keys(ad)))];
    content = '\uFEFF' + [columns.map(csvCell).join(','),
      ...state.ads.map((ad) => columns.map((key) => csvCell(ad[key])).join(','))].join('\r\n');
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
  await chrome.storage.local.set({ history: [] });
  state.history = [];
  render();
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
    const competitors = [...state.competitors, name];
    await chrome.storage.local.set({ competitors });
    state.competitors = competitors;
    $('#competitor-name').value = '';
    render();
    feedback('Marka takip listesine eklendi.');
  });
});

$('#filters-form').addEventListener('submit', (event) => {
  event.preventDefault();
  perform(event.submitter, async () => {
    const filters = { mediaType: $('#media-type').value, platform: $('#platform').value };
    await chrome.storage.local.set({ filters });
    state.filters = filters;
    feedback('Filtre tercihlerin kaydedildi.');
  });
});

async function init() {
  const buttons = [...document.querySelectorAll('button:not([role="tab"])')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const saved = await chrome.storage.local.get(['ads', 'scrollCount', 'settings', 'history', 'competitors', 'filters']);
    state = { ...state, ...saved };
    $('#media-type').value = state.filters.mediaType;
    $('#platform').value = state.filters.platform;
    $('#auto-scroll').checked = state.settings.autoScroll;
    $('#scroll-speed').value = state.settings.speed;
    $('#max-ads').value = state.settings.maxAds;
    render();
    buttons.forEach((button) => { button.disabled = false; });
    renderScan();
  } catch { feedback('Yerel veriler yüklenemedi. Eklentiyi yeniden açmayı dene.'); }
}
init();
