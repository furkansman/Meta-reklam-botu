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
  const sessionStore = shared.sessionStore || {};
  const events = {};
  const requests = [];const tabMessages=[];
  let apiStatus = 200, apiDescription='',writeError=false;
  const event = (name) => ({ addListener(fn) { events[name] = fn; } });
  let activeTab = { id: 7, url };
  let failStart = false, failQuota = false, collectorVersion = '0.9.1';
  const chrome = {
    runtime: { id: 'test', async sendMessage() {}, getURL: (path) => `chrome-extension://test/${path}`, onMessage: event('message'),
      onStartup: event('startup'), onInstalled: event('installed') },
    scripting: { async executeScript() {} },
    alarms: { async create() {}, onAlarm: event('alarm') },
    storage: { session: { async setAccessLevel() {}, async get(keys) { if (typeof keys === 'string') keys=[keys]; return structuredClone(Object.fromEntries(keys.filter(key=>key in sessionStore).map(key=>[key,sessionStore[key]]))); }, async set(values) { Object.assign(sessionStore,structuredClone(values)); } }, local: {
      async setAccessLevel() {},async remove(keys){for(const key of keys)delete store[key];},
      async get(keys) { if (typeof keys === 'string') keys = [keys]; return structuredClone(Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]]))); },
      async set(values) { if(writeError&&values.telegramConfig)throw new Error('Yerel kayıt yazılamadı.'); if (failQuota && values.ads?.some((ad) => ad.large)) throw new Error('QUOTA'); Object.assign(store, structuredClone(values)); }
    } },
    tabs: {
      async query() { return [activeTab]; },
      async reload(tabId){sessions.delete(tabId);},
      async sendMessage(tabId, msg) {tabMessages.push(msg);
        if (msg.type === 'META_SCAN_STATUS') return { running: sessions.has(tabId), sessionId: sessions.get(tabId), version: collectorVersion };
        if (msg.type === 'META_SCAN_START') { if (failStart) throw new Error('No receiver'); sessions.set(tabId, msg.sessionId); }
        if (msg.type === 'META_SCAN_STOP') sessions.delete(tabId);
        return { ok: true };
      }, onRemoved: event('removed'), onUpdated: event('updated')
    }
  };
  vm.runInNewContext(source, { chrome, crypto: webcrypto, URL, console, Date, AbortSignal, setTimeout, clearTimeout, fetch: async (url, options) => { requests.push({ url, options }); return { ok: apiStatus === 200, status: apiStatus, async json() { return { ok: apiStatus === 200,description:apiDescription }; } }; } });
  const send = (message, sender = { id: 'test', url: 'chrome-extension://test/popup.html' }) => new Promise((resolve) => events.message(message, sender, resolve));
  const progress = (overrides = {}, senderOverrides = {}) => send({ type: 'META_SCAN_PROGRESS', sessionId: store.scan.sessionId,
    ads: [{ id: '12345', text: 'Ad' }], scrollCount: 1, ...overrides }, { id: 'test', tab: { id: 7 }, frameId: 0, url, ...senderOverrides });
  return { store, sessions, sessionStore, tabMessages, events, send, progress, requests, apiStatus: (status,description='') => { apiStatus = status;apiDescription=description; },writeError:()=>{writeError=true;}, collectorVersion: (version) => { collectorVersion = version; }, setTab: (tab) => { activeTab = tab; }, failStart: () => { failStart = true; }, failQuota: () => { failQuota = true; } };
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
  await h.send({ type: 'SAVE_TELEGRAM', enabled: true, token: '123456:TEST_TOKEN_FOR_UNIT_TESTS_ONLY_123456', chatId: '-1001234567890' });
  const response = await h.send({ type: 'GET_STATE' });
  assert.equal(response.state.telegramStatus.tokenConfigured, true);
  assert(!JSON.stringify(response).includes('TEST_TOKEN'));
  await h.send({ type: 'SAVE_TELEGRAM', enabled: true, token: '', chatId: '123456789' });
  assert.equal(h.store.telegramConfig.token, '123456:TEST_TOKEN_FOR_UNIT_TESTS_ONLY_123456');
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
    await h.send({ type: 'SAVE_TELEGRAM', enabled: true, token: '123456:TEST_TOKEN_FOR_UNIT_TESTS_ONLY_123456', chatId: '123456789' });
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
  h.collectorVersion('0.9.1');
  await h.send({ type: 'START_SCAN', settings });
  await h.progress({ discovery: { candidates: 12, matched: 1, version: '0.9.1', token: 'private' } });
  assert.equal(h.store.scan.discovery.candidates, 12);
  assert.equal(h.store.scan.discovery.token, undefined);
});

