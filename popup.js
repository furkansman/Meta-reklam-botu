'use strict';

const $ = (selector) => document.querySelector(selector);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const feedback = (message) => { $('#feedback').textContent = message; };
let state = { history: [], competitors: [], filters: { mediaType: 'all', platform: 'all' } };

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
  $('#history-list').replaceChildren();
  state.history.forEach((entry) => {
    const li = document.createElement('li');
    const text = document.createElement('div');
    text.textContent = entry.query;
    const detail = document.createElement('small');
    detail.textContent = `${entry.country} · ${new Date(entry.createdAt).toLocaleString('tr-TR')}`;
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

$('#scan-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = $('#query').value.trim();
  if (!query) { feedback('Bir marka veya anahtar kelime gir.'); return; }
  perform(event.submitter, async () => {
    const history = [{ query, country: $('#country').value, status: $('#ad-status').value,
      filters: { ...state.filters }, createdAt: Date.now() }, ...state.history].slice(0, 100);
    await chrome.storage.local.set({ history });
    state.history = history;
    render();
    feedback('Arama geçmişe kaydedildi. Canlı reklam taraması henüz bağlı değil.');
  });
});

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
  const buttons = [...document.querySelectorAll('form button, #clear-history')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const saved = await chrome.storage.local.get(['history', 'competitors', 'filters']);
    state = { ...state, ...saved };
    $('#media-type').value = state.filters.mediaType;
    $('#platform').value = state.filters.platform;
    render();
    buttons.forEach((button) => { button.disabled = false; });
  } catch { feedback('Yerel veriler yüklenemedi. Eklentiyi yeniden açmayı dene.'); }
}
init();
