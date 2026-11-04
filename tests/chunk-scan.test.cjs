const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm'), fs = require('node:fs');
const api = require('../chunk-scan.js'), AdData = require('../ad-data.js');
const source = 'https://www.facebook.com/ads/library/?q=implant&country=TR&active_status=active&media_type=all&start_date[min]=2026-10-01&start_date[max]=2026-10-31';
const config = { start: '2026-10-01', end: '2026-10-02', unit: 'day', limit: 800, waitMin: 20, waitMax: 40 };
function harness(shared = {}, worker = false) {
  const store = shared.store || {}, sessionStore = shared.sessionStore || {}, events = {}, alarms = new Map(), tabs = shared.tabs || new Map();
  const writes = [], requests = [], probes = [], telegram = [], progress = [], removed = [];
  let time = Date.parse('2026-11-04T12:00:00Z'), index = 20, queue = Promise.resolve(), runtimeListener, statusRunning = true, poolFailures = 0, rankOrder = [];
  const event = name => ({ addListener(fn) { (events[name] ||= []).push(fn); if (name === 'message') runtimeListener = fn; } });
  const chrome = {
    runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, async sendMessage() {}, onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed') },
    storage: {
      local: { async setAccessLevel() {}, async get(keys) { if (typeof keys === 'string') keys = [keys]; return structuredClone(Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]]))); }, async set(value) { if(poolFailures && Object.keys(value).some(k=>k.startsWith('chunk-pool:'))){poolFailures--;throw new Error('quota');} writes.push(structuredClone(value)); Object.assign(store, structuredClone(value)); }, async remove(keys) { for (const k of keys) delete store[k]; } },
      session: { async setAccessLevel() {}, async get(keys) { if (typeof keys === 'string') keys = [keys]; return structuredClone(Object.fromEntries(keys.filter(k => k in sessionStore).map(k => [k, sessionStore[k]]))); }, async set(value) { Object.assign(sessionStore, structuredClone(value)); } }
    },
    tabs: { async query() { return [{ id: 7, url: shared.url || source }]; }, async create(value) { const tab = { ...value, id: index++, status: 'loading' }; tabs.set(tab.id, tab); return tab; }, async get(id) { if (!tabs.has(id)) throw Error('missing'); return tabs.get(id); }, async remove(id) { removed.push(id); tabs.delete(id); }, async sendMessage(id, message) { requests.push({ id, ...message }); if (message.type === 'META_SCAN_STATUS') return { running: statusRunning, sessionId: store.chunkRun?.active?.sessionId || store.scan?.sessionId, version: '0.9.1' }; return { ok: true }; }, onUpdated: event('updated'), onRemoved: event('removed') },
    alarms: { async create(name, value) { alarms.set(name, value); }, async clear(name) { alarms.delete(name); }, onAlarm: event('alarm') },
    scripting: { async executeScript(input) { requests.push(input); if (input.files) return []; if(input.func?.name==='rankPage')return [{result:rankOrder}]; const active = store.chunkRun.active; return [{ result: { blocked: false, total: 2, url: tabs.get(active.tabId).url, ...probes.shift() } }]; } },
    notifications: { onButtonClicked: event('button') }
  };
  const enqueue = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  let service, context;
  if (worker) {
    context = { chrome, ChunkScan: api, AdData, crypto: webcrypto, Date, URL, console, AbortSignal, setTimeout, clearTimeout, fetch: async (url, options) => { telegram.push(JSON.parse(options.body)); return { ok: true, async json() { return { ok: true }; } }; } };
    vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../background.js'), 'utf8'), context);
    service = vm.runInNewContext('chunkService', context);
  } else service = api.create(chrome, { enqueue, now: () => time, random: () => .5, publishProgress: async (state, override) => { const value = { ...override, status: override.status || 'scanning' }; progress.push(value); return value; }, sendTelegram: async (config, text) => telegram.push(text) });
  const send = async message => { const active = store.chunkRun.active; return service.content({ sessionId: active.sessionId, scrollCount: 0, ...message }, { id: 'test', tab: { id: active.tabId }, frameId: 0, url: tabs.get(active.tabId).url }); };
  return { service, store, sessionStore, tabs, alarms, writes, requests, probes, telegram, progress, removed, events, context, chrome,
    send, command: message => new Promise(resolve => runtimeListener(message, { id: 'test', url: 'chrome-extension://test/popup.html' }, resolve)),
    async loaded(total = 2) { probes.push({ total }); await service.loaded(store.chunkRun.active.tabId); },
    async next() { time = Math.max(time, store.chunkRun.nextAt); await service.next(); },
    advance(ms) { time += ms; }, async idle() { await queue; }, setStatus(value) { statusRunning = value; }, failPoolOnce(){poolFailures=1;}, setOrder(ids){rankOrder=ids;}
  };
}
const ad = (id, startDate = '2026-10-01') => ({ id: String(id), advertiser: 'Marka', fullText: 'Diş tedavisinde yeni çözüm.', hook: 'Diş tedavisinde yeni çözüm.', headline: 'Teklif', cta: 'Get Quote', startDate, mediaType: 'image', mediaUrl: 'https://example.org/ad.jpg', targetUrl: 'https://example.org/' });

