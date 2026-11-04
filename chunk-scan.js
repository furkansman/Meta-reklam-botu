(function (root) {
  'use strict';
  const DAY = 86400000, NEXT = 'chunk-next', TIMEOUT = 'chunk-timeout', REPORT = 'chunk-report', CLOSE = 'chunk-close-failed', HEARTBEAT = 'chunk-heartbeat';
  const MAX_OPENS=2;
  const LIBRARY_HELP = 'Önce Meta Reklam Kütüphanesi sonuç sayfasını aç, sonra başlat.';
  const OVERLAP = 'Meta filtresi pencerede yayında olan reklamları getiriyor, parçalar çakışabilir';
  const SLOW = 'Hız düştü, sekme öne alınmalı ya da dinlenmeli';
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const iso = time => new Date(time).toISOString().slice(0, 10);
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const library = value => { try { const url = new URL(value); return ['www.facebook.com','facebook.com'].includes(url.hostname) && url.protocol === 'https:' && /^\/ads\/library\/?$/.test(url.pathname); } catch { return false; } };
  function settings(value) {
    if (!date(value?.start) || !date(value?.end) || value.start > value.end || value.start < '2000-01-01' || value.end > today() ||
        !['day', 'week', 'month'].includes(value.unit) || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 10000 ||
        !Number.isInteger(value.waitMin) || !Number.isInteger(value.waitMax) || value.waitMin < 1 || value.waitMax < value.waitMin || value.waitMax > 3600) {
      throw new Error('Parçalı tarama ayarlarını kontrol et: geçerli tarih aralığı, 1–10000 reklam ve 1–3600 saniye bekleme gir.');
    }
    return { start: value.start, end: value.end, unit: value.unit, limit: value.limit, waitMin: value.waitMin, waitMax: value.waitMax };
  }
  const key = piece => [piece.start, piece.end, piece.media || '', piece.platform || ''].join('|');
  const label = piece => `${piece.start}${piece.end !== piece.start ? ' → ' + piece.end : ''}${piece.media ? ' · ' + piece.media : ''}${piece.platform ? ' · ' + piece.platform : ''}`;
  function ranges(config) {
    const parts = [];
    for (let start = config.start; start <= config.end;) {
      const value = new Date(start);
      let next;
      if (config.unit === 'month') {
        const year = value.getUTCFullYear(), month = value.getUTCMonth();
        const day = Math.min(value.getUTCDate(), new Date(Date.UTC(year, month + 2, 0)).getUTCDate());
        next = Date.UTC(year, month + 1, day);
      } else next = value.getTime() + DAY * (config.unit === 'week' ? 7 : 1);
      parts.push({ start, end: iso(Math.min(Date.parse(config.end), next - DAY)), attempt: 0 });
      start = iso(next);
    }
    // Keep a one-day weekly tail in the preceding piece (7 + 8 days, not 7 + 7 + 1).
    if(config.unit==='week' && parts.length>1 && parts.at(-1).start===parts.at(-1).end){const tail=parts.pop();parts.at(-1).end=tail.end;}
    return parts;
  }
  function baseFilters(value) {
    const url = new URL(value), media = url.searchParams.get('media_type');
    const platforms = [...url.searchParams].filter(([name]) => /^publisher_platforms(?:\[.*\])?$/.test(name)).map(([, value]) => value).filter(value => value && value !== 'all');
    return { media: media && media !== 'all' ? media : null, platforms };
  }
  function split(piece, baseUrl) {
    if (piece.start !== piece.end) {
      const mid = Date.parse(piece.start) + Math.floor((Date.parse(piece.end) - Date.parse(piece.start)) / DAY / 2) * DAY;
      return [{ ...piece, end: iso(mid), attempt: 0, seenIds: [] }, { ...piece, start: iso(mid + DAY), attempt: 0, seenIds: [] }];
    }
    const filters = baseFilters(baseUrl);
    if (!piece.media && !filters.media) return ['image', 'video'].map(media => ({ ...piece, media, attempt: 0, seenIds: [] }));
    if (!piece.platform) {
      const allowed = ['facebook', 'instagram'].filter(platform => !filters.platforms.length || filters.platforms.includes(platform));
      if (allowed.length > 1) return allowed.map(platform => ({ ...piece, platform, attempt: 0, seenIds: [] }));
    }
    return [];
  }
  function pieceUrl(base, piece) {
    if(!library(base))throw new Error(LIBRARY_HELP);
    const url = new URL(base);
    url.searchParams.delete('start_date[min]');url.searchParams.delete('start_date[max]');
    url.searchParams.append('start_date[min]', piece.start);url.searchParams.append('start_date[max]', piece.end);
    if (piece.media) url.searchParams.set('media_type', piece.media);
    if (piece.platform) {
      for (const name of [...url.searchParams.keys()]) if (/^publisher_platforms(?:\[.*\])?$/.test(name)) url.searchParams.delete(name);
      url.searchParams.set('publisher_platforms[0]', piece.platform);
    }
    return url.href;
  }
  function parseResults(text) {
    const header=String(text||'').split(/Kütüphane\s+Kodu|Library\s+ID/i)[0];
    const match=header.match(/(?:[~≈]\s*)?(\d+(?:[.,\u00a0 ]\d{3})*)\s*(?:sonuç|results)(?![\p{L}])/iu);
    if(match)return Number(match[1].replace(/\D/g,''));
    return /\bno (?:ads|results) found\b|reklam bulunamadı|sonuç bulunamadı/i.test(header)?0:null;
  }
  // Wait for a loaded page and an explicit result count. Unknown is never zero.
  function probePage() {
    return new Promise(resolve=>{
      let observer,minTimer,maxTimer,done=false;const started=Date.now();
      const finish=result=>{if(done)return;done=true;observer?.disconnect();clearTimeout(minTimer);clearTimeout(maxTimer);removeEventListener('load',check);resolve(result);};
      const check=()=>{
        const loaded=document.readyState==='complete',elapsed=Date.now()-started;
        if(!loaded&&elapsed<25000)return;
        const text=(document.body?.innerText||'').split(/Kütüphane\s+Kodu|Library\s+ID/i)[0];
        const blocked=/temporarily blocked|too many requests|try again later|geçici olarak engell|çok fazla istek|rate limit|hız sınırı|istek sınırı|daha sonra tekrar dene|log in to continue|devam etmek için giriş/i.test(text);
        const match=text.match(/(?:[~≈]\s*)?(\d+(?:[.,\u00a0 ]\d{3})*)\s*(?:sonuç|results)(?![\p{L}])/iu);
        const total=match?Number(match[1].replace(/\D/g,'')):/\bno (?:ads|results) found\b|reklam bulunamadı|sonuç bulunamadı/i.test(text)?0:null;
        if(blocked||total!==null||elapsed>=10000)finish({loaded,blocked,total,url:location.href});
      };
      observer=new MutationObserver(check);observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
      addEventListener('load',check);minTimer=setTimeout(check,10000);maxTimer=setTimeout(check,25000);check();
    });
  }
  function rankPage() {
    const ids=[],seen=new Set(),walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    const pattern=/(Kütüphane\s+Kodu|Library\s+ID)\s*:?\s*(\d{10,})/gi;
    let node;
    while((node=walker.nextNode())){
      if(node.parentElement.closest('script,style,noscript,[hidden],[aria-hidden="true"]')||!/Kütüphane|Library/i.test(node.textContent)||!node.parentElement.getClientRects().length)continue;
      for(let element=node.parentElement;element&&element!==document.body;element=element.parentElement){
        const matches=[...(element.innerText||element.textContent||'').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g,'').matchAll(pattern)];
        if(!matches.length)continue;
        if(new Set(matches.map(match=>match[2])).size!==1)break;
        const id=matches[0][2];if(!seen.has(id)){seen.add(id);ids.push(id);}break;
      }
    }
    return ids;
  }
  function summary(run) {
    const failures = run.done.filter(item => item.status === 'failed');
    const lines = ['Meta Reklam Botu — Parçalı tarama tamamlandı', `Toplam benzersiz reklam: ${run.uniqueCount}`, `Ham reklam: ${run.rawCount}`, `Taranan parça: ${run.scannedParts}`, `Başarısız parça: ${failures.length}`];
    // One Telegram message; the complete list remains in the popup/durable run.
    for (const item of failures) {
      const line = `• ${label(item.piece)}: ${item.error}`;
      if (lines.join('\n').length + line.length > 3700) { lines.push('Diğer başarısız parçalar eklentide listeleniyor.'); break; }
      lines.push(line);
    }
    if (run.overlap) lines.push(OVERLAP);
    return lines.join('\n');
  }
  function create(chrome, hooks) {
    const enqueue = hooks.enqueue, now = hooks.now || Date.now, random = hooks.random || Math.random;
    let cacheId = null, pool = new Map(), cachedKeys = new Set(), locations = new Map(), timer = null, closeTimer=null;
    const read = async () => {
      const run=(await chrome.storage.local.get('chunkRun')).chunkRun;
      if(run){delete run.params;if(!run.openCounts){run.openCounts={};if(run.active)run.openCounts[key(run.active.piece)]=(run.active.piece.attempt||0)+1;for(const piece of run.queue)if(piece.attempt)run.openCounts[key(piece)]=Math.max(run.openCounts[key(piece)]||0,piece.attempt);}}
      return run;
    };
    const save = run => chrome.storage.local.set({ chunkRun: run });
    const sleep=hooks.sleep|| (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    async function log(run,type,reason='',piece=run?.active?.piece||run?.lastPiece||run?.queue?.[0]){
      const {chunkEvents=[]}=await chrome.storage.local.get('chunkEvents');
      const entry={id:crypto.randomUUID(),at:now(),runId:run?.id||null,piece:piece?label(piece):'Genel',type,reason};
      if(run)run.statusText=reason?`${type}: ${reason}`:type;
      await chrome.storage.local.set({chunkEvents:[entry,...chunkEvents].slice(0,100),...(run?{chunkRun:run}:{})});
    }
    async function badge(run){
      if(!chrome.action)return;
      const failed=run.active?.phase==='failure-hold'||run.phase==='failure-hold'||run.stopReason==='durduruldu: pencere kapatıldı'||run.done.some(item=>item.status==='failed');
      const text=failed?'!':run.uniqueCount>=1000?(run.uniqueCount/1000).toFixed(1).replace(/\.0$/,'')+'k':String(run.uniqueCount);
      await chrome.action.setBadgeText({text});await chrome.action.setBadgeBackgroundColor({color:failed?'#c43140':'#2852d9'});
    }
    async function heartbeat(run){if(run.running)await chrome.alarms.create(HEARTBEAT,{periodInMinutes:.5});else await chrome.alarms.clear(HEARTBEAT);}
    async function scanWindow(run){
      const window=await chrome.windows.get(run.windowId,{populate:true});
      if(run.anchorUrl&&Array.isArray(window.tabs)&&!window.tabs.some(tab=>tab.url===run.anchorUrl))throw new Error('Tarama penceresi artık bulunamıyor.');
      return window;
    }
    async function ensureWindow(run){
      if(Number.isInteger(run.windowId)){
        try{await scanWindow(run);await chrome.windows.update(run.windowId,{focused:true,state:'normal'});return;}
        catch{const error=new Error('Tarama penceresi kapatıldı.');error.windowGone=true;throw error;}
      }
      const anchor=chrome.runtime.getURL('sidepanel.html')+'?scan='+run.id;
      const existing=chrome.windows.getAll?await chrome.windows.getAll({populate:true}):[];
      let window=existing.find(window=>window.tabs?.some(tab=>tab.url===anchor));
      if(!window)window=await chrome.windows.create({url:anchor,type:'normal',focused:true});
      run.windowId=window.id;run.anchorUrl=anchor;run.anchorTabId=window.tabs?.[0]?.id??null;
      await log(run,'Tarama penceresi açıldı',`Pencere ${window.id}`);
    }
    async function windowClosed(windowId){
      const run=await read();if(!run||run.windowId!==windowId)return;
      if(run.phase==='done'&&!run.active){run.windowId=null;await log(run,'Tarama penceresi kapatıldı','Tamamlanmış tarama ve rapor korundu.');return;}
      if(run.active){run.queue.unshift({...run.active.piece,seenIds:run.active.seenIds});run.active=null;}
      run.windowId=null;run.running=false;run.phase='paused';run.stopReason='durduruldu: pencere kapatıldı';
      clearTimeout(timer);clearTimeout(closeTimer);
      for(const name of [NEXT,TIMEOUT,CLOSE,HEARTBEAT])await chrome.alarms.clear(name);
      await log(run,'Durduruldu','pencere kapatıldı');await progress(run);
    }
    async function ready(run){
      const active=run.active;
      for(let attempt=1;attempt<=5;attempt++){
        let pong;try{pong=await chrome.tabs.sendMessage(active.tabId,{type:'PING'},{frameId:0});}catch{}
        if(pong?.ok&&pong.ready){await log(run,'Content script hazır',`PING ${attempt}/5`);return true;}
        await log(run,'Content script hazır değil',`PING ${attempt}/5 yanıt vermedi`);
        if(attempt<5)await sleep(1000);
      }
      await log(run,'Content script enjekte ediliyor','Beş PING denemesi sonuçsuz kaldı.');
      await chrome.scripting.executeScript({target:{tabId:active.tabId},files:['ad-data.js','scan-loop.js','content.js','chunk-bridge.js']});
      let pong;try{pong=await chrome.tabs.sendMessage(active.tabId,{type:'PING'},{frameId:0});}catch{}
      await log(run,pong?.ok&&pong.ready?'Content script hazır':'Content script hazır değil','Enjeksiyon sonrası PING');
      return Boolean(pong?.ok&&pong.ready);
    }
    const close = async (tabId, expected = null, windowId=null) => {
      if (!Number.isInteger(tabId)) return;
      // Tab IDs can be reused across browser restarts. Never close an unrelated tab.
      try {
        const tab = await chrome.tabs.get(tabId);
        if (expected && tab.windowId!==windowId) {
          const actual = new URL(tab.url), wanted = new URL(expected);
          const identity=[...wanted.searchParams.keys()].filter(name=>/date/i.test(name)&&date(wanted.searchParams.get(name))).concat(['q','view_all_page_id','country']);
          if(actual.origin!==wanted.origin || actual.pathname.replace(/\/$/,'')!==wanted.pathname.replace(/\/$/,'') || identity.some(name=>wanted.searchParams.has(name)&&actual.searchParams.get(name)!==wanted.searchParams.get(name)))return;
        }
        await chrome.tabs.remove(tabId);return true;
      } catch { return false; }
    };
    async function poolFor(run) {
      if (cacheId !== run.id) { cacheId = run.id; pool = new Map(); cachedKeys = new Set(); locations = new Map(); }
      const missing = run.poolKeys.filter(name => !cachedKeys.has(name));
      if (missing.length) {
        const batches = await chrome.storage.local.get(missing);
        for (const name of missing) { for (const ad of batches[name] || []) {pool.set(ad.id, ad);locations.set(ad.id,name);} cachedKeys.add(name); }
      }
      return pool;
    }
    async function progress(run) {
      await badge(run);
      return hooks.publishProgress({ ads: [], scrollCount: run.scrollCount, scan: { running: run.running, sessionId: run.id, sourceUrl: run.baseUrl, reason: run.phase === 'done' ? 'visible-complete' : run.running ? 'running' : 'stopped' } }, { ads: run.uniqueCount, scrolls: run.scrollCount, status: run.running ? 'scanning' : run.phase === 'done' ? 'completed' : 'stopped', chunk: true });
    }
    async function schedule(run, delay = 0) {
      run.nextAt = now() + delay; await log(run,'Parçalar arası bekleme',`${Math.ceil(delay/1000)} saniye`);
      await chrome.alarms.create(NEXT, { when: run.nextAt });
      clearTimeout(timer);
      // Alarm survives suspension; the timer keeps a 20-second wait accurate while awake.
      if (delay > 0 && delay <= 60000) { timer = setTimeout(() => { void enqueue(next).catch(failSafe); }, delay); timer?.unref?.(); }
      await progress(run);
    }
    const wait = run => (run.config.waitMin + Math.floor(random() * (run.config.waitMax - run.config.waitMin + 1))) * 1000;
    async function view(state) {
      const run = state.chunkRun;
      if (!run?.visible) return state;
      return { ...state, ads: [...(await poolFor(run)).values()], scrollCount: run.scrollCount, scan: { ...state.scan, sourceUrl: run.baseUrl } };
    }
    async function start(config, sourceTabId = null) {
      config = settings(config);
      let stored = await chrome.storage.local.get(['scan', 'chunkRun', 'scanBatches', 'settings']);
      if(stored.chunkRun?.active?.phase==='failure-hold'&&!stored.chunkRun.running){if(now()<stored.chunkRun.active.closeAt)throw new Error('20 saniyelik teşhis süresi tamamlanmalı.');await closeFailed();stored=await chrome.storage.local.get(['scan','chunkRun','scanBatches','settings']);}
      if (stored.scan?.running || stored.chunkRun?.running) throw new Error('Önce çalışan taramayı durdur.');
      let tab;
      try{tab=Number.isInteger(sourceTabId)?await chrome.tabs.get(sourceTabId):(await chrome.tabs.query({active:true,currentWindow:true}))[0];}
      catch{throw new Error('sekme bulunamadı: Aktif sekmenin adresi okunamadı.');}
      if(!Number.isInteger(tab?.id))throw new Error('sekme bulunamadı.');
      if(!library(tab.url))throw new Error(LIBRARY_HELP);
      const run = { id: crypto.randomUUID(), config, baseUrl: tab.url, firstUrl:pieceUrl(tab.url,ranges(config)[0]), visible: true, running: true, phase: 'queued', queue: ranges(config), done: [], splits: [], active: null, poolKeys: [], uniqueCount: 0, rawCount: 0, scrollCount: 0, scannedParts: 0, baselineSpeed: null, overlap: false, startedAt: now(), nextAt: now(), speed: stored.settings?.speed || 'medium' };
      await chrome.storage.local.set({ chunkRun: run, chunkConfig: config, ads: [], scrollCount: 0, scan: { running: false, reason: '', sourceUrl: tab.url }, scanBatches: null });
      const obsolete = [...(stored.chunkRun?.poolKeys || []), ...(stored.scanBatches?.keys || [])];
      if (obsolete.length) await chrome.storage.local.remove(obsolete);
      await log(run,'Parçalı tarama başlatıldı',`${run.queue.length} parça`);await heartbeat(run);await progress(run); await next(); return { ok: true };
    }
    async function next() {
      const run = await read(); if (!run?.running || run.active) return;
      if (run.nextAt > now()) { await chrome.alarms.create(NEXT, { when: run.nextAt }); return; }
      if (!run.queue.length) { await finishRun(run); return; }
      const piece = run.queue.shift();
      run.openCounts??={};
      if(run.done.some(item=>key(item.piece)===key(piece))){await log(run,'Parça atlandı','Bu parça daha önce tamamlandı.',piece);await schedule(run,1);return;}
      if((run.openCounts[key(piece)]||0)>=MAX_OPENS){run.done.push({piece,status:'failed',error:'2/2 sekme açılışı sınırı; üçüncü kez açılmadı.',count:0});await log(run,'Parça başarısız','2/2 sekme açılışı sınırı; üçüncü kez açılmadı.',piece);await schedule(run,1);return;}
      run.openCounts[key(piece)]=(run.openCounts[key(piece)]||0)+1;
      run.active = { piece, sessionId: crypto.randomUUID(), tabId: null, phase: 'creating', deadline: now() + 45000, startedAt: now(), scrolls: 0, count: 0, seenIds: piece.seenIds || [], orderIds:[], total: null };
      run.currentUrl=pieceUrl(run.baseUrl,piece);run.firstUrl??=run.currentUrl;
      run.phase = 'running'; await log(run,'Parça başladı',`Açılış ${run.openCounts[key(piece)]}/2`); await heartbeat(run);await chrome.alarms.create(TIMEOUT, { when: run.active.deadline });
      try {
        await ensureWindow(run);
        const tab = await chrome.tabs.create({windowId:run.windowId,url:pieceUrl(run.baseUrl,piece),active:true});
        run.active.tabId = tab.id; run.active.phase = 'loading'; await log(run,'Sekme açıldı',`Sekme ${tab.id}, pencere ${run.windowId}`); await progress(run);
        if (tab.status === 'complete') await loaded(tab.id);
      } catch(error) {if(error.windowGone){await windowClosed(run.windowId);return;}await retry('Parça sekmesi açılamadı: '+error.message);}
    }
    async function loaded(tabId) {
      let run = await read(), active = run?.active;
      if (!run?.running || active?.tabId !== tabId || active.phase !== 'loading') return;
      const tab=await chrome.tabs.get(tabId).catch(()=>null);if(tab?.status!=='complete')return;
      active.phase = 'probing'; await log(run,'Sayfa yüklendi','Sonuç sayısı bekleniyor (10–25 saniye).');
      try {
        const [probe] = await chrome.scripting.executeScript({ target: { tabId }, func: probePage });
        const result = probe?.result;
        if (!result || result.loaded===false || result.blocked || !library(result.url)) { await retry('Meta sayfası yüklenmedi, erişimi kısıtladı veya giriş istiyor.'); return; }
        active.total = Number.isSafeInteger(result.total) && result.total >= 0 ? result.total : null;
        await log(run,'Sonuç sayısı okundu',active.total===null?'okunamadı; sıfır sayılmadan tarama denenecek':String(active.total));
        if (active.total === 0) { await settle('empty'); return; }
        if (active.total > run.config.limit) { await divide('Meta sonuç sayısı parça sınırını aşıyor.'); return; }
        active.phase='readiness';await save(run);
        if(!await ready(run)){await retry('Content script enjeksiyon sonrası PING yanıtı vermedi.');return;}
        active.phase = 'starting'; active.deadline = now() + 600000; await save(run);
        await chrome.alarms.create(TIMEOUT, { when: active.deadline });
        const response = await chrome.tabs.sendMessage(tabId, { type: 'META_SCAN_START', tabId, sessionId: active.sessionId, settings: { autoScroll: true, autoRefresh: false, speed: run.speed, maxAds: run.config.limit } }, { frameId: 0 });
        if (!response?.ok) throw new Error('Tarama motoru başlatılamadı.');
        active.phase = 'scanning';run.lastError=''; await log(run,'Tarama başladı','Mevcut tarama motoru çalışıyor.'); await progress(run);
      } catch(error) {await retry('Sayfa yüklenmedi veya tarama başlatılamadı: '+error.message);}
    }
    async function append(run, incoming) {
      const map = await poolFor(run), seen = new Set(run.active.seenIds);
      let visibleIds=[];
      try{const [result]=await chrome.scripting.executeScript({target:{tabId:run.active.tabId},func:rankPage});if(Array.isArray(result?.result))visibleIds=result.result.filter(id=>/^\d{10,}$/.test(id));}catch{/* Retain discovery order when the tab has already gone. */}
      const order=run.active.orderIds||[],known=new Set(order);
      for(let i=0;i<visibleIds.length;i++)if(!known.has(visibleIds[i])){
        const next=visibleIds.slice(i+1).find(id=>known.has(id));
        if(next)order.splice(order.indexOf(next),0,visibleIds[i]);else order.push(visibleIds[i]);
        known.add(visibleIds[i]);
      }
      for(const ad of incoming)if(!known.has(ad.id)){known.add(ad.id);order.push(ad.id);}
      run.active.orderIds=order;
      const ranks=new Map(order.map((id,index)=>[id,index+1])),pieceLabel=label(run.active.piece);
      const fresh = [], freshIds = new Set(), updates=new Map();
      for (const ad of incoming) {
        if (!seen.has(ad.id)) { seen.add(ad.id); run.rawCount++; }
        const record={...ad,chunkRank:ranks.get(ad.id),chunkPiece:pieceLabel};
        if (!map.has(ad.id) && !freshIds.has(ad.id)) { fresh.push(record); freshIds.add(ad.id); }
      }
      for(const [id,rank]of ranks){const prior=map.get(id);if(prior?.chunkPiece===pieceLabel&&prior.chunkRank!==rank)updates.set(id,{...prior,chunkRank:rank});}
      run.active.seenIds = [...seen];
      run.active.count = Math.max(run.active.count, seen.size);
      for (let offset = 0; offset < fresh.length; offset += 25) {
        const batch = fresh.slice(offset, offset + 25), name = `chunk-pool:${run.id}:${run.poolKeys.length}`;
        run.poolKeys.push(name); run.uniqueCount += batch.length;
        await chrome.storage.local.set({ [name]: batch, chunkRun: run });
        for (const ad of batch) {map.set(ad.id, ad);locations.set(ad.id,name);} cachedKeys.add(name);
      }
      const keys=[...new Set([...updates.keys()].map(id=>locations.get(id)).filter(Boolean))];
      if(keys.length){const batches=await chrome.storage.local.get(keys);for(const name of keys){const batch=(batches[name]||[]).map(ad=>updates.get(ad.id)||ad);await chrome.storage.local.set({[name]:batch,chunkRun:run});for(const ad of batch)map.set(ad.id,ad);}}
      await save(run);
    }
    async function owns(sender, message) {
      const run = await read();
      return Boolean(sender.tab && run?.active?.tabId === sender.tab.id && run.active.sessionId === message.sessionId);
    }
    async function content(message, sender) {
      const run = await read(), active = run?.active;
      if (!active || !await owns(sender, message) || sender.frameId !== 0 || !library(sender.url) || !['SCAN_PROGRESS', 'META_SCAN_APPEND', 'META_SCAN_PROGRESS', 'META_SCAN_FINISHED'].includes(message.type)) throw new Error('Geçersiz parça mesajı.');
      const incoming = message.type === 'SCAN_PROGRESS' ? [] : message.type === 'META_SCAN_APPEND' ? message.records : message.ads;
      if (!Array.isArray(incoming) || incoming.length > (message.type === 'META_SCAN_APPEND' ? 25 : run.config.limit) || incoming.some(ad => !/^\d{10,}$/.test(ad?.id || ''))) throw new Error('Geçersiz parça reklam verisi.');
      const reportedCount = message.type === 'SCAN_PROGRESS' ? message.ads : incoming.length;
      if (!Number.isInteger(reportedCount) || reportedCount < 0 || reportedCount > run.config.limit) throw new Error('Geçersiz parça sayacı.');
      const scrolls = message.scrolls ?? message.scrollCount ?? active.scrolls;
      if (!Number.isInteger(scrolls) || scrolls < active.scrolls) throw new Error('Geçersiz parça sayacı.');
      run.scrollCount += scrolls - active.scrolls; active.scrolls = scrolls;
      active.count = Math.max(active.count, reportedCount);
      if (Number.isSafeInteger(message.discovery?.reportedTotal)) active.total = message.discovery.reportedTotal;
      try { if (incoming.length) await append(run, incoming); else await save(run); }
      catch { await failSafe(); throw new Error('Parça verileri kaydedilemedi; kaydedilen paketler korundu.'); }
      if(active.phase==='failure-hold')return {ok:true,progress:await progress(run)};
      if (message.type === 'META_SCAN_FINISHED') {
        const dated = incoming.filter(ad => date(ad.startDate)), before = dated.filter(ad => ad.startDate < active.piece.start);
        if (dated.length && before.length / dated.length > 0.25) run.overlap = true;
        active.count = Math.max(active.count, incoming.length);
        active.speed = incoming.length / Math.max((now() - active.startedAt) / 60000, 1 / 60);
        if (incoming.length && run.baselineSpeed === null) run.baselineSpeed = active.speed;
        active.slow = run.baselineSpeed !== null && active.speed < run.baselineSpeed * 0.5;
        await save(run);
        if (!run.running) { await detach(run); return { ok: true, progress: await progress(await read()) }; }
        if (message.reason === 'limit') { run.scannedParts++; await save(run); await divide('Tarama parça sınırına ulaştı.'); }
        else if (!['meta-exhausted', 'visible-complete', 'no-new-ads'].includes(message.reason) || !incoming.length) await retry(`Motor ${message.reason||'bilinmeyen durum'}; ${incoming.length} reklam toplandı, Meta sonucu ${active.total??'okunamadı'}.`);
        else { run.scannedParts++; await save(run); await settle('done'); }
      }
      return { ok: true, progress: await progress(await read()) };
    }
    async function disposeActive(run) {
      const piece=run.active?.piece;run.lastPiece=piece||run.lastPiece;
      const tabId = run.active?.tabId, expected = run.active ? pieceUrl(run.baseUrl, run.active.piece) : null;
      run.active = null; await save(run); await chrome.alarms.clear(TIMEOUT);if(Number.isInteger(tabId)){const closed=await close(tabId,expected,run.windowId);await log(run,closed?'Sekme kapatıldı':'Sekme kapatılamadı',closed?'Parça işlemi tamamlandı.':'Sekme zaten kapalı veya sahipliği doğrulanamadı.',piece);}
    }
    async function detach(run) {
      if (run.active) run.queue.unshift({ ...run.active.piece, seenIds: run.active.seenIds });
      await disposeActive(run); run.phase = 'paused'; await save(run);
    }
    async function settle(status, error = '') {
      const run = await read(), active = run?.active; if (!active) return;
      if(status==='failed'){await retry(error,true);return;}
      await log(run,status==='empty'?'Parça atlandı':'Parça bitti',status==='empty'?'Sayfada açıkça sıfır sonuç gösterildi.':`${active.count} reklam; Meta: ${active.total??'okunamadı'}. Motor: tamamlandı.`);
      run.done.push({ piece: active.piece, status, error, count: active.count, speed: active.speed || 0, slow: active.slow || false, total: active.total });
      run.last = { label: label(active.piece), count: active.count, total:active.total, speed: active.speed || 0, slow: active.slow || false };
      await disposeActive(run);
      if (run.queue.length) await schedule(run, wait(run)); else await finishRun(run);
    }
    async function divide(reason) {
      const run = await read(), active = run?.active; if (!active) return;
      const children = split(active.piece, run.baseUrl);
      if (!children.length) { await settle('failed', '1 günlük medya/platform parçası da sınırı aşıyor; kısmi veriler korundu.'); return; }
      await log(run,'Parça atlandı',reason+' Daha küçük alt parçalar kuyruğa eklendi.');
      run.splits.push({ piece: active.piece, reason }); run.queue.unshift(...children);
      await disposeActive(run); await schedule(run, wait(run));
    }
    async function retry(error,terminal=false) {
      const run=await read(),active=run?.active;if(!active||active.phase==='failure-hold')return;
      if(!run.running){await detach(run);return;}
      const opens=run.openCounts?.[key(active.piece)]??(active.piece.attempt||0)+1;
      active.failure={error,retry:!terminal&&opens<MAX_OPENS,opens,waitMs:wait(run)*2**opens};
      active.phase='failure-hold';active.closeAt=now()+20000;run.phase='failure-hold';run.lastError=error;
      await log(run,'Parça başarısız',`${error} Sekme teşhis için 20 saniye açık tutuluyor.`);
      await chrome.alarms.create(CLOSE,{when:active.closeAt});clearTimeout(closeTimer);
      closeTimer=setTimeout(()=>{void enqueue(closeFailed).catch(failSafe);},20000);closeTimer?.unref?.();
      await progress(run);
      await chrome.tabs.sendMessage(active.tabId,{type:'META_SCAN_STOP',sessionId:active.sessionId},{frameId:0}).catch(()=>{});
    }
    async function closeFailed(){
      const run=await read(),active=run?.active;if(active?.phase!=='failure-hold')return;
      if(now()<active.closeAt){await chrome.alarms.create(CLOSE,{when:active.closeAt});clearTimeout(closeTimer);closeTimer=setTimeout(()=>{void enqueue(closeFailed).catch(failSafe);},active.closeAt-now());closeTimer?.unref?.();return;}
      const failure=active.failure;run.last={label:label(active.piece),count:active.count,total:active.total,speed:active.speed||0,slow:active.slow||false};
      if(failure.retry){run.queue.unshift({...active.piece,attempt:failure.opens,seenIds:active.seenIds});await log(run,'Yeniden deneme 1/2',failure.error);}
      else{run.done.push({piece:active.piece,status:'failed',error:failure.error,count:active.count,total:active.total});await log(run,'Parça başarısız',failure.error+' Açılış sınırı doldu veya parça bölünemiyor; sonraki parçaya geçiliyor.');}
      await log(run,'Sekme kapatılıyor','20 saniyelik teşhis süresi tamamlandı.');
      await disposeActive(run);await chrome.alarms.clear(CLOSE);run.phase=run.running?'queued':'paused';
      if(!run.running){await save(run);await progress(run);return;}
      if(run.queue.length)await schedule(run,failure.retry?failure.waitMs:wait(run));else await finishRun(run);
    }
    async function finishRun(run) {
      run.running = false; run.phase = 'done'; run.finishedAt = now();await log(run,'Tüm parçalar tamamlandı',`${run.uniqueCount} benzersiz reklam; ${run.done.filter(item=>item.status==='failed').length} başarısız parça`);await heartbeat(run);
      const { telegramConfig } = await chrome.storage.local.get('telegramConfig');
      run.notification = telegramConfig?.enabled ? { status: 'queued', attempts: 0, nextAt: now(), text: summary(run) } : { status: 'disabled' };
      await save(run); clearTimeout(timer); await chrome.alarms.clear(NEXT); await progress(run);
      if (run.notification.status === 'queued') await chrome.alarms.create(REPORT, { when: now() + 100 });
    }
    async function report() {
      const run = await read(), job = run?.notification;
      if (!job || !['queued', 'retrying'].includes(job.status) || job.nextAt > now()) return;
      const { telegramConfig } = await chrome.storage.local.get('telegramConfig');
      if (!telegramConfig?.enabled) { job.status = 'disabled'; await save(run); return; }
      // Durable lease prevents duplicate sends from concurrent alarms/worker wakeups.
      job.nextAt = now() + 60000; await save(run); await chrome.alarms.create(REPORT, { when: job.nextAt });
      try { await hooks.sendTelegram(telegramConfig, job.text); job.status = 'sent'; }
      catch (error) { job.attempts++; job.status = error.retryable && job.attempts < 3 ? 'retrying' : 'failed'; job.error = error.message; }
      await save(run);
      if (job.status === 'retrying') await chrome.alarms.create(REPORT, { when: job.nextAt }); else await chrome.alarms.clear(REPORT);
    }
    async function pause() {
      const run = await read(); if (!run?.running) return { ok: true };
      run.running = false; run.phase = 'paused';await log(run,'Durduruldu','Kullanıcı taramayı durdurdu.');await heartbeat(run); clearTimeout(timer); await chrome.alarms.clear(NEXT); await save(run); await progress(run);
      if(run.active?.phase==='failure-hold')return {ok:true};
      if (run.active) {
        run.active.phase = 'stopping'; await save(run);
        await chrome.alarms.create(TIMEOUT, { when: now() + 5000 });
        try { const response = await chrome.tabs.sendMessage(run.active.tabId, { type: 'META_SCAN_STOP', sessionId: run.active.sessionId }, { frameId: 0 }); if (!response?.ok) await detach(run); }
        catch { await detach(run); }
      }
      return { ok: true };
    }
    async function resume() {
      const run = await read(), { scan } = await chrome.storage.local.get('scan');
      if (!run || run.phase === 'done' || run.running || scan?.running) throw new Error('Devam edilecek durmuş bir parçalı tarama yok.');
      if(run.active?.phase==='stopping')throw new Error('Son reklam paketi kaydediliyor; birkaç saniye sonra Devam Et ile yeniden dene.');
      if(run.active?.phase==='failure-hold'){delete run.stopReason;run.running=true;run.phase='failure-hold';await log(run,'Devam edildi','Teşhis beklemesi sürüyor.');await heartbeat(run);await progress(run);return {ok:true};}
      if (run.active) await detach(run);
      delete run.stopReason;run.lastError='';run.running = true; run.visible = true; run.phase = 'queued'; run.nextAt = now(); await log(run,'Devam edildi','Kalıcı kuyruk yükleniyor.');await heartbeat(run);await progress(run); await next(); return { ok: true };
    }
    async function hide() {
      const run = await read(); if (run?.running) throw new Error('Önce parçalı taramayı durdur.');
      if(run?.active?.phase==='failure-hold')throw new Error('Hatalı sekmenin 20 saniyelik teşhis süresi tamamlanmalı.');
      if(run?.active?.phase==='stopping')throw new Error('Son reklam paketi kaydediliyor; birkaç saniye sonra yeniden dene.');
      if(run?.active)await detach(run);
      if(run){run.visible=false;await save(run);await chrome.action?.setBadgeText({text:''});}
    }
    async function clear() {
      const run = await read(); if (run?.running) throw new Error('Önce parçalı taramayı durdur.');
      if(run?.active?.phase==='failure-hold'&&now()<run.active.closeAt)throw new Error('20 saniyelik teşhis süresi tamamlanmalı.');
      if (run?.active) await disposeActive(run);
      await chrome.storage.local.set({ chunkRun: null }); if (run?.poolKeys.length) await chrome.storage.local.remove(run.poolKeys);
      pool = new Map(); cacheId = null;await chrome.action?.setBadgeText({text:''});
    }
    async function recover() {
      let run=await read();if(!run)return;
      if(Number.isInteger(run.windowId)){
        try{await scanWindow(run);}catch{await windowClosed(run.windowId);return;}
      }
      await heartbeat(run);
      if(run.active?.phase==='failure-hold'){await closeFailed();return;}
      if(run.running&&run.active){
        const active=run.active;
        if(now()>=active.deadline){await retry('Parça yükleme/tarama zaman aşımı.');return;}
        if(!Number.isInteger(active.tabId)&&Number.isInteger(run.windowId)){
          const candidates=await chrome.tabs.query({windowId:run.windowId});
          active.tabId=candidates.find(tab=>tab.url===pieceUrl(run.baseUrl,active.piece))?.id??null;await save(run);
        }
        let tab;try{tab=await chrome.tabs.get(active.tabId);}catch{await retry('Tarama sekmesi bulunamadı.');return;}
        if(tab.status==='loading')return;
        let status;try{status=await chrome.tabs.sendMessage(active.tabId,{type:'META_SCAN_STATUS'},{frameId:0});}catch{}
        if(status?.running&&status.sessionId===active.sessionId){if(active.phase!=='scanning'){active.phase='scanning';await log(run,'Tarama devam ediyor','Worker yeniden bağlandı.');}return;}
        if(active.phase==='scanning'){await retry('Tarama bağlantısı kesildi; aynı parça açılış sınırı korunuyor.');return;}
        active.phase='loading';await log(run,'Worker devam ediyor','Mevcut sekmede yükleme/hazırlık adımı sürdürülüyor.');await loaded(active.tabId);
      }else if(run.running)await next();
      run=await read();if(['queued','retrying'].includes(run.notification?.status))await chrome.alarms.create(REPORT,{when:Math.max(now()+100,run.notification.nextAt)});
    }
    async function failSafe() {
      const run=await read().catch(()=>null);if(!run)return;
      run.running=false;run.phase='paused';run.lastError='Parça yöneticisi durdu; kaydedilen veriler korunuyor. Devam Et ile yeniden dene.';
      if(run.active&&run.active.phase!=='failure-hold'){
        const opens=run.openCounts?.[key(run.active.piece)]||1;
        run.active.phase='failure-hold';run.active.closeAt=now()+20000;
        run.active.failure={error:run.lastError,retry:opens<MAX_OPENS,opens,waitMs:wait(run)*2**opens};
      }
      await log(run,'Yönetici hatası',run.lastError+' Sekme en az 20 saniye açık tutulur.').catch(()=>{});
      await heartbeat(run).catch(()=>{});await progress(run).catch(()=>{});
      if(run.active){
        await chrome.alarms.create(CLOSE,{when:run.active.closeAt}).catch(()=>{});
        clearTimeout(closeTimer);closeTimer=setTimeout(()=>{void enqueue(closeFailed).catch(()=>{});},Math.max(0,run.active.closeAt-now()));closeTimer?.unref?.();
        await chrome.tabs.sendMessage(run.active.tabId,{type:'META_SCAN_STOP',sessionId:run.active.sessionId},{frameId:0}).catch(()=>{});
      }
    }
    chrome.alarms.onAlarm.addListener(info => {
      if (![NEXT,TIMEOUT,REPORT,CLOSE,HEARTBEAT].includes(info.name)) return;
      void enqueue(async () => {
        if(info.name===CLOSE)await closeFailed();
        if(info.name===HEARTBEAT)await recover();
        if (info.name === NEXT) await next();
        if (info.name === REPORT) await report();
        if (info.name === TIMEOUT) {
          const run = await read(); if (!run?.active||run.active.phase==='failure-hold') return;
          if (!run.running) await detach(run); else if (now() >= run.active.deadline) await retry('Parça yükleme/tarama zaman aşımı.');
        }
      }).catch(failSafe);
    });
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      void enqueue(async () => {
        const run = await read(); if (run?.active?.tabId !== tabId) return;
        if (change.status === 'complete') await loaded(tabId);
        if (change.status === 'loading' && ['scanning', 'starting'].includes(run.active.phase)) {
          const tab=await chrome.tabs.get(tabId).catch(()=>null);
          if(tab?.status==='loading')await retry('Meta parça sayfasını yeniden yükledi.');
        }
      }).catch(failSafe);
    });
    chrome.tabs.onRemoved.addListener(tabId => { void enqueue(async () => { const run = await read(); if (run?.active?.tabId === tabId) {if(run.windowId!=null){try{await scanWindow(run);}catch{await windowClosed(run.windowId);return;}}if(run.active.phase==='failure-hold'){await log(run,'Sekme kullanıcı tarafından kapatıldı','Teşhis süresi ve yeniden deneme sınırı korunuyor.');return;}await retry('Parça sekmesi kapandı.');} }).catch(failSafe); });
    chrome.windows.onRemoved.addListener(windowId=>{void enqueue(()=>windowClosed(windowId)).catch(failSafe);});
    if(hooks.autoRecover!==false)void enqueue(recover).catch(failSafe);
    chrome.runtime.onStartup.addListener(() => { void enqueue(() => recover(true)).catch(failSafe); });
    chrome.runtime.onInstalled.addListener(() => { void enqueue(() => recover(false)).catch(failSafe); });
    return { start, next, loaded, log, closeFailed, windowClosed, owns, content, pause, resume, clear, hide, view, progress, recover, report, read };
  }
  const api = { create, ranges, split, pieceUrl, library, settings, label, key, today, parseResults, probePage, rankPage, summary, MAX_OPENS, LIBRARY_HELP, OVERLAP, SLOW };
  root.ChunkScan = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
