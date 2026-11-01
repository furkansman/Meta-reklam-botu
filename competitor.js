(function(root){
  'use strict';
  const DEFAULT={enabled:false,time:'01:00',notifyUnchanged:true};
  const DAILY='competitor-daily',TICK='competitor-next',LIMIT='competitor-timeout',NOTICE='competitor-missed';
  function profile(value){
    const input=String(value||'').trim();if(!input)return {input:'',pageId:null,pageUrl:null};
    if(/^\d+$/.test(input))return {input,pageId:input,pageUrl:`https://www.facebook.com/profile.php?id=${input}`};
    let url;try{url=new URL(input);}catch{throw new Error('Facebook sayfa linki veya sayısal Sayfa ID gir.');}
    if(!['https:','http:'].includes(url.protocol)||!/(^|\.)facebook\.com$/.test(url.hostname))throw new Error('Yalnızca Facebook sayfa linki kabul edilir.');
    const id=url.searchParams.get('id')||url.searchParams.get('view_all_page_id')||url.pathname.match(/^\/(?:pages|people)\/[^/]+\/(\d+)\/?$/)?.[1];
    const path=url.pathname.replace(/\/$/,'');
    if(!path||/^\/(?:ads|login|groups|watch)(?:\/|$)/.test(path))throw new Error('Geçerli bir Facebook sayfası gir.');
    return {input,pageId:/^\d+$/.test(id||'')?id:null,pageUrl:`https://www.facebook.com${path}${id?'?id='+encodeURIComponent(id):''}`};
  }
  const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu,'');
  function pageKey(value){try{const url=new URL(value);return url.searchParams.get('id')||url.pathname.replace(/\/$/,'').toLowerCase();}catch{return '';}}
  function matches(ad,brand){return normalize(ad.advertiser)===normalize(brand.name)||Boolean(brand.pageUrl&&pageKey(brand.pageUrl)&&pageKey(ad.advertiserUrl)===pageKey(brand.pageUrl))||Boolean(brand.pageId&&pageKey(ad.advertiserUrl)===brand.pageId);}
  function libraryUrl(brand){const url=new URL('https://www.facebook.com/ads/library/');for(const [key,value]of Object.entries({active_status:'active',ad_type:'all',country:'TR',search_type:brand.pageId?'page':'keyword_unordered'}))url.searchParams.set(key,value);url.searchParams.set(brand.pageId?'view_all_page_id':'q',brand.pageId||brand.name);return url.href;}
  function compactAd(ad){
    const fullText=ad.fullText||ad.primaryText||ad.text||'';
    return {id:ad.id,libraryId:ad.id,advertiser:ad.advertiser||'',advertiserUrl:ad.advertiserUrl||null,hook:ad.hook||root.AdData.makeHook(fullText,ad.headline||'',ad.advertiser||''),headline:ad.headline||'',startDate:ad.startDate||'',mediaType:ad.mediaType||'',mediaUrl:ad.mediaUrl||'',cta:ad.cta||'',targetUrl:ad.targetUrl||'',libraryUrl:ad.libraryUrl||`https://www.facebook.com/ads/library/?id=${ad.id}`,fullText};
  }
  function adSummary(ad){const {fullText,primaryText,text,rawText,...summary}=ad;return summary;}
  function compare(previous,ads,partial){const unique=[...new Map(ads.map(ad=>[ad.id,ad])).values()];const old=new Set(previous?.ads?.map(ad=>ad.id)||[]),current=new Set(unique.map(ad=>ad.id));return {ads:unique,newAds:previous?.baseline?unique.filter(ad=>!old.has(ad.id)).map(adSummary):[],missingIds:previous?.baseline&&!partial?[...old].filter(id=>!current.has(id)):[],baseline:true,first:!previous?.baseline,total:unique.length,partial};}
  function splitMessages(text,max=4000){const parts=[];let current='';for(const line of text.split('\n')){const segments=[];for(let i=0;i<line.length;i+=max-1)segments.push(line.slice(i,i+max-1));if(!segments.length)segments.push('');for(const segment of segments){if(current.length+segment.length+1>max){parts.push(current);current='';}current+=(current?'\n':'')+segment;}}if(current)parts.push(current);return parts;}
  function report(items,time){
    const changed=items.filter(item=>item.newCount>0),first=items.filter(item=>item.first&&!item.error),errors=items.filter(item=>item.error);
    if(!changed.length&&!first.length&&!errors.length)return 'Gece taraması tamamlandı, rakiplerde yeni reklam yok.';
    const lines=[`Gece taraması tamamlandı (${time})`,''];
    if(first.length)lines.push(`${first.length} marka kaydedildi, değişiklikler bir sonraki taramadan itibaren takip edilecek`,'');
    for(const item of items){
      if(item.error){lines.push(`${item.name}: taranamadı (${item.error})`);continue;}
      if(item.first){lines.push(`${item.name}: ilk kayıt (toplam ${item.total} aktif)`);continue;}
      lines.push(item.newCount?`${item.name}: ${item.newCount} yeni reklam`:`${item.name}: değişiklik yok (toplam ${item.total} aktif)`);
      for(const ad of item.newAds.slice(0,5))lines.push(`• ${ad.hook||ad.headline||'Hook bulunamadı'}`,`  ${ad.libraryUrl||'https://www.facebook.com/ads/library/?id='+ad.id}`);
      if(item.newCount>5)lines.push(`ve ${item.newCount-5} reklam daha`);
      if(item.missingCount)lines.push(`${item.missingCount} reklam artık görünmüyor (durdurulmuş olabilir)`);
      if(item.partial)lines.push('Kısmi tarama: 300 sınırı; görünmeyenler durduruldu sayılmadı.');
      lines.push('');
    }
    lines.push(`Toplam: ${items.reduce((sum,item)=>sum+(item.newCount||0),0)} yeni reklam, ${changed.length} marka etkilendi`);
    return lines.join('\n');
  }
  function create(chrome,{enqueue,sendTelegram}){
    const read=async()=>{const value=await chrome.storage.local.get(['competitors','competitorProfiles','watchSettings','watchRun','watchResults','watchSchedule']);return {competitors:[],competitorProfiles:{},watchSettings:DEFAULT,watchRun:null,watchResults:{},watchSchedule:{},...value,watchSettings:{...DEFAULT,...value.watchSettings}};};
    const save=values=>chrome.storage.local.set(values);
    const alarm=(name,when)=>chrome.alarms.create(name,{when});
    const close=async(tabId)=>{if(Number.isInteger(tabId))await chrome.tabs.remove(tabId).catch(()=>{});};
    function nextTime(time,base=Date.now()){const [hour,minute]=time.split(':').map(Number);const next=new Date(base);next.setHours(hour,minute,0,0);if(next.getTime()<=base)next.setDate(next.getDate()+1);return next.getTime();}
    async function schedule(startup=false){
      const state=await read(),settings={...DEFAULT,...state.watchSettings};
      const previous=state.watchSchedule;
      await chrome.alarms.clear(DAILY);
      if(settings.enabled){
        const missed=startup&&!state.watchRun?.running&&previous.nextDue&&Date.now()>previous.nextDue&&(!previous.lastRun||previous.lastRun<previous.nextDue);
        if(missed){await save({watchSchedule:{...previous,missed:true}});await chrome.notifications.create(NOTICE,{type:'basic',iconUrl:'icon.png',title:'Meta Reklam Botu',message:'Gece taraması çalışmadı, şimdi çalıştırılsın mı?',buttons:[{title:'Şimdi çalıştır'},{title:'Daha sonra'}]}).catch(()=>{});}
        const nextDue=nextTime(settings.time);await chrome.alarms.create(DAILY,{when:nextDue,periodInMinutes:1440});
        await save({watchSchedule:{...previous,nextDue,missed:Boolean(missed||previous.missed)}});
      }
      const run=(await read()).watchRun;
      if(run?.running){if(run.active){await alarm(LIMIT,Math.max(Date.now()+1000,run.active.deadline));try{const tab=await chrome.tabs.get(run.active.tabId);if(tab.status==='complete')await loaded(tab.id);}catch{await complete('Sekme kapandı veya tarayıcı yeniden başladı.');}}else await alarm(TICK,Math.max(Date.now()+1000,run.nextAt||Date.now()));}
    }
    async function start(names=null,automatic=false){
      const state=await read();if(state.watchRun?.running)throw new Error('Rakip taraması zaten çalışıyor.');
      const selected=names||state.competitors;if(selected.length>10)throw new Error('Listeyi en fazla 10 markaya düşür.');if(!selected.length)throw new Error('Önce rakip marka ekle.');
      if(selected.some(name=>!state.competitors.includes(name)))throw new Error('Rakip marka bulunamadı.');
      const queue=selected.map(name=>({name,...profile(state.competitorProfiles[name]?.input||'')}));
      const run={id:crypto.randomUUID(),running:true,automatic,time:new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}),queue,active:null,items:[],nextAt:Date.now(),phase:'queued'};
      await save({watchRun:run,watchReportError:'',watchSchedule:{...state.watchSchedule,lastRun:Date.now(),missed:false}});await alarm(TICK,Date.now()+250);await next();
    }
    async function next(){
      const state=await read(),run=state.watchRun;if(!run?.running)return;
      if(run.phase==='reporting'){await sendReport();return;}
      if(run.active)return;
      if(run.nextAt>Date.now()+500){await alarm(TICK,run.nextAt);return;}
      if(!run.queue.length){await prepareReport();return;}
      const brand=run.queue.shift(),sessionId=crypto.randomUUID(),deadline=Date.now()+600000;
      run.active={brand,sessionId,tabId:null,deadline,phase:'creating',ads:[],seen:0};
      await save({watchRun:run});
      try{
        const tab=await chrome.tabs.create({url:brand.pageUrl&&!brand.pageId?brand.pageUrl:libraryUrl(brand),active:false});
        run.active.tabId=tab.id;run.active.phase=brand.pageUrl&&!brand.pageId?'resolving':'loading';
        await save({watchRun:run});await alarm(LIMIT,deadline);
        if(tab.status==='complete')await loaded(tab.id);
      }catch{await complete('Arka plan sekmesi açılamadı.');}
    }
    async function loaded(tabId){
      const state=await read(),run=state.watchRun,active=run?.active;if(!run?.running||active?.tabId!==tabId)return;
      if(active.phase==='scanning'){try{const status=await chrome.tabs.sendMessage(tabId,{type:'META_SCAN_STATUS'},{frameId:0});if(status?.running&&status.sessionId===active.sessionId)return;}catch{}await complete('Sayfa yenilendi veya tarama bağlantısı kesildi.');return;}
      if(!['resolving','loading'].includes(active.phase))return;
      if(Date.now()>=active.deadline){await complete('10 dakikalık marka sınırı aşıldı.');return;}
      try{
        const [probe]=await chrome.scripting.executeScript({target:{tabId},func:()=>{
          const text=document.body?.innerText||'';
          const blocked=/temporarily blocked|too many requests|try again later|geçici olarak engell|çok fazla istek|rate limit|hız sınırı|istek sınırı|daha sonra tekrar dene|log in to continue|devam etmek için giriş/i.test(text);
          let pageId=null;for(const meta of document.querySelectorAll('meta[property="al:android:url"],meta[property="al:ios:url"]')){const match=(meta.content||'').match(/(?:page|profile)(?:\/?\?id=|[/=])(\d+)/i);if(match){pageId=match[1];break;}}
          return {blocked,pageId};
        }});
        if(probe?.result?.blocked){await complete('Meta erişimi sınırladı veya giriş istiyor.');return;}
        if(active.phase==='resolving'){
          if(!probe?.result?.pageId){await complete('Sayfa ID çözülemedi; markaya sayısal Sayfa ID ekle.');return;}
          active.brand.pageId=probe.result.pageId;active.phase='loading';await save({watchRun:run});await chrome.tabs.update(tabId,{url:libraryUrl(active.brand)});return;
        }
        active.phase='starting';await save({watchRun:run});
        await chrome.scripting.executeScript({target:{tabId},files:['ad-data.js','scan-loop.js','content.js']});
        const response=await chrome.tabs.sendMessage(tabId,{type:'META_SCAN_START',tabId,sessionId:active.sessionId,settings:{autoScroll:true,speed:'medium',maxAds:300}},{frameId:0});
        if(!response?.ok){await complete('Tarama motoru başlatılamadı.');return;}
        active.phase='scanning';await save({watchRun:run});
      }catch{await complete('Sayfa yüklenmedi veya içerik betiği çalıştırılamadı.');}
    }
    async function owns(sender,message){const state=await read();return Boolean(sender.tab&&state.watchRun?.running&&state.watchRun.active?.tabId===sender.tab.id&&state.watchRun.active.sessionId===message.sessionId);}
    async function content(message,sender){
      const state=await read(),run=state.watchRun,active=run.active;
      if(sender.frameId!==0||!['SCAN_PROGRESS','META_SCAN_PROGRESS','META_SCAN_FINISHED'].includes(message.type))throw new Error('Geçersiz rakip mesajı.');
      const incoming=message.type==='SCAN_PROGRESS'?(message.record?[message.record]:[]):message.ads;
      if(!Array.isArray(incoming)||incoming.length>300||incoming.some(ad=>!/^\d{10,}$/.test(ad?.id||'')))throw new Error('Geçersiz rakip reklam verisi.');
      active.seen=Math.max(active.seen,typeof message.ads==='number'?message.ads:incoming.length);
      const accepted=incoming.filter(ad=>matches(ad,active.brand)).map(compactAd);
      active.ads=[...new Map([...active.ads,...accepted].map(ad=>[ad.id,ad])).values()].slice(0,300);
      active.reportedTotal=message.discovery?.reportedTotal??active.reportedTotal??null;
      try{await save({watchRun:run});}catch{await complete('Yerel depolama alanı dolu.');return {ok:false,error:'Rakip verileri kaydedilemedi.'};}
      if(message.type==='META_SCAN_FINISHED'){
        const errors={error:'Tarama sırasında hata oluştu.', 'page-changed':'Meta sayfası değişti.', 'no-cards':'Reklamlar yüklenmedi.',stopped:'Tarama kesildi.'};
        let error=errors[message.reason]||'';
        if(!active.ads.length&&active.seen)error='Reklamveren adı/sayfası eşleşmedi.';
        if(!active.ads.length&&!active.seen&&!error){
          const [probe]=await chrome.scripting.executeScript({target:{tabId:active.tabId},func:()=>/no ads found|no results found|reklam bulunamadı|sonuç bulunamadı|0 sonuç|0 results/i.test(document.body?.innerText||'')}).catch(()=>[]);
          if(!probe?.result)error='Meta reklam yüklemedi; boş sonuç doğrulanamadı.';
        }
        await complete(error,message.reason==='limit'||active.reportedTotal>300);
      }
      return {ok:true,competitor:true};
    }
    async function complete(error='',partial=false){
      const state=await read(),run=state.watchRun,active=run?.active;if(!active)return;
      const name=active.brand.name,previous=state.watchResults[name];
      const result=error?{...previous,error,lastAttempt:Date.now()}:{...compare(previous,active.ads,partial),error:'',lastScan:Date.now(),sourceUrl:libraryUrl(active.brand)};
      const item={name,error,newAds:result.newAds||[],newCount:result.newAds?.length||0,missingCount:result.missingIds?.length||0,total:result.total||0,first:result.first,partial};
      run.items.push(item);run.active=null;run.nextAt=Date.now()+30000+Math.floor(Math.random()*30001);run.phase='queued';
      try{await save({watchResults:{...state.watchResults,[name]:result},watchRun:run});}catch{run.items[run.items.length-1]={name,error:'Yerel depolama dolu.',newCount:0};await save({watchRun:run});}
      await chrome.alarms.clear(LIMIT);await close(active.tabId);
      if(run.queue.length)await alarm(TICK,run.nextAt);else await prepareReport();
    }
    async function prepareReport(){
      const state=await read(),run=state.watchRun;if(!run)return;
      const changed=run.items.some(item=>item.newCount||item.first||item.error);
      if(!changed&&!state.watchSettings.notifyUnchanged){await save({watchRun:{...run,running:false,phase:'done'}});return;}
      run.parts=splitMessages(report(run.items,run.time));run.part=0;run.phase='reporting';await save({watchRun:run});await alarm(TICK,Date.now()+250);
    }
    async function sendReport(){
      const state=await read(),run=state.watchRun;if(run?.phase!=='reporting')return;
      const {telegramConfig}=await chrome.storage.local.get('telegramConfig');
      if(!telegramConfig?.enabled){await save({watchRun:{...run,running:false,phase:'done'},watchReportError:'Telegram etkin değil; rakip sonuçları yerelde kaydedildi.'});return;}
      if(run.part>=run.parts.length){await save({watchRun:{...run,running:false,phase:'done'},watchReportError:''});return;}
      // Persist a retry alarm before network work in case the worker is suspended.
      await alarm(TICK,Date.now()+60000);
      try{await sendTelegram(telegramConfig,run.parts[run.part]);run.part++;await save({watchRun:run});await alarm(TICK,Date.now()+250);}
      catch(error){await save({watchRun:{...run,running:false,phase:'done'},watchReportError:error.message||'Telegram raporu gönderilemedi.'});}
    }
    async function command(message){
      const state=await read();
      switch(message.type){
        case 'ADD_COMPETITOR':{
          if(state.watchRun?.running)throw new Error('Tarama bitince marka listesini değiştir.');
          const name=String(message.name||'').trim();if(!name||name.length>100)throw new Error('1–100 karakterlik marka adı gir.');
          if(state.competitors.length>=10)throw new Error('En fazla 10 marka eklenebilir.');
          if(state.competitors.some(item=>normalize(item)===normalize(name)))throw new Error('Bu marka zaten listende.');
          const selected=profile(message.pageInput);await save({competitors:[...state.competitors,name],competitorProfiles:{...state.competitorProfiles,[name]:selected}});break;
        }
        case 'REMOVE_COMPETITOR':{
          if(state.watchRun?.running)throw new Error('Tarama bitince marka listesini değiştir.');
          const profiles={...state.competitorProfiles},results={...state.watchResults};delete profiles[message.name];delete results[message.name];await save({competitors:state.competitors.filter(name=>name!==message.name),competitorProfiles:profiles,watchResults:results});break;
        }
        case 'WATCH_START':await start(message.name?[message.name]:null);break;
        case 'WATCH_SETTINGS':{
          if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(message.time||'')||typeof message.enabled!=='boolean'||typeof message.notifyUnchanged!=='boolean')throw new Error('Günlük tarama saati/ayarları geçersiz.');
          await save({watchSettings:{time:message.time,enabled:message.enabled,notifyUnchanged:message.notifyUnchanged},watchSchedule:{...state.watchSchedule,missed:false}});await schedule();break;
        }
        default:throw new Error('Bilinmeyen rakip komutu.');
      }
      return {ok:true};
    }
    chrome.alarms.onAlarm.addListener(info=>{if(![DAILY,TICK,LIMIT].includes(info.name))return;void enqueue(async()=>{
      if(info.name===DAILY){const state=await read();if(state.watchSettings.enabled){if(!state.watchRun?.running)await start(null,true);await save({watchSchedule:{...(await read()).watchSchedule,nextDue:nextTime(state.watchSettings.time)}});}}
      if(info.name===TICK)await next();
      if(info.name===LIMIT){const state=await read(),active=state.watchRun?.active;if(active&&Date.now()>=active.deadline){await chrome.tabs.sendMessage(active.tabId,{type:'META_SCAN_STOP',sessionId:active.sessionId},{frameId:0}).catch(()=>{});await complete('10 dakikalık marka sınırı aşıldı.');}}
    }).catch(async()=>{await save({watchReportError:'Rakip taraması beklenmeyen bir hatayla durdu.'}).catch(()=>{});});});
    chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='complete')void enqueue(()=>loaded(tabId)).catch(()=>{});});
    chrome.tabs.onRemoved.addListener(tabId=>{void enqueue(async()=>{const state=await read();if(state.watchRun?.active?.tabId===tabId)await complete('Tarama sekmesi kapandı.');}).catch(()=>{});});
    chrome.runtime.onStartup.addListener(()=>{void enqueue(()=>schedule(true)).catch(()=>{});});
    chrome.runtime.onInstalled.addListener(()=>{void enqueue(()=>schedule()).catch(()=>{});});
    chrome.notifications.onButtonClicked.addListener((id,index)=>{if(id===NOTICE){void chrome.notifications.clear(id);if(index===0)void enqueue(()=>start(null,true)).catch(()=>{});}});
    return {command,owns,content,start,schedule,next,loaded,complete,read};
  }
  const api={create,profile,matches,libraryUrl,compare,report,splitMessages};root.CompetitorWatch=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