test('date ranges are inclusive, disjoint and cover days/weeks/calendar months including leap days', () => {
  for (const unit of ['day', 'week', 'month']) {
    const list = api.ranges({ start: '2024-01-31', end: '2024-04-02', unit });
    assert.equal(list[0].start, '2024-01-31'); assert.equal(list.at(-1).end, '2024-04-02');
    for (let i = 1; i < list.length; i++) assert.equal(Date.parse(list[i].start) - Date.parse(list[i - 1].end), 86400000);
    assert(list.every(p => p.start <= p.end));
  }
  assert.throws(() => api.settings({ ...config, start: '2026-02-30' }));
  assert.throws(() => api.settings({ ...config, waitMin: 40, waitMax: 20 }));
});
test('fixed date keys replace raw/encoded/empty duplicates and preserve all other query values', () => {
  const base = source + '&publisher_platforms[0]=facebook&publisher_platforms[1]=instagram&extra=a&extra=b&start_date%5Bmin%5D=&start_date%5Bmax%5D=';
  const result = new URL(api.pieceUrl(base, { start: '2026-10-14', end: '2026-10-20' }));
  const expected=new URL(base);expected.searchParams.delete('start_date[min]');expected.searchParams.delete('start_date[max]');
  const actual=new URL(result);actual.searchParams.delete('start_date[min]');actual.searchParams.delete('start_date[max]');
  assert.deepEqual([...actual.searchParams],[...expected.searchParams]);
  assert.deepEqual(result.searchParams.getAll('start_date[min]'),['2026-10-14']);assert.deepEqual(result.searchParams.getAll('start_date[max]'),['2026-10-20']);
  assert.equal(new URL(api.pieceUrl('https://www.facebook.com/ads/library/?q=implant',config)).searchParams.get('start_date[min]'),config.start);
  assert.throws(()=>api.pieceUrl('https://evil.example/ads/library/',config),/Önce Meta Reklam Kütüphanesi sonuç sayfasını aç, sonra başlat/);
});
test('user URL produces two complete weekly pieces and keeps quote/exact search/sort parameters',()=>{
  const input='https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TR&is_targeted_country=false&media_type=all&q=%22implant%22&search_type=keyword_exact_phrase&sort_data[direction]=desc&sort_data[mode]=total_impressions&start_date[min]=2026-10-21&start_date[max]=2026-11-04';
  const pieces=api.ranges({...config,start:'2026-10-21',end:'2026-11-04',unit:'week'});
  assert.deepEqual(pieces.map(p=>[p.start,p.end]),[['2026-10-21','2026-10-27'],['2026-10-28','2026-11-04']]);
  for(const piece of pieces){const actual=new URL(api.pieceUrl(input,piece)),original=new URL(input);for(const name of ['start_date[min]','start_date[max]']){actual.searchParams.delete(name);original.searchParams.delete(name);}assert.deepEqual([...actual.searchParams],[...original.searchParams]);}
});
test('split dates then one-day media then platforms, respect existing filters and terminate', () => {
  const halves = api.split({ start: '2026-10-01', end: '2026-10-07' }, source);
  assert.deepEqual(halves.map(p => [p.start, p.end]), [['2026-10-01', '2026-10-04'], ['2026-10-05', '2026-10-07']]);
  const media = api.split({ start: '2026-10-20', end: '2026-10-20' }, source); assert.deepEqual(media.map(p => p.media), ['image', 'video']);
  const platforms = api.split(media[1], source); assert.deepEqual(platforms.map(p => p.platform), ['facebook', 'instagram']);
  assert.deepEqual(api.split(platforms[0], source), []); assert.equal(api.label(media[1]), '2026-10-20 · video');
  assert.deepEqual(api.split(media[1], source + '&publisher_platforms[0]=facebook'), []);
  const url = new URL(api.pieceUrl(source, platforms[0])); assert.equal(url.searchParams.get('media_type'), 'video'); assert.equal(url.searchParams.get('publisher_platforms[0]'), 'facebook');
  assert.deepEqual(api.split({ start: '2026-10-20', end: '2026-10-20' }, source.replace('media_type=all', 'media_type=video')).map(p => p.platform), ['facebook', 'instagram']);
});
test('TR/EN preflight estimates and zero/no-result text', () => {
  assert.equal(api.parseResults('~6.300 sonuç'), 6300); assert.equal(api.parseResults('About 1,100 results'), 1100); assert.equal(api.parseResults('0 sonuç'), 0); assert.equal(api.parseResults('No ads found'), 0); assert.equal(api.parseResults('Results loading'), null);
});
test('large preflight splits without invoking the scan engine, zero is skipped, foreground tabs only', async () => {
  const h = harness(); await h.service.start({ ...config, unit: 'week', end: '2026-10-07' });
  assert.equal([...h.tabs.values()][0].active, true); await h.loaded(1500);
  assert.equal(h.requests.filter(r => r.type === 'META_SCAN_START').length, 0); assert.equal(h.store.chunkRun.queue.length, 2); assert.equal(h.removed.length, 1);
  await h.next(); await h.loaded(0); assert.equal(h.store.chunkRun.done[0].status, 'empty'); assert.equal(h.requests.filter(r => r.type === 'META_SCAN_START').length, 0);
});
test('shared pool deduplicates across chunks, batches <=25, raw count and overlap warning survive worker recreation', async () => {
  const h = harness({ store: { telegramConfig: { enabled: true, token: 'private', chatId: '123' } } });
  await h.service.start(config); await h.loaded(); h.advance(60000);
  await h.send({ type: 'META_SCAN_APPEND', records: [ad('123456789012'), ad('123456789013')] });
  await h.send({ type: 'META_SCAN_FINISHED', ads: [ad('123456789012'), ad('123456789013')], reason: 'meta-exhausted' });
  assert.equal(h.store.chunkRun.uniqueCount, 2); assert.equal(h.store.chunkRun.rawCount, 2);
  const restored = harness(h); await restored.next(); await restored.loaded(); restored.advance(180000);
  await restored.send({ type: 'META_SCAN_FINISHED', ads: [ad('123456789013'), ad('123456789014')], reason: 'meta-exhausted' });
  const run = h.store.chunkRun; assert.equal(run.uniqueCount, 3); assert.equal(run.rawCount, 4); assert.equal(run.phase, 'done'); assert(run.overlap); assert(run.done[1].slow);
  const view = await restored.service.view({ chunkRun: run, ads: [], scan: {} }); assert.equal(view.ads.length, 3); assert.equal(new Set(view.ads.map(a => a.id)).size, 3);
  assert.deepEqual(Object.keys(AdData.rows(view.ads)[0]), AdData.COLUMNS); assert.equal(AdData.rows(view.ads)[0]['Hook'], 'Diş tedavisinde yeni çözüm.');
  assert(h.writes.filter(w => Object.keys(w).some(k => k.startsWith('chunk-pool:'))).every(w => Object.entries(w).filter(([k]) => k.startsWith('chunk-pool:')).every(([, records]) => records.length <= 25)));
  await restored.service.report(); await restored.service.report(); assert.equal(restored.telegram.length, 1); assert(restored.telegram[0].includes('Toplam benzersiz reklam: 3')); assert(restored.telegram[0].includes('Taranan parça: 2')); assert(!restored.telegram[0].includes('private'));
});
test('unknown estimate scans normally, limit retains results and then splits', async () => {
  const h = harness(); await h.service.start({ ...config, unit: 'week', limit: 2 }); await h.loaded(null);
  assert.equal(h.requests.filter(r => r.type === 'META_SCAN_START').length, 1); await h.send({ type: 'META_SCAN_FINISHED', ads: [ad('123456789012'), ad('123456789013')], reason: 'limit' });
  assert.equal(h.store.chunkRun.uniqueCount, 2); assert.equal(h.store.chunkRun.queue.length, 2); assert.equal(h.store.chunkRun.splits.length, 1);
});
test('exactly two retries with exponential waits; failed part listed and next part continues', async () => {
  const h = harness(); await h.service.start(config);
  for (let attempt = 0; attempt < 3; attempt++) {
    await h.loaded(5); await h.send({ type: 'META_SCAN_FINISHED', ads: [ad('123456789012')], reason: 'meta-exhausted' });
    if (attempt < 2) { assert.equal(h.store.chunkRun.queue[0].attempt, attempt + 1); assert.equal(h.store.chunkRun.nextAt - Date.parse('2026-11-04T12:00:00Z'), attempt === 0 ? 60000 : 180000); }
    await h.next();
  }
  assert.equal(h.store.chunkRun.done[0].status, 'failed'); assert.equal(h.store.chunkRun.active.piece.start, '2026-10-02'); assert.equal(h.store.chunkRun.rawCount, 1); assert.equal(h.store.chunkRun.uniqueCount, 1);
  await h.loaded(0); assert.equal(h.store.chunkRun.phase, 'done'); assert(api.summary(h.store.chunkRun).includes('Başarısız parça: 1'));
});
test('pause checkpoints unfinished piece, resume does not repeat completed pieces or add duplicate IDs', async () => {
  const h = harness(); await h.service.start(config); await h.loaded(1); await h.send({ type: 'META_SCAN_FINISHED', ads: [ad('123456789012')], reason: 'meta-exhausted' }); await h.next(); await h.loaded(1);
  await h.send({ type: 'META_SCAN_APPEND', records: [ad('123456789013')] }); await h.service.pause();
  await assert.rejects(()=>h.service.resume(),/Son reklam paketi/);
  await assert.rejects(()=>h.service.hide(),/Son reklam paketi/);
  await h.send({ type: 'META_SCAN_FINISHED', ads: [ad('123456789013')], reason: 'stopped' });
  assert.equal(h.store.chunkRun.done.length, 1); assert.equal(h.store.chunkRun.queue[0].start, '2026-10-02');
  const restored = harness(h); await restored.service.resume(); await restored.loaded(1); await restored.send({ type: 'META_SCAN_FINISHED', ads: [ad('123456789013')], reason: 'meta-exhausted' });
  assert.equal(h.store.chunkRun.phase, 'done'); assert.equal(h.store.chunkRun.done.length, 2); assert.equal(h.store.chunkRun.uniqueCount, 2); assert.equal(h.store.chunkRun.rawCount, 2);
});
test('browser restart pauses durably and never closes a reused unrelated tab ID', async () => {
  const h = harness(); await h.service.start(config); const id = h.store.chunkRun.active.tabId; h.tabs.set(id, { id, url: 'https://example.org/' });
  await h.service.recover(true); assert.equal(h.store.chunkRun.running, false); assert.equal(h.store.chunkRun.queue.length, 2); assert.equal(h.removed.length, 0);
  await h.service.resume(); assert.equal(h.store.chunkRun.active.piece.start, config.start);
});
test('wrong frame, sender URL and session cannot write pool records', async () => {
  const h = harness(); await h.service.start(config); await h.loaded(); const active = h.store.chunkRun.active;
  for (const sender of [{ tab: { id: active.tabId }, frameId: 1, url: source }, { tab: { id: active.tabId }, frameId: 0, url: 'https://evil.example/' }, { tab: { id: 999 }, frameId: 0, url: source }]) await assert.rejects(() => h.service.content({ type: 'META_SCAN_APPEND', sessionId: active.sessionId, records: [ad('123456789012')] }, sender), /Geçersiz/);
  assert.equal(h.store.chunkRun.uniqueCount, 0);
});
test('worker integration: GET_STATE exposes pooled data, normal mode unaltered, no per-part Telegram/history', async () => {
  const h = harness({}, true);
  assert((await h.command({ type: 'START_CHUNKS', config })).ok); await h.loaded(1);
  const active = h.store.chunkRun.active;
  const send = message => new Promise(resolve => h.events.message.at(-1)({ sessionId: active.sessionId, scrollCount: 0, ...message }, { id: 'test', tab: { id: active.tabId }, frameId: 0, url: h.tabs.get(active.tabId).url }, resolve));
  assert((await send({ type: 'META_SCAN_APPEND', records: [ad('123456789012')] })).ok);
  let result = await h.command({ type: 'GET_STATE' }); assert.equal(result.state.ads.length, 1); assert.equal(h.sessionStore.scanProgress.ads, 1); assert.equal(h.sessionStore.scanProgress.status, 'scanning');
  assert((await send({ type: 'META_SCAN_FINISHED', ads: [ad('123456789012')], reason: 'meta-exhausted' })).ok);
  assert.equal(h.store.history?.length || 0, 0); assert.equal(h.store.telegramOutbox?.length || 0, 0);
  assert((await h.command({ type: 'STOP_SCAN' })).ok); result = await h.command({ type: 'GET_STATE' }); assert.equal(result.state.chunkRun.running, false); assert.equal(result.state.ads.length, 1);
  assert((await h.command({ type: 'CLEAR_RESULTS' })).ok); result = await h.command({ type: 'GET_STATE' }); assert.equal(result.state.chunkRun, null); assert.equal(result.state.ads.length, 0);
});
test('unsplittable one-day platform leaves are failed, do not loop or silently claim full coverage', async () => {
  const h = harness(); await h.service.start({ ...config, end: config.start, limit: 1 });
  for (let i = 0; h.store.chunkRun.running && i < 10; i++) { await h.loaded(100); if (h.store.chunkRun.running) await h.next(); }
  assert.equal(h.store.chunkRun.phase, 'done'); assert.equal(h.store.chunkRun.done.length, 4); assert(h.store.chunkRun.done.every(item => item.status === 'failed'));
  assert.equal(h.store.chunkRun.splits.length, 3); assert.equal(h.requests.filter(r => r.type === 'META_SCAN_START').length, 0);
});
test('start needs no existing date fields and reads the explicit source tab when supplied', async () => {
  const h=harness({url:'https://www.facebook.com/ads/library/?q=implant&sort_data[mode]=total_impressions'});
  await h.service.start(config);assert.equal(new URL([...h.tabs.values()][0].url).searchParams.get('start_date[min]'),config.start);
  assert.equal(h.store.chunkRun.firstUrl,[...h.tabs.values()][0].url);
  const other=harness();other.tabs.set(77,{id:77,url:'https://www.facebook.com/ads/library/?q=correct-window&country=TR'});await other.service.start(config,77);
  assert.equal(new URL([...other.tabs.values()].at(-1).url).searchParams.get('q'),'correct-window');
  const bad=harness({url:'https://example.org/',store:{ads:[ad('123456789012')]}});await assert.rejects(()=>bad.service.start(config),/Önce Meta Reklam Kütüphanesi sonuç sayfasını aç, sonra başlat/);assert.equal(bad.store.ads.length,1);
  await assert.rejects(()=>bad.service.start(config,999),/sekme bulunamadı/);
});
test('display order is saved independently of extraction order and retained with the first piece',async()=>{
  const h=harness();await h.service.start(config);await h.loaded(2);
  h.setOrder(['123456789013','123456789012']);await h.send({type:'META_SCAN_APPEND',records:[ad('123456789012'),ad('123456789013')]});
  let view=await h.service.view({chunkRun:h.store.chunkRun,ads:[],scan:{}});assert.equal(view.ads.find(ad=>ad.id==='123456789012').chunkRank,2);assert.equal(view.ads[0].chunkPiece,'2026-10-01');
  h.setOrder(['123456789014','123456789013','123456789012']);await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789012'),ad('123456789013'),ad('123456789014')],reason:'meta-exhausted'});
  view=await h.service.view({chunkRun:h.store.chunkRun,ads:[],scan:{}});assert.equal(view.ads.find(ad=>ad.id==='123456789012').chunkRank,3);
});
test('pool writes are append-only 25-record batches and a failed batch preserves acknowledged data for resume', async () => {
  const h = harness(); await h.service.start(config); await h.loaded(100);
  const first = Array.from({ length: 25 }, (_, i) => ad('1234567890' + String(i).padStart(3, '0')));
  await h.send({ type: 'META_SCAN_APPEND', records: first }); const keys = [...h.store.chunkRun.poolKeys]; h.failPoolOnce();
  await assert.rejects(() => h.send({ type: 'META_SCAN_APPEND', records: [ad('1234567890999')] }), /kaydedilemedi/);
  assert.equal(h.store.chunkRun.running, false); assert.equal(h.store.chunkRun.uniqueCount, 25); assert.deepEqual(h.store.chunkRun.poolKeys, keys);
  const data = await h.service.view({ chunkRun: h.store.chunkRun, ads: [], scan: {} }); assert.equal(data.ads.length, 25);
  assert(h.writes.filter(w => Object.keys(w).some(k => k.startsWith('chunk-pool:'))).every(w => !('ads' in w)));
  await h.service.resume(); assert.equal(h.store.chunkRun.active.piece.start, config.start);
});
test('loading timeout retries twice then records failure and advances', async () => {
  const h = harness(); await h.service.start(config);
  for (let i = 0; i < 3; i++) {
    h.advance(45001); for (const handler of h.events.alarm) handler({ name: 'chunk-timeout' }); await h.idle(); await h.next();
  }
  assert.equal(h.store.chunkRun.done[0].status, 'failed'); assert.equal(h.store.chunkRun.active.piece.start, '2026-10-02'); assert.equal(h.requests.filter(r => r.type === 'META_SCAN_START').length, 0);
});
test('with the manager loaded, default START_SCAN retains normal ownership, history and export schema', async () => {
  const h = harness({}, true);
  const response = await h.command({ type: 'START_SCAN', settings: { autoScroll: false, speed: 'medium', maxAds: 100 } }); assert(response.ok);
  assert.equal(h.store.chunkRun, undefined); assert.equal(h.tabs.size, 0); assert.equal(h.store.scan.running, true);
  const state = await h.command({ type: 'GET_STATE' }); assert.equal(state.state.scan.running, true);
  const sessionId = h.store.scan.sessionId;
  const finished = await new Promise(resolve => h.events.message.at(-1)({ type: 'META_SCAN_FINISHED', sessionId, scrollCount: 0, ads: [ad('123456789012')], reason: 'visible-complete' }, { id: 'test', tab: { id: 7 }, frameId: 0, url: source }, resolve));
  assert(finished.ok); assert.equal(h.store.history.length, 1); assert.equal(h.store.ads.length, 1); assert.deepEqual(Object.keys(AdData.rows(h.store.ads)[0]), AdData.COLUMNS);
});