test('live counters persist across worker restart, reject stale reports and reset correctly', async () => {
  const h = harness(); await h.send({ type:'START_SCAN', settings });
  assert.equal(h.sessionStore.scanProgress.ads,0);assert.equal(h.sessionStore.scanProgress.status,'scanning');
  const live = await h.progress({type:'SCAN_PROGRESS',ads:3,scrolls:2,status:'scanning'});
  assert.equal(live.ok,true);assert.equal(live.progress.ads,3);assert.equal(h.sessionStore.scanProgress.scrolls,2);
  assert.equal((await h.progress({type:'SCAN_PROGRESS',ads:2,scrolls:2,status:'scanning'})).ok,false);
  const restored=harness(h);await restored.send({type:'GET_STATE'});
  assert.equal(restored.sessionStore.scanProgress.ads,3);assert.equal(restored.sessionStore.scanProgress.scrolls,2);
  await restored.progress({type:'META_SCAN_FINISHED',ads:[{id:'1'},{id:'2'},{id:'3'}],scrollCount:2,reason:'limit'});
  assert.equal(restored.sessionStore.scanProgress.status,'completed');
  assert.equal((await restored.progress({type:'SCAN_PROGRESS',ads:3,scrolls:3,status:'scanning'})).ok,false);
  await restored.send({type:'CLEAR_RESULTS'});assert.equal(restored.sessionStore.scanProgress.ads,0);assert.equal(restored.sessionStore.scanProgress.scrolls,0);assert.equal(restored.sessionStore.scanProgress.status,'ready');
  await restored.send({type:'START_SCAN',settings});assert.equal(restored.sessionStore.scanProgress.ads,0);
});

test('uncheckpointed records survive tab loss and resume includes persisted IDs',async()=>{
 const h=harness();await h.send({type:'START_SCAN',settings});
 await h.progress({type:'SCAN_PROGRESS',ads:1,scrolls:1,status:'scanning',record:{id:'123456789012',primaryText:'Buffered ad'}});
 assert.equal(h.store.ads.length,0);h.events.removed(7);await h.send({type:'GET_STATE'});
 assert.equal(h.store.ads[0].id,'123456789012');
 assert.equal((await h.send({type:'RESUME_SCAN',settings})).ok,true);assert.equal(h.store.ads.length,1);assert.equal(h.sessionStore.scanProgress.ads,1);
});

test('Telegram token cleanup, strict validation, suffix masking and write errors',async()=>{
 const h=harness(),token='1234567890:AAH_abcdefghijklmnopqrstuvwxyz123456';
 assert.equal((await h.send({type:'SAVE_TELEGRAM',token:' \"bot'+token+'\"\n ',chatId:' -10012345 ',enabled:true})).ok,true);
 assert.equal(h.store.telegramConfig.token,token);assert.equal(h.store.telegramConfig.chatId,'-10012345');
 const publicState=await h.send({type:'GET_STATE'});assert.equal(publicState.state.telegramStatus.tokenSuffix,'3456');assert(!JSON.stringify(publicState).includes(token));
 assert.match((await h.send({type:'SAVE_TELEGRAM',token:'12345:abc',chatId:'1',enabled:true})).error,/Token biçimi hatalı/);
 for(const chatId of ['@channel','+123','1.23','abc','-'])assert.match((await h.send({type:'SAVE_TELEGRAM',token:'',chatId,enabled:true})).error,/Chat ID hatalı/);
 h.writeError();assert.equal((await h.send({type:'SAVE_TELEGRAM',token:'',chatId:'123',enabled:true})).ok,false);
});
test('Telegram test payload and Turkish API errors do not expose credentials',async()=>{
 const h=harness(),token='1234567890:AAH_abcdefghijklmnopqrstuvwxyz123456';
 await h.send({type:'SAVE_TELEGRAM',token,chatId:'123456789',enabled:true});
 await h.send({type:'TEST_TELEGRAM'});assert.equal(JSON.parse(h.requests[0].options.body).text,'Test: Meta Reklam Botu bağlandı ✓');
 h.apiStatus(400,'Bad Request: chat not found');assert((await h.send({type:'TEST_TELEGRAM'})).error.startsWith("Önce Telegram'da botuna /start yaz"));
 h.apiStatus(401,'Unauthorized');assert((await h.send({type:'TEST_TELEGRAM'})).error.includes("Telegram bu token'ı kabul etmedi"));
});

