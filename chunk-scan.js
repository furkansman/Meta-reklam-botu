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
    const limit=value?.limit??800,target=value?.target===''||value?.target==null?null:value.target,waitMin=value?.waitMin??15,waitMax=value?.waitMax??30;
    if(!Number.isInteger(limit)||limit<1||limit>10000||target!==null&&(!Number.isSafeInteger(target)||target<1)||!Number.isInteger(waitMin)||!Number.isInteger(waitMax)||waitMin<1||waitMax<waitMin||waitMax>3600)throw new Error('Tur ayarlarını kontrol et: 1–10000 yeni reklam, pozitif hedef ve 1–3600 saniye bekleme gir.');
    return {limit,target,waitMin,waitMax};
  }
  const key=piece=>[piece.round,piece.cursor||'',piece.platform||''].join('|');
  const label=piece=>`Tur ${piece.round} · ${piece.cursor||'tarihsiz'}${piece.platform?' · '+piece.platform:''}`;
  function platformKey(value){try{return [...new URL(value).searchParams].find(([name,value])=>/platform/i.test(name)&&['facebook','instagram','messenger','audience_network'].includes(value))?.[0]||null;}catch{return null;}}
  function pieceUrl(base,piece){
    if(!library(base))throw new Error(LIBRARY_HELP);
    const url=new URL(base);url.searchParams.delete('start_date[max]');
    if(piece.cursor)url.searchParams.set('start_date[max]',piece.cursor);
    if(piece.platform&&piece.platformKey){for(const name of [...url.searchParams.keys()])if(name===piece.platformKey||name.replace(/\[.*$/,'')===piece.platformKey.replace(/\[.*$/,''))url.searchParams.delete(name);url.searchParams.set(piece.platformKey,piece.platform);}
    return url.href;
  }
  function oldest(ads,previous=null){let cursor=previous;for(const ad of ads)if(date(ad.startDate)&&(!cursor||ad.startDate<cursor))cursor=ad.startDate;return cursor;}
  function descending(dates){const sample=dates.slice(0,20),valid=sample.filter(date);return valid.length>0&&valid.reduce((n,value,i)=>n+(!i||value<=valid[i-1]?1:0),0)>=Math.ceil(sample.length*.75);}
  function exhausted(history,newCount){return newCount===0&&history.length>=2&&history.at(-1)===history.at(-2);}
  function denseParts(piece,param,base){
    if(!param||piece.platform||platformKey(base))return [];
    return ['facebook','instagram','messenger','audience_network'].map(platform=>({...piece,platform,platformKey:param,attempt:0,seenIds:[]}));
  }
  // Standalone readiness probe; reuses the existing date parser without changing extraction.
  function sortDatesPage(){
    return new Promise(resolve=>{
      let observer,timer,done=false;
      const read=()=>{const dates=[],seen=new Set(),walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
        while((node=walker.nextNode())&&dates.length<20){
          if(!/Kütüphane|Library/i.test(node.textContent)||node.parentElement.closest('script,style,[hidden],[aria-hidden="true"]'))continue;
          let foundId=null,foundDate='';
          for(let card=node.parentElement;card&&card!==document.body;card=card.parentElement){const text=(card.innerText||'').replace(/[\u200B-\u200F]/g,'');const ids=[...text.matchAll(/(?:Kütüphane\s*Kodu|Library\s*ID)\s*:?\s*(\d{10,})/g)];if(new Set(ids.map(m=>m[1])).size>1)break;
            const id=ids[0]?.[1],value=globalThis.AdData?.parseDate(text);if(id)foundId=id;if(id&&value){foundDate=value;break;}
          }
          if(foundId&&!seen.has(foundId)){seen.add(foundId);dates.push(foundDate);}
        }return dates;};
      const finish=()=>{if(done)return;done=true;observer.disconnect();clearTimeout(timer);resolve(read());};
      observer=new MutationObserver(()=>{if(read().filter(Boolean).length>=20)finish();});observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});timer=setTimeout(finish,10000);if(read().filter(Boolean).length>=20)finish();
    });
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
    const lines = ['Meta Reklam Botu — Tarih imleciyle tarama tamamlandı', `Toplam benzersiz reklam: ${run.uniqueCount}`, `Ham reklam: ${run.rawCount}`, `Taranan tur: ${run.scannedParts}`, `Başarısız tur: ${failures.length}`];
    // One Telegram message; the complete list remains in the popup/durable run.
    for (const item of failures) {
      const line = `• ${label(item.piece)}: ${item.error}`;
      if (lines.join('\n').length + line.length > 3700) { lines.push('Diğer başarısız turlar eklentide listeleniyor.'); break; }
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
      if(run&&run.mode!=='cursor'&&(run.running||run.phase!=='paused'||!run.stopReason)){run.running=false;run.phase='paused';run.stopReason='Eski tarih pencereli tarama durduruldu; havuz korunuyor. Yeni bir tarih imleci taraması başlat.';await chrome.storage.local.set({chunkRun:run});}
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
      if(run.active){run.queue.unshift({...run.active.piece,cursor:run.active.piece.platform?run.active.piece.cursor:oldest((await poolFor(run)).values(),run.cursor),seenIds:run.active.seenIds});run.active=null;}
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
      await chrome.scripting.executeScript({target:{tabId:active.tabId},files:['ad-data.js','scan-loop.js','page-lightener.js','content.js','chunk-bridge.js']});
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
      run.nextAt = now() + delay; await log(run,'Turlar arası bekleme',`${Math.ceil(delay/1000)} saniye`);
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
    async function start(configValue, sourceTabId = null) {
      const config = settings(configValue);
      let stored = await chrome.storage.local.get(['scan', 'chunkRun', 'scanBatches', 'settings','ads','cursorPlatformParam']);
      if(stored.chunkRun?.mode!=='cursor')stored.chunkRun=await read();
      if(stored.chunkRun?.active?.phase==='failure-hold'&&!stored.chunkRun.running){if(now()<stored.chunkRun.active.closeAt)throw new Error('20 saniyelik teşhis süresi tamamlanmalı.');await closeFailed();stored=await chrome.storage.local.get(['scan','chunkRun','scanBatches','settings','ads','cursorPlatformParam']);}
      if (stored.scan?.running || stored.chunkRun?.running) throw new Error('Önce çalışan taramayı durdur.');
      if(stored.chunkRun?.active?.phase==='stopping')throw new Error('Son reklam paketi kaydediliyor; birkaç saniye sonra yeniden dene.');
      let tab;
      try{tab=Number.isInteger(sourceTabId)?await chrome.tabs.get(sourceTabId):(await chrome.tabs.query({active:true,currentWindow:true}))[0];}
      catch{throw new Error('sekme bulunamadı: Aktif sekmenin adresi okunamadı.');}
      if(!Number.isInteger(tab?.id))throw new Error('sekme bulunamadı.');
      if(!library(tab.url))throw new Error(LIBRARY_HELP);
      if(stored.chunkRun?.active){await detach(stored.chunkRun);stored.chunkRun=await read();}
      const appendPool=configValue?.addPool!==false,prior=stored.chunkRun;
      const normalKeys=stored.scanBatches?.keys||[];const normalBatches=normalKeys.length?await chrome.storage.local.get(normalKeys):{};
      const priorAds=prior?.poolKeys?.length?[...(await poolFor(prior)).values()]:[];
      const seed=appendPool?[...new Map([...priorAds,...(stored.ads||[]),...normalKeys.flatMap(name=>normalBatches[name]||[])].map(ad=>[ad.id,ad])).values()]:[];
      const run={id:crypto.randomUUID(),mode:'cursor',config,baseUrl:tab.url,firstUrl:pieceUrl(tab.url,{cursor:null}),visible:true,running:true,phase:'queued',queue:[{cursor:null,round:1,attempt:0}],done:[],splits:[],active:null,poolKeys:appendPool?[...(prior?.poolKeys||[])]:[],uniqueCount:appendPool?priorAds.length:0,rawCount:0,scrollCount:0,scannedParts:0,baselineSpeed:null,cursor:null,cursorHistory:[],round:1,platformKey:platformKey(tab.url)||stored.cursorPlatformParam||null,startedAt:now(),nextAt:now(),speed:stored.settings?.speed||'medium'};
      const priorIds=new Set(appendPool?priorAds.map(ad=>ad.id):[]),freshSeed=seed.filter(ad=>!priorIds.has(ad.id));
      for(let i=0;i<freshSeed.length;i+=25){const name=`chunk-pool:${run.id}:${run.poolKeys.length}`,batch=freshSeed.slice(i,i+25);run.poolKeys.push(name);run.uniqueCount+=batch.length;await chrome.storage.local.set({[name]:batch});}
      await chrome.storage.local.set({chunkRun:run,chunkConfig:config,ads:[],scrollCount:0,scan:{running:false,reason:'',sourceUrl:tab.url},scanBatches:null,...(platformKey(tab.url)?{cursorPlatformParam:platformKey(tab.url)}:{})});
      const obsolete=[...(prior?.poolKeys||[]).filter(name=>!run.poolKeys.includes(name)),...(stored.scanBatches?.keys||[])];if(obsolete.length)await chrome.storage.local.remove(obsolete);
      await log(run,'Tarih imleciyle tarama başlatıldı',`Havuz ${run.uniqueCount} reklam; ilk tur tarihsiz. ${run.firstUrl}`);await heartbeat(run);await progress(run);await next();return {ok:true};
    }
    async function next() {
      const run = await read(); if (!run?.running || run.active) return;
      if (run.nextAt > now()) { await chrome.alarms.create(NEXT, { when: run.nextAt }); return; }
      if(run.config.target&&run.uniqueCount>=run.config.target){run.stopReason='Hedef toplam reklam sayısına ulaşıldı.';await finishRun(run);return;}
      if (!run.queue.length) { await finishRun(run); return; }
      const piece = run.queue.shift();
      run.openCounts??={};
      if(run.done.some(item=>key(item.piece)===key(piece))){await log(run,'Tur atlandı','Bu tur daha önce tamamlandı.',piece);await schedule(run,1);return;}
      if((run.openCounts[key(piece)]||0)>=MAX_OPENS){run.done.push({piece,status:'failed',error:'2/2 sekme açılışı sınırı; üçüncü kez açılmadı.',count:0});await log(run,'Tur başarısız','2/2 sekme açılışı sınırı; üçüncü kez açılmadı.',piece);await schedule(run,1);return;}
      run.openCounts[key(piece)]=(run.openCounts[key(piece)]||0)+1;
      run.active = { piece, sessionId: crypto.randomUUID(), tabId: null, phase: 'creating', deadline: now() + 45000, startedAt: now(), scrolls: 0, count: 0,newCount:0,initialUnique:run.uniqueCount,quota:Math.min(run.config.limit,run.config.target?Math.max(0,run.config.target-run.uniqueCount):run.config.limit), seenIds: piece.seenIds || [], orderIds:[], total: null };
      run.round=piece.round;run.currentUrl=pieceUrl(run.baseUrl,piece);run.firstUrl??=run.currentUrl;
      run.phase = 'running'; await log(run,'Tur başladı',`Açılış ${run.openCounts[key(piece)]}/2 · ${run.currentUrl}`); await heartbeat(run);await chrome.alarms.create(TIMEOUT, { when: run.active.deadline });
      try {
        await ensureWindow(run);
        const tab = await chrome.tabs.create({windowId:run.windowId,url:pieceUrl(run.baseUrl,piece),active:true});
        run.active.tabId = tab.id; run.active.phase = 'loading'; await log(run,'Sekme açıldı',`Sekme ${tab.id}, pencere ${run.windowId}`); await progress(run);
        if (tab.status === 'complete') await loaded(tab.id);
      } catch(error) {if(error.windowGone){await windowClosed(run.windowId);return;}await retry('Tur sekmesi açılamadı: '+error.message,false);}
    }
    async function loaded(tabId) {
      let run = await read(), active = run?.active;
      if (!run?.running || active?.tabId !== tabId || active.phase !== 'loading') return;
      const tab=await chrome.tabs.get(tabId).catch(()=>null);if(tab?.status!=='complete')return;
      active.phase = 'probing'; await log(run,'Sayfa yüklendi','Sonuç sayısı bekleniyor (10–25 saniye).');
      try {
        const [probe] = await chrome.scripting.executeScript({ target: { tabId }, func: probePage });
        const result = probe?.result;
        if(!result||result.loaded===false){await retry('Sayfa yüklenmedi (ağ/yükleme hatası).',false);return;}
        if(result.blocked||!library(result.url)){await pauseReason(run,'Meta erişimi kısıtladı veya giriş gerekiyor; kullanıcı müdahalesi gerekli.');return;}
        active.total = Number.isSafeInteger(result.total) && result.total >= 0 ? result.total : null;
        await log(run,'Sonuç sayısı okundu',active.total===null?'okunamadı; sıfır sayılmadan tarama denenecek':String(active.total));
        if (active.total === 0) { await settle('empty'); return; }
        active.phase='readiness';await save(run);
        if(!await ready(run)){await retry('Content script enjeksiyon sonrası PING yanıtı vermedi.');return;}
        const [orderResult]=await chrome.scripting.executeScript({target:{tabId},func:sortDatesPage});
        const dates=Array.isArray(orderResult?.result)?orderResult.result:[];
        if(!dates.some(date)){await pauseReason(run,'İlk kartların başlangıç tarihleri okunamadı; sıralama doğrulanamadı.');return;}
        if(!descending(dates)){await pauseReason(run,"Sıralama 'En yeniler' değil. Sırala menüsünden 'En yeniler'i seç");return;}
        await log(run,'Sıralama doğrulandı',`${dates.length} kart: yeniden eskiye.`);
        const map=await poolFor(run),resumeAds=[...map.values()].filter(ad=>!active.piece.cursor||!date(ad.startDate)||ad.startDate<=active.piece.cursor).slice(0,Math.max(0,10000-active.quota));
        active.seedCount=resumeAds.length;active.engineMax=resumeAds.length+active.quota;
        active.phase='starting';active.deadline=now()+600000;await save(run);await chrome.alarms.create(TIMEOUT,{when:active.deadline});
        const response=await chrome.tabs.sendMessage(tabId,{type:'META_SCAN_START',tabId,sessionId:active.sessionId,resumeAds,settings:{autoScroll:true,autoRefresh:false,speed:run.speed,maxAds:active.engineMax}},{frameId:0});
        if (!response?.ok) throw new Error('Tarama motoru başlatılamadı.');
        active.phase = 'scanning';run.lastError=''; await log(run,'Tarama başladı','Mevcut tarama motoru çalışıyor.'); await progress(run);
      } catch(error) {await pauseReason(run,'Tur hazırlığı başarısız: '+error.message);}
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
      for(const [id,rank]of ranks){const prior=map.get(id);if(prior?.chunkPiece===pieceLabel&&locations.get(id)?.startsWith(`chunk-pool:${run.id}:`)&&prior.chunkRank!==rank)updates.set(id,{...prior,chunkRank:rank});}
      run.active.seenIds = [...seen];
      run.active.count = Math.max(run.active.count, seen.size);
      for (let offset = 0; offset < fresh.length; offset += 25) {
        const batch = fresh.slice(offset, offset + 25), name = `chunk-pool:${run.id}:${run.poolKeys.length}`;
        run.poolKeys.push(name); run.uniqueCount += batch.length;run.active.newCount+=batch.length;
        await chrome.storage.local.set({ [name]: batch, chunkRun: run });
        for (const ad of batch) {map.set(ad.id, ad);locations.set(ad.id,name);} cachedKeys.add(name);
      }
      const keys=[...new Set([...updates.keys()].map(id=>locations.get(id)).filter(Boolean))];
      if(keys.length){const batches=await chrome.storage.local.get(keys);for(const name of keys){const batch=(batches[name]||[]).map(ad=>updates.get(ad.id)||ad);await chrome.storage.local.set({[name]:batch,chunkRun:run});for(const ad of batch)map.set(ad.id,ad);}}
      run.cursor=oldest(map.values(),run.cursor);await save(run);
    }
    async function owns(sender, message) {
      const run = await read();
      return Boolean(sender.tab && run?.mode==='cursor' && run?.active?.tabId === sender.tab.id && run.active.sessionId === message.sessionId);
    }
    async function content(message, sender) {
      const run = await read(), active = run?.active;
      if (!active || !await owns(sender, message) || sender.frameId !== 0 || !library(sender.url) || !['SCAN_PROGRESS', 'META_SCAN_APPEND', 'META_SCAN_PROGRESS', 'META_SCAN_FINISHED'].includes(message.type)) throw new Error('Geçersiz tur mesajı.');
      const incoming = message.type === 'SCAN_PROGRESS' ? [] : message.type === 'META_SCAN_APPEND' ? message.records : message.ads;
      if (!Array.isArray(incoming) || incoming.length > (message.type === 'META_SCAN_APPEND' ? 25 : 10000) || incoming.some(ad => !/^\d{10,}$/.test(ad?.id || ''))) throw new Error('Geçersiz tur reklam verisi.');
      const reportedCount = message.type === 'SCAN_PROGRESS' ? message.ads : incoming.length;
      if (!Number.isInteger(reportedCount) || reportedCount < 0 || reportedCount > (active.engineMax||10000)) throw new Error('Geçersiz tur sayacı.');
      const scrolls = message.scrolls ?? message.scrollCount ?? active.scrolls;
      if (!Number.isInteger(scrolls) || scrolls < active.scrolls) throw new Error('Geçersiz tur sayacı.');
      run.scrollCount += scrolls - active.scrolls; active.scrolls = scrolls;
      active.count = Math.max(active.count, reportedCount);
      if (Number.isSafeInteger(message.discovery?.reportedTotal)) active.total = message.discovery.reportedTotal;
      try { if (incoming.length) await append(run, incoming); else await save(run); }
      catch { await failSafe(); throw new Error('Tur verileri kaydedilemedi; kaydedilen paketler korundu.'); }
      if(active.phase==='scanning'&&active.newCount>=active.quota&&!active.stopRequested){active.stopRequested=true;active.hitLimit=true;await save(run);await chrome.tabs.sendMessage(active.tabId,{type:'META_SCAN_STOP',sessionId:active.sessionId},{frameId:0}).catch(()=>{});}
      if(active.phase==='failure-hold')return {ok:true,progress:await progress(run)};
      if (message.type === 'META_SCAN_FINISHED') {
        active.speed=active.newCount/Math.max((now()-active.startedAt)/60000,1/60);
        active.hitLimit=active.hitLimit||active.newCount>=active.quota;
        await save(run);
        if(!run.running){await detach(run);return {ok:true,progress:await progress(await read())};}
        if(['error','page-changed','extraction-failed','id-unreadable','incomplete-cards','no-cards'].includes(message.reason)&&!active.hitLimit){await pauseReason(run,`Motor durdu: ${message.reason}; ${active.newCount} yeni reklam kaydedildi. Yeniden açılmadı.`);}
        else{run.scannedParts++;await save(run);await settle('done',message.reason||'tamamlandı');}
      }
      return { ok: true, progress: await progress(await read()) };
    }
    async function disposeActive(run) {
      const piece=run.active?.piece;run.lastPiece=piece||run.lastPiece;
      const tabId = run.active?.tabId, expected = run.active ? pieceUrl(run.baseUrl, run.active.piece) : null;
      run.active = null; await save(run); await chrome.alarms.clear(TIMEOUT);if(Number.isInteger(tabId)){const closed=await close(tabId,expected,run.windowId);await log(run,closed?'Sekme kapatıldı':'Sekme kapatılamadı',closed?'Tur işlemi tamamlandı.':'Sekme zaten kapalı veya sahipliği doğrulanamadı.',piece);}
    }
    async function detach(run) {
      if (run.active) run.queue.unshift({ ...run.active.piece,cursor:run.active.piece.platform?run.active.piece.cursor:oldest((await poolFor(run)).values(),run.cursor), seenIds: run.active.seenIds });
      await disposeActive(run); run.phase = 'paused'; await save(run);
    }
    async function pauseReason(run,reason){
      run.running=false;run.phase='paused';run.stopReason=reason;run.lastError=reason;await log(run,'Durduruldu',reason);await heartbeat(run);await progress(run);
      if(run.active){await chrome.tabs.sendMessage(run.active.tabId,{type:'META_SCAN_STOP',sessionId:run.active.sessionId},{frameId:0}).catch(()=>{});}
    }
    async function settle(status,reason=''){
      const run=await read(),active=run?.active;if(!active)return;
      const previous=run.cursor,nextCursor=oldest((await poolFor(run)).values(),previous);
      run.cursor=nextCursor;run.cursorHistory.push(nextCursor);run.cursorHistory=run.cursorHistory.slice(-2);
      const stopEmpty=status==='empty'&&!active.piece.platform,stopStall=!active.piece.platform&&exhausted(run.cursorHistory,active.newCount),stopTarget=run.config.target&&run.uniqueCount>=run.config.target;
      await log(run,'Tur bitti',`${active.newCount} yeni · imleç ${nextCursor||'yok'} · sebep: ${stopEmpty?'sonuç bulunamadı':reason} · ${run.currentUrl}`);
      run.done.push({piece:active.piece,status,count:active.newCount,total:active.total,cursor:nextCursor,reason,speed:active.speed||0});
      run.last={label:label(active.piece),count:active.newCount,total:active.total,speed:active.speed||0};
      if(stopEmpty||stopStall||stopTarget){run.queue=[];run.stopReason=stopEmpty?'Sonuç bulunamadı; yeniden deneme yapılmadı.':stopTarget?'Hedef toplam reklam sayısına ulaşıldı.':'İki turdur imleç ilerlemedi ve yeni reklam yok; sona ulaşıldı.';await disposeActive(run);await finishRun(run);return;}
      if(!nextCursor){await pauseReason(run,'Başlangıç tarihi okunamadığı için tarih imleci hesaplanamadı; veriler korundu.');return;}
      if(active.hitLimit&&nextCursor===active.piece.cursor&&!active.piece.platform){
        const children=denseParts({cursor:nextCursor,round:active.piece.round+1},run.platformKey,run.baseUrl);
        if(children.length){run.queue.unshift(...children);await log(run,'Yoğun gün platformlara bölündü',children.map(p=>p.platform).join(', '));}
        else{run.cursor=iso(Date.parse(nextCursor)-DAY);await log(run,'Yoğun gün: eksik olabilir',`Platform parametresi öğrenilemedi veya arama zaten filtreli; imleç ${run.cursor}.`);}
      }
      if(active.piece.platform&&active.hitLimit)await log(run,'Yoğun gün: eksik olabilir',`${active.piece.cursor} · ${active.piece.platform} tur sınırına ulaştı.`);
      if(active.piece.platform&&!run.queue.length&&run.cursor===active.piece.cursor){run.cursor=iso(Date.parse(run.cursor)-DAY);await log(run,'Yoğun gün: eksik olabilir',`Platform turları tamamlandı; imleç ${run.cursor}.`);}
      if(!run.queue.length)run.queue.push({cursor:run.cursor,round:active.piece.round+1,attempt:0});
      else run.queue=run.queue.map((piece,i)=>({...piece,round:active.piece.round+1+i}));
      await disposeActive(run);await schedule(run,wait(run));
    }
    async function retry(error,terminal=true) {
      const run=await read(),active=run?.active;if(!active||active.phase==='failure-hold')return;
      if(!run.running){await detach(run);return;}
      const opens=run.openCounts?.[key(active.piece)]??(active.piece.attempt||0)+1;
      active.failure={error,retry:!terminal&&opens<MAX_OPENS,opens,waitMs:wait(run)*2**opens};
      active.phase='failure-hold';active.closeAt=now()+20000;run.phase='failure-hold';run.lastError=error;
      await log(run,'Tur başarısız',`${error} Sekme teşhis için 20 saniye açık tutuluyor.`);
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
      else{run.stopReason='Tur başarısız: '+failure.error;run.done.push({piece:active.piece,status:'failed',error:failure.error,count:active.newCount,total:active.total});await log(run,'Tur başarısız',failure.error+' Açılış sınırı doldu veya tur devam edemiyor; sonraki tura geçiliyor.');}
      await log(run,'Sekme kapatılıyor','20 saniyelik teşhis süresi tamamlandı.');
      await disposeActive(run);await chrome.alarms.clear(CLOSE);run.phase=run.running?'queued':'paused';
      if(!run.running){await save(run);await progress(run);return;}
      if(run.queue.length)await schedule(run,failure.retry?failure.waitMs:wait(run));else await finishRun(run);
    }
    async function finishRun(run) {
      run.stopReason??='Tarih imleci taraması tamamlandı.';run.running = false; run.phase = 'done'; run.finishedAt = now();await log(run,'Tarih imleci taraması tamamlandı',`${run.uniqueCount} benzersiz reklam; ${run.done.filter(item=>item.status==='failed').length} başarısız tur · ${run.stopReason}`);await heartbeat(run);
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
      if (!run || run.mode!=='cursor' || run.phase === 'done' || run.running || scan?.running) throw new Error('Devam edilecek durmuş bir tarih imleci taraması yok.');
      if(run.active?.phase==='stopping')throw new Error('Son reklam paketi kaydediliyor; birkaç saniye sonra Devam Et ile yeniden dene.');
      if(run.active?.phase==='failure-hold'){delete run.stopReason;run.running=true;run.phase='failure-hold';await log(run,'Devam edildi','Teşhis beklemesi sürüyor.');await heartbeat(run);await progress(run);return {ok:true};}
      if (run.active) await detach(run);
      delete run.stopReason;run.lastError='';run.running = true; run.visible = true; run.phase = 'queued'; run.nextAt = now(); await log(run,'Devam edildi','Kalıcı kuyruk yükleniyor.');await heartbeat(run);await progress(run); await next(); return { ok: true };
    }
    async function hide() {
      const run = await read(); if (run?.running) throw new Error('Önce tarih imleci taramasını durdur.');
      if(run?.active?.phase==='failure-hold')throw new Error('Hatalı sekmenin 20 saniyelik teşhis süresi tamamlanmalı.');
      if(run?.active?.phase==='stopping')throw new Error('Son reklam paketi kaydediliyor; birkaç saniye sonra yeniden dene.');
      if(run?.active)await detach(run);
      if(run){run.visible=false;await save(run);await chrome.action?.setBadgeText({text:''});}
    }
    async function clear() {
      const run = await read(); if (run?.running) throw new Error('Önce tarih imleci taramasını durdur.');
      if(run?.active?.phase==='failure-hold'&&now()<run.active.closeAt)throw new Error('20 saniyelik teşhis süresi tamamlanmalı.');
      if (run?.active) await disposeActive(run);
      await chrome.storage.local.set({chunkRun:null,...(run?.visible?{scrollCount:0}:{})});if(run?.visible)await hooks.publishProgress({ads:[],scrollCount:0,scan:{running:false,reason:''}},{ads:0,scrolls:0,status:'ready'}); if (run?.poolKeys.length) await chrome.storage.local.remove(run.poolKeys);
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
        if(now()>=active.deadline){await retry('Tur yükleme/tarama zaman aşımı.',['loading','probing','creating'].includes(active.phase)?false:true);return;}
        if(!Number.isInteger(active.tabId)&&Number.isInteger(run.windowId)){
          const candidates=await chrome.tabs.query({windowId:run.windowId});
          active.tabId=candidates.find(tab=>tab.url===pieceUrl(run.baseUrl,active.piece))?.id??null;await save(run);
        }
        let tab;try{tab=await chrome.tabs.get(active.tabId);}catch{await retry('Tarama sekmesi bulunamadı.');return;}
        if(tab.status==='loading')return;
        let status;try{status=await chrome.tabs.sendMessage(active.tabId,{type:'META_SCAN_STATUS'},{frameId:0});}catch{}
        if(status?.running&&status.sessionId===active.sessionId){if(active.phase!=='scanning'){active.phase='scanning';await log(run,'Tarama devam ediyor','Worker yeniden bağlandı.');}return;}
        if(active.phase==='scanning'){await retry('Tarama bağlantısı kesildi; aynı tur açılış sınırı korunuyor.');return;}
        active.phase='loading';await log(run,'Worker devam ediyor','Mevcut sekmede yükleme/hazırlık adımı sürdürülüyor.');await loaded(active.tabId);
      }else if(run.running)await next();
      run=await read();if(['queued','retrying'].includes(run.notification?.status))await chrome.alarms.create(REPORT,{when:Math.max(now()+100,run.notification.nextAt)});
    }
    async function failSafe() {
      const run=await read().catch(()=>null);if(!run)return;
      run.running=false;run.phase='paused';run.lastError='Tur yöneticisi durdu; kaydedilen veriler korunuyor. Devam Et ile yeniden dene.';
      if(run.active&&run.active.phase!=='failure-hold'){
        const opens=run.openCounts?.[key(run.active.piece)]||1;
        run.active.phase='failure-hold';run.active.closeAt=now()+20000;
        run.active.failure={error:run.lastError,retry:false,opens,waitMs:wait(run)*2**opens};
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
          if (!run.running) await detach(run); else if (now() >= run.active.deadline) await retry('Tur yükleme/tarama zaman aşımı.',['loading','probing','creating'].includes(run.active.phase)?false:true);
        }
      }).catch(failSafe);
    });
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      void enqueue(async () => {
        if(change.url&&library(change.url)){const param=platformKey(change.url);if(param)await chrome.storage.local.set({cursorPlatformParam:param});}
        const run = await read(); if (run?.active?.tabId !== tabId) return;
        if (change.status === 'complete') await loaded(tabId);
        if (change.status === 'loading' && ['scanning', 'starting'].includes(run.active.phase)) {
          const tab=await chrome.tabs.get(tabId).catch(()=>null);
          if(tab?.status==='loading')await retry('Meta tur sayfasını yeniden yükledi.');
        }
      }).catch(failSafe);
    });
    chrome.tabs.onRemoved.addListener(tabId => { void enqueue(async () => { const run = await read(); if (run?.active?.tabId === tabId) {if(run.windowId!=null){try{await scanWindow(run);}catch{await windowClosed(run.windowId);return;}}if(run.active.phase==='failure-hold'){await log(run,'Sekme kullanıcı tarafından kapatıldı','Teşhis süresi ve yeniden deneme sınırı korunuyor.');return;}await retry('Tur sekmesi kapandı.');} }).catch(failSafe); });
    chrome.windows.onRemoved.addListener(windowId=>{void enqueue(()=>windowClosed(windowId)).catch(failSafe);});
    if(hooks.autoRecover!==false)void enqueue(recover).catch(failSafe);
    chrome.runtime.onStartup.addListener(() => { void enqueue(() => recover(true)).catch(failSafe); });
    chrome.runtime.onInstalled.addListener(() => { void enqueue(() => recover(false)).catch(failSafe); });
    return { start, next, loaded, log, closeFailed, windowClosed, owns, content, pause, resume, clear, hide, view, progress, recover, report, read };
  }
  const api = { create, oldest, descending, exhausted, denseParts, platformKey, pieceUrl, library, settings, label, key, today, parseResults, probePage, sortDatesPage, rankPage, summary, MAX_OPENS, LIBRARY_HELP, OVERLAP, SLOW };
  root.ChunkScan = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
