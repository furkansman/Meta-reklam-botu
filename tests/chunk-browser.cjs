const { chromium } = require('playwright');
const fs = require('node:fs'), http = require('node:http'), vm = require('node:vm'), assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto'), path = require('node:path');
const ChunkScan = require('../chunk-scan.js'), AdData = require('../ad-data.js'), CompetitorWatch = require('../competitor.js');
const root = path.resolve(__dirname, '..');
(async () => {
  const files = ['popup.html', 'popup.css', 'popup.js', 'chunk-popup.js', 'chunk-scan.js', 'chunk-export.js', 'sidepanel-launch.js', 'sidepanel.html', 'sidepanel.js', 'sidepanel.css', 'ad-data.js', 'xlsx.js'];
  const server = http.createServer((req, res) => {
    const file = req.url === '/' ? 'popup.html' : req.url.slice(1);
    if (!files.includes(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(root, file)));
  }).listen(0, '127.0.0.1');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const windows=new Map();let createdWindows=0;const panels=[];
    const store = { telegramConfig: { enabled: true, token: 'fake-test-token', chatId: '123' } }, session = {}, tabs = new Map(), pages = [], events = {}, telegram = [], starts = [], opened = [];
    let queryResult=null;
    let nextId = 20, activeId = 7, clock = Date.now(), listener, worker, service;
    const source = 'https://www.facebook.com/ads/library/?q=%22implant%22&country=TR&active_status=active&search_type=keyword_exact_phrase&sort_data[mode]=total_impressions&sort_data[direction]=desc';
    const fixture = url => {
      const second = new URL(url).searchParams.get('start_date[min]') === '2026-10-02';
      const ids = second ? ['123456789012', '123456789013'] : ['123456789011', '123456789012'];
      return '<main><p>~2 sonuç</p>' + ids.map(id => `<div><span>Library ID: ${id}</span><div><b>Dental Marka</b><span>Sponsored</span></div><p>Diş tedavisinde yeni çözüm.</p><p>Started running on 1 September 2026</p><p>İmplant fırsatı</p><button>Get Quote</button><button>See ad details</button></div>`).join('') + '</main>';
    };
    const context = await browser.newContext({ acceptDownloads: true });
    await context.route('https://www.facebook.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(route.request().url()) }));
    const sourcePage = await context.newPage(); await sourcePage.goto(source); tabs.set(7, { id: 7, url: source, status: 'complete', page: sourcePage });
    const event = name => ({ addListener(fn) { (events[name] ||= []).push(fn); if (name === 'message') listener = fn; } });
    const send = (message, sender) => new Promise(resolve => listener(message, sender, resolve));
    async function changed(values, area) {
      const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]));
      for (const page of pages) if (!page.isClosed()) await page.evaluate(({ changes, area }) => window.changeListener?.(changes, area), { changes, area }).catch(() => {});
    }
    const chrome = {
      windows:{async create(value){const id=100+createdWindows++;const window={id,...value,tabs:[{id:100000+id,url:value.url}]};windows.set(id,window);return window;},async get(id){if(!windows.has(id))throw new Error('Closed window');return windows.get(id);},async getAll(){return [...windows.values()];},async update(id,value){Object.assign(windows.get(id),value);return windows.get(id);},onRemoved:event('windowRemoved')},
      sidePanel:{async setPanelBehavior(value){assert.equal(value.openPanelOnActionClick,false);},async open(value){panels.push(value);}},
      action:{async setBadgeText(){},async setBadgeBackgroundColor(){}},
      runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed'), async sendMessage(msg) { for (const page of pages) if (!page.isClosed()) await page.evaluate(msg => window.progressListener?.(msg, { id: 'test' }), msg).catch(() => {}); } },
      storage: Object.fromEntries(['local', 'session'].map(area => [area, {
        async setAccessLevel() {}, async get(keys) { if (typeof keys === 'string') keys = [keys]; const data = area === 'local' ? store : session; return structuredClone(Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]]))); },
        async set(values) { Object.assign(area === 'local' ? store : session, structuredClone(values)); setImmediate(() => { void changed(values, area); }); },
        async remove(keys) { for (const key of keys) delete (area === 'local' ? store : session)[key]; }
      }])),
      tabs: {
        async query() { return queryResult ?? [{ id: activeId, url: tabs.get(activeId)?.url }]; }, async get(id) { const tab = tabs.get(id); if (!tab) throw Error('Closed'); return {id:tab.id,windowId:tab.windowId,url:tab.url,status:tab.status}; },
        async create(value) {
          assert.equal(value.active, true);assert.equal(value.windowId,100); opened.push(value); const id = nextId++, page = await context.newPage(); activeId = id;
          await page.exposeFunction('runtimeSend', msg => send(msg, { id: 'test', tab: { id }, frameId: 0, url: page.url() }));
          await page.exposeFunction('sessionSet', value => chrome.storage.session.set(value));
          await page.addInitScript(() => {
            const native = window.setTimeout; window.setTimeout = (fn, ms) => native(fn, Math.min(ms, 10));
            window.collectors=[];window.chrome = { runtime: { id: 'test', sendMessage: runtimeSend, onMessage: { addListener(fn) { window.collectors.push(fn); } } }, storage: { session: { set: sessionSet } } };
          });
          await page.goto(value.url); await page.bringToFront(); tabs.set(id, {id,windowId:value.windowId,url:value.url,status:'complete',page});
          for(const file of ['ad-data.js','scan-loop.js','content.js','chunk-bridge.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
          return { id, url: value.url, status: 'complete' };
        },
        async sendMessage(id, msg) {
          if (msg.type === 'META_SCAN_START') starts.push(msg);
          const tab = tabs.get(id); if (!tab) throw Error('Closed');
          return tab.page.evaluate(msg => new Promise((resolve,reject) => {if(!window.collectors?.length){reject(new Error('Collector not installed'));return;}for(const fn of window.collectors)fn(msg,{id:'test'},resolve);}), msg);
        },
        async remove(id) { const tab = tabs.get(id); tabs.delete(id); await tab?.page.close(); for (const handler of events.removed || []) handler(id); },
        onUpdated: event('updated'), onRemoved: event('removed')
      },
      scripting: { async executeScript(input) {
        const page = tabs.get(input.target.tabId).page;
        if (input.files) { for (const file of input.files) await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), 'utf8') }); return []; }
        return [{ result: await page.evaluate(input.func) }];
      } },
      alarms: { async create() {}, async clear() {}, onAlarm: event('alarm') },
      notifications: { async create() {}, async clear() {}, onButtonClicked: event('notification') }
    };
    worker = { chrome, AdData, CompetitorWatch, ChunkScan: { create(chrome, hooks) { service = ChunkScan.create(chrome, { ...hooks, now: () => clock, random: () => .5 }); return service; } }, crypto: webcrypto, URL, Date, AbortSignal, console, setTimeout, clearTimeout, fetch: async (url, options) => { telegram.push(JSON.parse(options.body)); return { ok: true, async json() { return { ok: true }; } }; } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), worker);
    const errors = [];
    async function openPopup() {
      const popup = await context.newPage(); pages.push(popup); popup.on('pageerror', error => errors.push(error.message));
      await popup.exposeFunction('runtimeSend', msg => send(msg, { id: 'test', url: 'chrome-extension://test/popup.html' }));
      await popup.exposeFunction('localGet', keys => chrome.storage.local.get(keys)); await popup.exposeFunction('localSet', values => chrome.storage.local.set(values)); await popup.exposeFunction('sessionGet', keys => chrome.storage.session.get(keys));await popup.exposeFunction('tabsQuery', query=>chrome.tabs.query(query));await popup.exposeFunction('panelOpen',value=>chrome.sidePanel.open(value));
      await popup.addInitScript(() => { window.chrome = { windows:{getCurrent:async()=>({id:7})},sidePanel:{open:panelOpen},tabs:{query:tabsQuery}, runtime: { id: 'test', sendMessage: runtimeSend, onMessage: { addListener(fn) { window.progressListener = fn; } } }, storage: { local: { get: localGet, set: localSet }, session: { get: sessionGet }, onChanged: { addListener(fn) { window.changeListener = fn; } } } }; });
      await popup.goto(`http://127.0.0.1:${server.address().port}/`); await popup.waitForFunction(() => !document.querySelector('#start-scan').disabled || document.querySelector('#scan-dot').classList.contains('scanning')); return popup;
    }
    const until = async predicate => { for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Timed out: ' + JSON.stringify(store.chunkRun)); };
    const panel=await context.newPage();panel.on('pageerror',error=>errors.push(error.message));await panel.setViewportSize({width:360,height:720});
    await panel.exposeFunction('localGet',keys=>chrome.storage.local.get(keys));await panel.exposeFunction('sessionGet',keys=>chrome.storage.session.get(keys));
    await panel.addInitScript(()=>{window.chrome={storage:{local:{get:localGet},session:{get:sessionGet}}};});await panel.goto(`http://127.0.0.1:${server.address().port}/sidepanel.html`);
    let popup = await openPopup();
    assert.equal(await popup.locator('#chunk-start').inputValue(), '2020-09-01'); assert.equal(await popup.locator('#chunk-end').inputValue(), ChunkScan.today());
    assert.equal(await popup.locator('#chunk-unit').inputValue(), 'week'); assert.equal(await popup.locator('#chunk-limit').inputValue(), '800'); assert(await popup.locator('#chunk-fields').isHidden());
    await popup.click('#open-side-panel');assert.deepEqual(panels,[{windowId:7}]);
    await popup.check('#chunk-enabled'); await popup.getByRole('button', { name: 'Son 14 gün', exact: true }).click(); assert.equal(Date.parse(await popup.locator('#chunk-end').inputValue()) - Date.parse(await popup.locator('#chunk-start').inputValue()), 13 * 86400000);
    await popup.getByRole('button', { name: 'Tüm zamanlar', exact: true }).click(); assert.equal(await popup.locator('#chunk-start').inputValue(), '2020-09-01');
    queryResult=[];await popup.click('#chunk-start-button');await popup.waitForFunction(()=>document.querySelector('#chunk-feedback').textContent.includes('sekme bulunamadı'));assert.equal(store.chunkRun,undefined);
    queryResult=[{id:7,url:'https://example.org/'}];await popup.click('#chunk-start-button');await popup.waitForFunction(()=>document.querySelector('#chunk-feedback').textContent==='Önce Meta Reklam Kütüphanesi sonuç sayfasını aç, sonra başlat.');assert.equal(store.chunkRun,undefined);
    queryResult=null;
    await popup.fill('#chunk-start', '2026-10-01'); await popup.fill('#chunk-end', '2026-10-02'); await popup.selectOption('#chunk-unit', 'day');
    await popup.click('#chunk-start-button'); await until(() => store.chunkRun?.done.length === 1 && !store.chunkRun.active);
    assert.equal(store.chunkRun.uniqueCount, 2); assert.equal(store.chunkRun.rawCount, 2); assert.equal(telegram.length, 0); assert.equal(store.history?.length || 0, 0);
    await panel.waitForFunction(()=>document.querySelector('#panel-ads').textContent==='2');assert((await panel.locator('#panel-events li').count())>0);
    await popup.close();assert(!panel.isClosed()); await worker.enqueue(() => service.recover(true));
    assert.equal(store.chunkRun.running,true);await worker.enqueue(()=>service.pause());
    assert.equal(store.chunkRun.running, false); assert.equal(store.chunkRun.queue.length, 1);
    popup = await openPopup(); await popup.waitForFunction(() => document.querySelector('#ad-count').textContent === '2'); assert(!(await popup.locator('#resume-scan').isDisabled()));
    await popup.click('#resume-scan'); await until(() => store.chunkRun?.phase === 'done');
    await panel.waitForFunction(()=>document.querySelector('#panel-ads').textContent==='3');assert((await panel.locator('#panel-progress').innerText()).includes('toplam benzersiz 3'));
    await popup.waitForFunction(() => document.querySelector('#ad-count').textContent === '3' && !document.querySelector('#export-csv').disabled);
    assert((await popup.locator('#chunk-url-diagnostics').innerText()).includes('Okunan adres (?): q=%22implant%22'));assert((await popup.locator('#chunk-url-diagnostics').innerText()).includes('İlk parça adresi: https://www.facebook.com/ads/library/'));assert.equal(createdWindows,1);assert.equal(opened.length, 2); assert.equal(starts.length, 2); assert(starts.every(msg => msg.settings.maxAds === 800 && msg.settings.autoRefresh === false));
    assert.equal(store.chunkRun.rawCount, 4); assert.equal(store.chunkRun.uniqueCount, 3); assert.equal(store.chunkRun.done.length, 2); assert(store.chunkRun.overlap);
    assert((await popup.locator('#chunk-progress').innerText()).includes('sonuç ~2'));assert((await popup.locator('#chunk-progress').innerText()).includes('toplam benzersiz 3')); assert((await popup.locator('#chunk-progress').innerText()).includes('ham: 4')); assert((await popup.locator('#scan-diagnostics').innerText()).includes(ChunkScan.OVERLAP));
    assert.equal(await popup.getByRole('tab').count(), 4); assert.equal(await popup.locator('.live-counter').count(), 2);
    for (const format of ['csv', 'json', 'excel']) {
      const pending = popup.waitForEvent('download'); await popup.click('#export-' + format); const download = await pending; const data = fs.readFileSync(await download.path());
      if (format === 'json') { const rows = JSON.parse(data.toString()); assert.equal(rows.length, 3); assert.deepEqual(Object.keys(rows[0]), [...AdData.COLUMNS,'Sıra (gösterim sıralaması)','Parça (tarih aralığı)']);assert.equal(rows[0]['Sıra (gösterim sıralaması)'],1);assert.equal(rows[0]['Parça (tarih aralığı)'],'2026-10-01'); }
      if (format === 'csv') { assert(data.subarray(0, 3).equals(Buffer.from([239, 187, 191]))); assert(data.toString().includes('"Reklam ID","Reklam Veren","Hook"')); assert(data.toString().includes('123456789013')); }
      if (format === 'excel') { assert.equal(data.subarray(0, 2).toString(), 'PK'); assert(data.includes(Buffer.from('Reklamlar'))); assert(download.suggestedFilename().endsWith('.xlsx'));assert(data.includes(Buffer.from('Sıra (gösterim sıralaması)')));assert(data.includes(Buffer.from('A1:M4'))); }
    }
    await worker.enqueue(() => service.report()); await worker.enqueue(() => service.report()); assert.equal(telegram.length, 1); assert(telegram[0].text.includes('Toplam benzersiz reklam: 3')); assert(telegram[0].text.includes('Taranan parça: 2')); assert.deepEqual(errors, []);
    console.log('PASS: unchanged content.js scans two foreground date chunks, durable resume after popup/browser restart, raw 4 / unique 3, overlap diagnosis, existing counter IDs and CSV/JSON/XLSX schema, one final Telegram summary.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