test('placeholder and blank reuse saved token; unsaved token test does not replace storage',async()=>{
 const h=harness();const saved='1234567890:AAH_saved_token_abcdefghijklmnopqrstuvwxyz';const draft='9876543210:AAH_draft_token_abcdefghijklmnopqrstuvwxyz';
 await h.send({type:'SAVE_TELEGRAM',token:saved,chatId:'12345',enabled:true});
 await h.send({type:'SAVE_TELEGRAM',token:'••••••••',chatId:'12345',enabled:true});assert.equal(h.store.telegramConfig.token,saved);
 await h.send({type:'TEST_TELEGRAM',token:'........',chatId:'12345'});assert(h.requests.at(-1).url.includes(saved));
 await h.send({type:'TEST_TELEGRAM',token:draft,chatId:'12345'});assert(h.requests.at(-1).url.includes(draft));assert.equal(h.store.telegramConfig.token,saved);
 h.store.telegramConfig.token='legacy-token';assert.equal((await h.send({type:'SAVE_TELEGRAM',token:'',chatId:'12345',enabled:true})).ok,true);
});

test('append-only batches are idempotent and materialize without rewriting old records',async()=>{
 const h=harness();await h.send({type:'START_SCAN',settings:{...settings,maxAds:100}});
 const sessionId=h.store.scan.sessionId;
 const batch={type:'META_SCAN_APPEND',batchId:sessionId+':0',records:[{id:'123456789012',fullText:'First'}],scrollCount:1,discovery:{candidates:1,matched:1,version:'0.9.1',speed:100,slow:false}};
 assert.equal((await h.progress(batch)).ok,true);assert.equal(h.store.ads.length,0);
 await h.progress(batch);assert.equal(h.store.scanBatches.keys.length,1);
 const state=await h.send({type:'GET_STATE'});assert.equal(state.state.ads.length,1);assert.equal(state.state.ads[0].fullText,'First');
 await h.progress({type:'META_SCAN_FINISHED',ads:state.state.ads,scrollCount:1,reason:'stopped'});assert.equal(h.store.ads.length,1);assert.equal(h.store.scanBatches,null);
});
test('automatic refresh preserves IDs, scroll count and position through navigation',async()=>{
 const h=harness();await h.send({type:'START_SCAN',settings:{...settings,maxAds:1000,autoRefresh:true}});
 await h.progress({type:'META_SCAN_APPEND',batchId:h.store.scan.sessionId+':0',records:[{id:'123456789012'}],scrollCount:7});
 assert.equal((await h.progress({type:'SCAN_REFRESH',scrollY:4200,scrollCount:7})).ok,true);
 assert(h.store.scan.refreshing);h.events.updated(7,{status:'loading'});await h.send({type:'GET_STATE'});assert(h.store.scan.running);
 h.events.updated(7,{status:'complete'});await h.send({type:'GET_STATE'});
 const last=h.tabMessages.filter(msg=>msg.type==='META_SCAN_START').at(-1);assert.equal(last.resumeAds[0].id,'123456789012');assert.equal(last.resumeScrolls,7);assert.equal(last.scrollY,4200);assert.equal(h.store.ads.length,1);assert(!h.store.scan.refreshing);
});
