const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm'), fs = require('node:fs');
const api = require('../chunk-scan.js'), AdData = require('../ad-data.js');
const source = 'https://www.facebook.com/ads/library/?q=implant&country=TR&active_status=active&media_type=all&start_date[min]=2026-10-01&start_date[max]=2026-10-31';
const config={limit:800,target:null,waitMin:15,waitMax:30};
function harness(shared = {}, worker = false) {
  const store = shared.store || {}, sessionStore = shared.sessionStore || {}, events = {}, alarms = new Map(), tabs = shared.tabs || new Map(), windows=shared.windows||new Map();
  const writes = [], requests = [], probes = [], telegram = [], progress = [], removed = [], sleeps=[];
  let time = Date.parse('2026-11-04T12:00:00Z'), index = 20, queue = Promise.resolve(), runtimeListener, statusRunning = true, poolFailures = 0, rankOrder = [], pingReady=true,injectionReady=false;
  const event = name => ({ addListener(fn) { (events[name] ||= []).push(fn); if (name === 'message') runtimeListener = fn; } });
  const chrome = {
    runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, async sendMessage() {}, onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed') },
    storage: {
      local: { async setAccessLevel() {}, async get(keys) { if (typeof keys === 'string') keys = [keys]; return structuredClone(Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]]))); }, async set(value) { if(poolFailures && Object.keys(value).some(k=>k.startsWith('chunk-pool:'))){poolFailures--;throw new Error('quota');} writes.push(structuredClone(value)); Object.assign(store, structuredClone(value)); }, async remove(keys) { for (const k of keys) delete store[k]; } },
      session: { async setAccessLevel() {}, async get(keys) { if (typeof keys === 'string') keys = [keys]; return structuredClone(Object.fromEntries(keys.filter(k => k in sessionStore).map(k => [k, sessionStore[k]]))); }, async set(value) { Object.assign(sessionStore, structuredClone(value)); } }
    },
    tabs: { async query(query) { return query?.windowId!=null?[...tabs.values()].filter(tab=>tab.windowId===query.windowId):[{ id: 7, url: shared.url || source }]; }, async create(value) { const tab = { ...value, id: index++, status: 'loading' }; tabs.set(tab.id, tab); return tab; }, async get(id) { if (!tabs.has(id)) throw Error('missing'); return tabs.get(id); }, async remove(id) { removed.push(id); tabs.delete(id); }, async sendMessage(id, message) { requests.push({ id, ...message }); if(message.type==='PING')return {ok:true,ready:pingReady};if (message.type === 'META_SCAN_STATUS') return { running: statusRunning, sessionId: store.chunkRun?.active?.sessionId || store.scan?.sessionId, version: '0.9.2' }; return { ok: true }; }, onUpdated: event('updated'), onRemoved: event('removed') },
    windows:{async create(value){const window={id:100+windows.size,...value,tabs:[{id:100000+windows.size,url:value.url}]};windows.set(window.id,window);return window;},async get(id){if(!windows.has(id))throw new Error('closed window');return windows.get(id);},async getAll(){return [...windows.values()];},async update(id,value){Object.assign(windows.get(id),value);return windows.get(id);},onRemoved:event('windowRemoved')},
    action:{async setBadgeText(value){store.badge=value.text;},async setBadgeBackgroundColor(value){store.badgeColor=value.color;}},
    alarms: { async create(name, value) { alarms.set(name, value); }, async clear(name) { alarms.delete(name); }, onAlarm: event('alarm') },
    scripting: { async executeScript(input) { requests.push(input); if(input.files){if(injectionReady&&input.files.includes('chunk-bridge.js'))pingReady=true;return [];} if(input.func?.name==='rankPage')return [{result:rankOrder}];if(input.func?.name==='sortDatesPage')return [{result:shared.dates||Array(20).fill('2026-10-01')}]; const active = store.chunkRun.active; return [{ result: { blocked: false, total: 2, url: tabs.get(active.tabId).url, ...probes.shift() } }]; } },
    notifications: { onButtonClicked: event('button') }
  };
  const enqueue = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  let service, context;
  if (worker) {
    context = { chrome, ChunkScan: api, AdData, crypto: webcrypto, Date, URL, console, AbortSignal, setTimeout, clearTimeout, fetch: async (url, options) => { telegram.push(JSON.parse(options.body)); return { ok: true, async json() { return { ok: true }; } }; } };
    vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../background.js'), 'utf8'), context);
    service = vm.runInNewContext('chunkService', context);
  } else service = api.create(chrome, { enqueue, autoRecover:false,sleep:async ms=>{sleeps.push(ms);},now: () => time, random: () => .5, publishProgress: async (state, override) => { const value = { ...override, status: override.status || 'scanning' }; progress.push(value); return value; }, sendTelegram: async (config, text) => telegram.push(text) });
  const send = async message => { const active = store.chunkRun.active; return service.content({ sessionId: active.sessionId, scrollCount: 0, ...message }, { id: 'test', tab: { id: active.tabId }, frameId: 0, url: tabs.get(active.tabId).url }); };
  return { service, store, sessionStore, tabs, windows, sleeps, alarms, writes, requests, probes, telegram, progress, removed, events, context, chrome,
    send, command: message => new Promise(resolve => runtimeListener(message, { id: 'test', url: 'chrome-extension://test/popup.html' }, resolve)),
    async loaded(total = 2) { tabs.get(store.chunkRun.active.tabId).status='complete';probes.push({ total }); await service.loaded(store.chunkRun.active.tabId); },
    async next() { if(store.chunkRun.active?.phase==='failure-hold'){time=Math.max(time,store.chunkRun.active.closeAt);await service.closeFailed();}time = Math.max(time, store.chunkRun.nextAt); await service.next(); },
    advance(ms) { time += ms; }, async idle() { await queue; }, setStatus(value) { statusRunning = value; }, failPoolOnce(){poolFailures=1;}, setOrder(ids){rankOrder=ids;},setPing(value){pingReady=value;},setInjectionReady(value){injectionReady=value;}
  };
}
const ad = (id, startDate = '2026-10-01') => ({ id: String(id), advertiser: 'Marka', fullText: 'Diş tedavisinde yeni çözüm.', hook: 'Diş tedavisinde yeni çözüm.', headline: 'Teklif', cta: 'Get Quote', startDate, mediaType: 'image', mediaUrl: 'https://example.org/ad.jpg', targetUrl: 'https://example.org/' });

