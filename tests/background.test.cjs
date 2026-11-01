const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../background.js'), 'utf8');
const url = 'https://www.facebook.com/ads/library/?q=test';
const settings = { autoScroll: true, speed: 'fast', maxAds: 5 };
function harness(shared = {}) {
  const store = shared.store || {};
  const sessions = shared.sessions || new Map();
  const events = {};
  const requests = [];
  let apiStatus = 200;
  const event = (name) => ({ addListener(fn) { events[name] = fn; } });
  let activeTab = { id: 7, url };
  let failStart = false, failQuota = false, collectorVersion = '0.4.0';
  const chrome = {
    runtime: { id: 'test', getURL: (path) => `chrome-extension://test/${path}`, onMessage: event('message'),
      onStartup: event('startup'), onInstalled: event('installed') },
    scripting: { async executeScript() {} },
    alarms: { async create() {}, onAlarm: event('alarm') },
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) { if (typeof keys === 'string') keys = [keys]; return structuredClone(Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]]))); },
      async set(values) { if (failQuota && values.ads?.some((ad) => ad.large)) throw new Error('QUOTA'); Object.assign(store, structuredClone(values)); }
    } },
    tabs: {
      async query() { return [activeTab]; },
      async sendMessage(tabId, msg) {
        if (msg.type === 'META_SCAN_STATUS') return { running: sessions.has(tabId), sessionId: sessions.get(tabId), version: collectorVersion };
        if (msg.type === 'META_SCAN_START') { if (failStart) throw new Error('No receiver'); sessions.set(tabId, msg.sessionId); }
        if (msg.type === 'META_SCAN_STOP') sessions.delete(tabId);
        return { ok: true };
      }, onRemoved: event('removed'), onUpdated: event('updated')
    }
  };
  vm.runInNewContext(source, { chrome, crypto: webcrypto, URL, console, Date, AbortSignal, fetch: async (url, options) => { requests.push({ url, options }); return { ok: apiStatus === 200, status: apiStatus, async json() { return { ok: apiStatus === 200 }; } }; } });
  const send = (message, sender = { id: 'test', url: 'chrome-extension://test/popup.html' }) => new Promise((resolve) => events.message(message, sender, resolve));
  const progress = (overrides = {}, senderOverrides = {}) => send({ type: 'META_SCAN_PROGRESS', sessionId: store.scan.sessionId,
    ads: [{ id: '12345', text: 'Ad' }], scrollCount: 1, ...overrides }, { id: 'test', tab: { id: 7 }, frameId: 0, url, ...senderOverrides });
  return { store, sessions, events, send, progress, requests, apiStatus: (status) => { apiStatus = status; }, collectorVersion: (version) => { collectorVersion = version; }, setTab: (tab) => { activeTab = tab; }, failStart: () => { failStart = true; }, failQuota: () => { failQuota = true; } };
}
test('start/progress/stop/finish, single owner and idempotent history', async () => {
  const h = harness();
  assert.equal((await h.send({ type: 'START_SCAN', settings })).ok, true);
  assert.equal((await h.send({ type: 'START_SCAN', settings })).ok, false);
  assert.equal((await h.progress()).ok, true);
  assert.equal(h.store.ads[0].id, '12345');
  assert.equal((await h.send({ type: 'CLEAR_RESULTS' })).ok, false);
  assert.equal((await h.send({ type: 'STOP_SCAN' })).ok, true);
  assert.equal(h.store.scan.stopping, true);
  assert.equal((await h.progress({ type: 'META_SCAN_FINISHED', reason: 'stopped' })).ok, true);
  assert.equal(h.store.scan.running, false);
  assert.equal(h.store.history.length, 1);
  assert.equal((await h.progress({ type: 'META_SCAN_FINISHED' })).ok, false);
  assert.equal(h.store.history.length, 1);
});
test('worker restart keeps session; lost content connection finishes once', async () => {
  const h = harness(); await h.send({ type: 'START_SCAN', settings }); await h.progress();
  const restored = harness(h);
  assert.equal((await restored.send({ type: 'GET_STATE' })).state.scan.running, true);
  restored.sessions.clear();
  assert.equal((await restored.send({ type: 'GET_STATE' })).state.scan.running, false);
  assert.equal(restored.store.history.length, 1);
  await restored.send({ type: 'GET_STATE' }); assert.equal(restored.store.history.length, 1);
});
test('reject wrong tab, frame, session and popup impersonation', async () => {
  const h = harness(); await h.send({ type: 'START_SCAN', settings });
  assert.equal((await h.progress({}, { tab: { id: 8 } })).ok, false);
  assert.equal((await h.progress({}, { frameId: 1 })).ok, false);
  assert.equal((await h.progress({ sessionId: 'stale' })).ok, false);
  assert.equal((await h.send({ type: 'CLEAR_RESULTS' }, { id: 'test', url: 'https://evil.example/' })).ok, false);
  assert.equal((await h.progress({ type: 'CLEAR_HISTORY' })).ok, false);
});
test('failed start preserves results, validates settings and page', async () => {
  const h = harness({ store: { ads: [{ id: 'old' }], scrollCount: 3 } }); h.failStart();
  assert.equal((await h.send({ type: 'START_SCAN', settings })).ok, false);
  assert.equal(h.store.ads[0].id, 'old'); assert.equal(h.store.scan.running, false);
  assert.equal((await h.send({ type: 'START_SCAN', settings: { ...settings, maxAds: 0 } })).ok, false);
  h.setTab({ id: 7, url: 'https://example.com/' });
  assert.equal((await h.send({ type: 'START_SCAN', settings })).ok, false);
});
test('quota failure preserves saved results and releases ownership', async () => {
  const h = harness(); await h.send({ type: 'START_SCAN', settings }); await h.progress(); h.failQuota();
  assert.equal((await h.progress({ ads: [{ id: 'large', large: true }] })).ok, false);
  assert.equal(h.store.ads[0].id, '12345'); assert.equal(h.store.scan.reason, 'storage-error');
});
test('tab close and navigation end sessions and ignore late progress', async () => {
  for (const kind of ['close', 'navigate']) {
    const h = harness(); await h.send({ type: 'START_SCAN', settings }); await h.progress();
    if (kind === 'close') h.events.removed(7); else h.events.updated(7, { url: url + '2' });
    await h.send({ type: 'GET_STATE' });
    assert.equal(h.store.scan.running, false); assert.equal(h.store.history.length, 1);
    assert.equal((await h.progress()).ok, false);
  }
});
test('concurrent starts serialize; competitors and filters persist', async () => {
  const h = harness(); const results = await Promise.all([h.send({ type: 'START_SCAN', settings }), h.send({ type: 'START_SCAN', settings })]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  await Promise.all(['Bir', 'İki'].map((name) => h.send({ type: 'ADD_COMPETITOR', name })));
  assert.deepEqual(h.store.competitors, ['Bir', 'İki']);
  assert.equal((await h.send({ type: 'ADD_COMPETITOR', name: 'BİR' })).ok, false);
  await h.send({ type: 'REMOVE_COMPETITOR', name: 'Bir' }); assert.deepEqual(h.store.competitors, ['İki']);
  await h.send({ type: 'SAVE_FILTERS', filters: { mediaType: 'video', platform: 'instagram' } });
  assert.equal(h.store.filters.platform, 'instagram');
  assert.equal((await h.send({ type: 'SAVE_FILTERS', filters: {} })).ok, false);
});

test('archive keeps scan data; telegram credential settings stay out of public state', async () => {
  const h = harness();
  await h.send({ type: 'SAVE_TELEGRAM', enabled: true, token: '123456:TEST_TOKEN_FOR_UNIT_TESTS_ONLY', chatId: '-1001234567890' });
  const response = await h.send({ type: 'GET_STATE' });
  assert.equal(response.state.telegramStatus.tokenConfigured, true);
  assert(!JSON.stringify(response).includes('TEST_TOKEN'));
  await h.send({ type: 'SAVE_TELEGRAM', enabled: true, token: '', chatId: '123456789' });
  assert.equal(h.store.telegramConfig.token, '123456:TEST_TOKEN_FOR_UNIT_TESTS_ONLY');
  await h.send({ type: 'START_SCAN', settings }); await h.progress();
  await h.progress({ type: 'META_SCAN_FINISHED', reason: 'limit' });
  for (let attempt = 0; attempt < 20 && h.store.history[0].telegram !== 'sent'; attempt++) await new Promise(setImmediate);
  assert.equal(h.store.history[0].ads[0].id, '12345');
  assert.equal(h.store.history[0].telegram, 'sent');
  assert.equal(h.requests.length, 1);
  const payload = JSON.parse(h.requests[0].options.body);
  assert.equal(payload.chat_id, '123456789'); assert.match(payload.text, /Reklam: 1/);
  assert.match(h.requests[0].url, /^https:\/\/api\.telegram\.org\/bot.+\/sendMessage$/);
  await h.send({ type: 'REMOVE_TELEGRAM' });
  assert.equal(h.store.telegramStatus.tokenConfigured, false);
  assert.deepEqual(h.store.telegramConfig, {});
});
test('telegram API failures are reported safely and transient failures retain durable jobs', async () => {
  for (const status of [401, 429, 500]) {
    const h = harness(); h.apiStatus(status);
    await h.send({ type: 'SAVE_TELEGRAM', enabled: true, token: '123456:TEST_TOKEN_FOR_UNIT_TESTS_ONLY', chatId: '123456789' });
    const result = await h.send({ type: 'TEST_TELEGRAM' });
    assert.equal(result.ok, false); assert(!result.error.includes('TEST_TOKEN'));
    await h.send({ type: 'START_SCAN', settings }); await h.progress(); await h.progress({ type: 'META_SCAN_FINISHED', reason: 'stopped' });
    for (let attempt = 0; attempt < 20 && h.store.history[0].telegram === 'queued'; attempt++) await new Promise(setImmediate);
    assert.equal(h.store.history[0].telegram, status === 401 ? 'failed' : 'retrying');
    assert.equal(h.store.telegramOutbox.length, status === 401 ? 0 : 1);
    assert.equal(h.store.scan.running, false);
  }
});

test('competitor scans compare collected IDs against the previous scan', async () => {
  const h = harness(); await h.send({ type: 'ADD_COMPETITOR', name: 'test' });
  for (const ids of [['12345'], ['12345', '67890']]) {
    await h.send({ type: 'START_SCAN', settings });
    await h.progress({ type: 'META_SCAN_FINISHED', ads: ids.map((id) => ({ id })), reason: 'stopped' });
  }
  assert.equal(h.store.competitorStats.test.count, 2);
  assert.equal(h.store.competitorStats.test.newCount, 1);
  assert.equal(h.store.history[1].ads.length, 1);
});

test('stale collector is rejected before clearing results; discovery is sanitized', async () => {
  const h = harness({ store: { ads: [{ id: 'previous' }], scrollCount: 2 } });
  h.collectorVersion(undefined);
  const response = await h.send({ type: 'START_SCAN', settings });
  assert.equal(response.ok, false); assert.match(response.error, /eski tarama kodu/);
  assert.equal(h.store.ads[0].id, 'previous');
  h.collectorVersion('0.4.0');
  await h.send({ type: 'START_SCAN', settings });
  await h.progress({ discovery: { candidates: 12, matched: 1, version: '0.4.0', token: 'private' } });
  assert.equal(h.store.scan.discovery.candidates, 12);
  assert.equal(h.store.scan.discovery.token, undefined);
});