test('cursor URLs retain all filters and sorting, replace encoded max duplicates, first round is dateless',()=>{
 const base=source+'&sort_data[mode]=start_date&sort_data[direction]=desc&extra=a&extra=b&start_date%5Bmax%5D=';
 for(const cursor of [null,'2026-10-20']){const result=new URL(api.pieceUrl(base,{cursor})),expected=new URL(base);expected.searchParams.delete('start_date[max]');if(cursor)expected.searchParams.set('start_date[max]',cursor);assert.deepEqual([...result.searchParams],[...expected.searchParams]);assert.equal(result.searchParams.get('start_date[min]'),'2026-10-01');}
 assert.throws(()=>api.pieceUrl('https://evil.example/',{}),/Önce Meta/);
});
test('settings defaults, cursor minimum, ordering and two-round termination are deterministic',()=>{
 assert.deepEqual(api.settings({}),{limit:800,target:null,waitMin:15,waitMax:30});assert.throws(()=>api.settings({limit:0}));assert.throws(()=>api.settings({target:-1}));
 assert.equal(api.oldest([{startDate:'bad'},{startDate:'2026-10-05'},{startDate:'2026-09-20'}]),'2026-09-20');assert.equal(api.oldest([],null),null);
 assert(api.descending(Array(20).fill('2026-10-01')));assert(!api.descending(Array.from({length:20},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'))));assert(!api.descending([]));
 assert(api.exhausted(['2026-10-01','2026-10-01'],0));assert(!api.exhausted(['2026-10-02','2026-10-01'],0));assert(!api.exhausted(['2026-10-01','2026-10-01'],1));
});
test('dense days use learned platform parameter only and never broaden a selected platform',()=>{
 assert.deepEqual(api.denseParts({cursor:'2026-10-01',round:2},null,source),[]);
 const parts=api.denseParts({cursor:'2026-10-01',round:2},'publisher_platforms[0]',source);assert.deepEqual(parts.map(p=>p.platform),['facebook','instagram','messenger','audience_network']);
 for(const piece of parts)assert.equal(new URL(api.pieceUrl(source,piece)).searchParams.get('publisher_platforms[0]'),piece.platform);
 assert.deepEqual(api.denseParts(parts[0],'publisher_platforms[0]',source),[]);assert.deepEqual(api.denseParts(parts[0],'publisher_platforms[0]',source+'&publisher_platforms[0]=facebook'),[]);
});
test('explicit zero/no-results differs from unknown',()=>{
 assert.equal(api.parseResults('~1.100 sonuç'),1100);assert.equal(api.parseResults('0 results'),0);assert.equal(api.parseResults('No results found'),0);assert.equal(api.parseResults('Loading…'),null);assert.equal(api.parseResults('Library ID: 1234567890\n2 results'),null);
});
test('a zero-result round finishes once, without engine start or retry',async()=>{
 const h=harness();await h.service.start(config);await h.loaded(0);assert.equal(h.store.chunkRun.phase,'done');assert.equal(h.store.chunkRun.done.length,1);assert.equal(h.requests.filter(m=>m.type==='META_SCAN_START').length,0);await h.next();assert.equal(h.tabs.size,0);assert.match(h.store.chunkRun.stopReason,/yeniden deneme yapılmadı/);assert(h.store.chunkEvents.some(e=>e.type==='Tur bitti'));
});
test('unknown count scans; sorted dates checked before motor; wrong order pauses with a visible reason',async()=>{
 const h=harness();await h.service.start(config);await h.loaded(null);assert.equal(h.store.chunkRun.active.phase,'scanning');assert.equal(h.store.chunkRun.active.total,null);
 const bad=harness({dates:Array.from({length:20},(_,i)=>`2026-10-${String(i+1).padStart(2,'0')}`)});await bad.service.start(config);await bad.loaded();assert.equal(bad.store.chunkRun.running,false);assert.match(bad.store.chunkRun.stopReason,/En yeniler/);assert(!bad.requests.some(m=>m.type==='META_SCAN_START'));
});
test('two foreground rounds share deduplicated pool and cursor, final duplicate-only round ends without retry',async()=>{
 const h=harness();await h.service.start({...config,limit:2});await h.loaded(6300);assert.equal(h.store.chunkRun.active.phase,'scanning');
 await h.send({type:'META_SCAN_APPEND',records:[ad('123456789010','2026-10-20'),ad('123456789011','2026-10-19')]});
 await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789010','2026-10-20'),ad('123456789011','2026-10-19')],reason:'limit'});
 assert.equal(h.store.chunkRun.cursor,'2026-10-19');assert.equal(h.store.chunkRun.uniqueCount,2);assert.equal(h.store.chunkRun.queue[0].cursor,'2026-10-19');
 await h.next();await h.loaded(6000);const start=h.requests.filter(m=>m.type==='META_SCAN_START').at(-1);assert.equal(start.resumeAds.length,1);assert.equal(start.settings.maxAds,3);
 await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789011','2026-10-19')],reason:'meta-exhausted'});assert.equal(h.store.chunkRun.phase,'done');assert.equal(h.store.chunkRun.uniqueCount,2);assert.equal(h.store.chunkRun.done.length,2);assert.equal(h.windows.size,1);
});
test('same-day limit without a learned platform logs missing coverage and steps cursor back one day',async()=>{
 const h=harness();await h.service.start({...config,limit:1});await h.loaded();await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789010')],reason:'limit'});await h.next();await h.loaded();await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789011')],reason:'limit'});
 assert.equal(h.store.chunkRun.cursor,'2026-09-30');assert(h.store.chunkEvents.some(e=>/Yoğun gün/.test(e.type)));assert.equal(h.store.chunkRun.queue[0].cursor,'2026-09-30');
});
test('same-day learned platform queue visits all four slices, including empty ones',async()=>{
 const h=harness({store:{cursorPlatformParam:'publisher_platforms[0]'}});await h.service.start({...config,limit:1});await h.loaded();await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789010')],reason:'limit'});await h.next();await h.loaded();await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789011')],reason:'limit'});
 assert.equal(h.store.chunkRun.queue.length,4);assert.deepEqual(h.store.chunkRun.queue.map(p=>p.platform),['facebook','instagram','messenger','audience_network']);
 for(let i=0;i<4;i++){await h.next();await h.loaded(0);assert(h.store.chunkRun.running);}
 assert.equal(h.store.chunkRun.cursor,'2026-09-30');assert.equal(h.store.chunkRun.queue.length,1);assert(!h.store.chunkRun.queue[0].platform);
});
test('target counts only fresh IDs, duplicates never consume quota and every saved batch is <=25',async()=>{
 const h=harness();await h.service.start({...config,limit:800,target:2});await h.loaded();await h.send({type:'META_SCAN_APPEND',records:[ad('123456789010'),ad('123456789010')]});assert.equal(h.store.chunkRun.active.newCount,1);await h.send({type:'META_SCAN_APPEND',records:[ad('123456789011')]});await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789010'),ad('123456789011')],reason:'stopped'});
 assert.equal(h.store.chunkRun.phase,'done');assert.match(h.store.chunkRun.stopReason,/Hedef/);const state=await h.service.view({chunkRun:h.store.chunkRun,scan:{}});assert.equal(state.ads.length,2);assert(h.writes.flatMap(w=>Object.entries(w).filter(([k])=>k.startsWith('chunk-pool:')).map(([,v])=>v)).every(v=>v.length<=25));
});
test('append mode merges normal and previous pools; failure never erases saved ads',async()=>{
 const h=harness({store:{ads:[ad('123456789010')]}});await h.service.start({...config,addPool:true});assert.equal(h.store.chunkRun.uniqueCount,1);await h.loaded();await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789010'),ad('123456789011')],reason:'error'});assert.equal(h.store.chunkRun.running,false);assert.equal(h.store.chunkRun.uniqueCount,2);assert.match(h.store.chunkRun.stopReason,/Motor durdu/);
});
test('network load failures allow at most two opens and retain each failed tab for 20s',async()=>{
 const h=harness();await h.service.start(config);let active=h.store.chunkRun.active;h.tabs.get(active.tabId).status='complete';h.probes.push({loaded:false});await h.service.loaded(active.tabId);assert.equal(h.store.chunkRun.active.phase,'failure-hold');assert.equal(h.removed.length,0);await h.service.closeFailed();assert.equal(h.removed.length,0);
 await h.next();active=h.store.chunkRun.active;h.tabs.get(active.tabId).status='complete';h.probes.push({loaded:false});await h.service.loaded(active.tabId);await h.next();assert.equal(h.store.chunkRun.phase,'done');assert.equal(h.requests.filter(r=>r.func?.name==='probePage').length,2);assert.equal(h.store.chunkRun.done[0].status,'failed');
});
test('PING retries, injection includes lightener, and readiness failure is never reopened automatically',async()=>{
 const h=harness();h.setPing(false);h.setInjectionReady(true);await h.service.start(config);await h.loaded();assert.equal(h.sleeps.length,4);assert(h.requests.some(r=>r.files?.includes('page-lightener.js')));assert.equal(h.store.chunkRun.active.phase,'scanning');
 const bad=harness();bad.setPing(false);await bad.service.start(config);await bad.loaded();assert.equal(bad.store.chunkRun.active.phase,'failure-hold');await bad.next();assert.equal(bad.store.chunkRun.phase,'done');assert.equal(bad.store.chunkRun.done[0].status,'failed');
});
test('pause and worker restart preserve cursor, pool, queue and explicit resume',async()=>{
 const shared={};const h=harness(shared);await h.service.start(config);await h.loaded();await h.send({type:'META_SCAN_APPEND',records:[ad('123456789010')]});await h.service.pause();await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789010')],reason:'stopped'});assert.equal(h.store.chunkRun.phase,'paused');
 const r=harness({store:h.store,tabs:h.tabs,windows:h.windows});await r.service.resume();await r.loaded();assert.equal(r.store.chunkRun.uniqueCount,1);assert(r.requests.find(m=>m.type==='META_SCAN_START').resumeAds.some(a=>a.id==='123456789010'));
});
test('window closure records reason, unauthorized messages rejected and event log bounded',async()=>{
 const h=harness();await h.service.start(config);await h.loaded();await assert.rejects(()=>h.service.content({type:'META_SCAN_APPEND',sessionId:'bad',records:[]},{tab:{id:999},frameId:0,url:source}));for(let i=0;i<110;i++)await h.service.log(await h.service.read(),'test',String(i));assert.equal(h.store.chunkEvents.length,100);await h.service.windowClosed(h.store.chunkRun.windowId);assert.equal(h.store.chunkRun.running,false);assert.match(h.store.chunkRun.stopReason,/pencere kapatıldı/);
});
test('single final Telegram summary remains durable and pool export columns stay unchanged',async()=>{
 const h=harness({store:{telegramConfig:{enabled:true}}});await h.service.start(config);await h.loaded(0);h.advance(1000);await h.service.report();await h.service.report();assert.equal(h.telegram.length,1);assert.match(h.telegram[0],/Tarih imleciyle tarama tamamlandı/);
});
test('exact 20-card ordering threshold accepts 15 and rejects 14 descending/equal checks',()=>{
 const make=rises=>Array.from({length:20},(_,i)=>`2026-10-${String(Math.min(i,rises)+1).padStart(2,'0')}`);
 assert(api.descending(make(5)));assert(!api.descending(make(6)));
});
test('append pool includes normal incremental batches and keeps ID text deduplicated',async()=>{
 const h=harness({store:{ads:[ad('123456789010')],scanBatches:{keys:['scan-batch:one']},'scan-batch:one':[ad('123456789010'),ad('123456789011')]}});await h.service.start(config);assert.equal(h.store.chunkRun.uniqueCount,2);assert.equal(h.store['scan-batch:one'],undefined);const state=await h.service.view({chunkRun:h.store.chunkRun,scan:{}});assert.deepEqual(state.ads.map(a=>a.id),['123456789010','123456789011']);
});
test('saved pool survives storage quota failure and controller failures are never auto-retried',async()=>{
 const h=harness();await h.service.start(config);await h.loaded();await h.send({type:'META_SCAN_APPEND',records:[ad('123456789010')]});h.failPoolOnce();await assert.rejects(()=>h.send({type:'META_SCAN_APPEND',records:[ad('123456789011')]}),/kaydedilemedi/);assert.equal(h.store.chunkRun.running,false);assert.equal(h.store.chunkRun.uniqueCount,1);assert.equal(h.store.chunkRun.active.failure.retry,false);const state=await h.service.view({chunkRun:h.store.chunkRun,scan:{}});assert.equal(state.ads[0].id,'123456789010');
});
test('running worker recovery reattaches without opening another tab or starting motor twice',async()=>{
 const h=harness();await h.service.start(config);await h.loaded();const r=harness({store:h.store,tabs:h.tabs,windows:h.windows});await r.service.recover();assert.equal(r.store.chunkRun.active.phase,'scanning');assert(!r.requests.some(m=>m.type==='META_SCAN_START'));assert.equal(r.tabs.size,1);
});
test('pool clear resets only its stored pool and progress; active jobs cannot be cleared',async()=>{
 const h=harness();await h.service.start(config);await h.loaded();await assert.rejects(()=>h.service.clear(),/Önce/);await h.send({type:'META_SCAN_FINISHED',ads:[ad('123456789010')],reason:'error'});await h.service.clear();assert.equal(h.store.chunkRun,null);assert.equal(h.store.scrollCount,0);assert.equal(h.progress.at(-1).ads,0);assert(!Object.keys(h.store).some(key=>key.startsWith('chunk-pool:')));
});
test('legacy date-window jobs are paused with saved pool accessible for append migration',async()=>{
 const h=harness({store:{chunkRun:{id:'legacy',running:true,phase:'running',visible:true,queue:[],done:[],active:null,poolKeys:['old-pool'],uniqueCount:1,scrollCount:0},'old-pool':[ad('123456789010')]}});const prior=await h.service.read();assert.equal(prior.running,false);assert.match(prior.stopReason,/Eski tarih pencereli/);await h.service.start({...config,addPool:true});assert.equal(h.store.chunkRun.mode,'cursor');assert.equal(h.store.chunkRun.uniqueCount,1);assert.equal(h.store['old-pool'].length,1);assert(h.store.chunkRun.poolKeys.includes('old-pool'));
});
test('unreadable dates do not silently shrink a twenty-card ordering sample',()=>{
 assert(api.descending([...Array(15).fill('2026-10-01'),...Array(5).fill('')]));assert(!api.descending([...Array(14).fill('2026-10-01'),...Array(6).fill('')]));
});
test('appending a second run preserves original export rank and piece of existing ads',async()=>{
 const record={...ad('123456789010'),chunkRank:7,chunkPiece:'Tur 1 · tarihsiz'};
 const h=harness({store:{chunkRun:{id:'previous',mode:'cursor',phase:'done',running:false,visible:true,active:null,queue:[],done:[],poolKeys:['chunk-pool:previous:0'],uniqueCount:1,scrollCount:0},'chunk-pool:previous:0':[record]}});await h.service.start({...config,addPool:true});await h.loaded();h.setOrder([record.id]);await h.send({type:'META_SCAN_FINISHED',ads:[record],reason:'meta-exhausted'});const state=await h.service.view({chunkRun:h.store.chunkRun,scan:{}});assert.equal(state.ads[0].chunkRank,7);assert.equal(state.ads[0].chunkPiece,'Tur 1 · tarihsiz');
});
