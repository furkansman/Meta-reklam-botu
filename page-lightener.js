(function(root){
  'use strict';
  const KEEP=60,BATCH=20;
  const idPattern=/(?:Kütüphane\s+Kodu|Library\s+ID)\s*:?\s*(\d{10,})/;
  function create(options={}){
    const now=options.now||(()=>performance.now()),send=options.send|| (message=>chrome.runtime.sendMessage(message));
    const entries=[],byId=new Map(),snapshots=new WeakMap(),lightened=new WeakSet(),attempted=new WeakSet(),nodeIds=new WeakMap(),history=[];
    let enabled=false,blockingWanted=false,blocked=false,active=false,bypass=false,stopped=false,changed=false,baseline=null,after=[],scrollStart=null,readySamples=[],pending=0,total=0,lightenedCount=0,errors=0,missingMedia=0,speed=0,seconds=0,speedAt=now(),nextSpeed=50,nextLog=200,warning='';
    let safetyOff=false,configured=false,closures=0,retryAt=null,permanent=false,readStreak=0,readWindow=[],lastRead=new Map();
    const cohorts={on:{cards:0,missing:0},off:{cards:0,missing:0}};
    function readResult(id,ok){if(bypass||lastRead.get(id)===ok)return;lastRead.set(id,ok);readStreak=ok?0:readStreak+1;readWindow.push(ok);if(readWindow.length>100)readWindow.shift();}
    async function dataGuard(reason){
      warning=(safetyOff?'Emniyet kapalı (test): ': 'Hafifletme kapatıldı: ')+reason;
      if(!safetyOff&&(enabled||blocked)){closures++;enabled=false;blockingWanted=false;if(blocked){try{await send({type:'LIGHTENER_BLOCK',sessionId:options.sessionId,enabled:false});blocked=false;}catch{errors++;}}
        permanent=closures>=3;retryAt=permanent?null:total+150;warning+=permanent?' · 3. kapanma; kalıcı kapatıldı.':' · 150 reklam sonra yeniden denenecek.';
      }await publish(true);
    }
    const ref=node=>typeof WeakRef==='function'?new WeakRef(node):{deref:()=>node};
    const capture=(node,names)=>({node:ref(node),attrs:Object.fromEntries(names.map(name=>[name,node.getAttribute(name)]))});
    function restore(snapshot,media=true){
      const card=snapshot.card.deref();if(!card)return;
      for(const [key,value]of Object.entries(snapshot.style))card.style[key]=value;
      if(!media)return;
      for(const asset of snapshot.assets){const node=asset.node.deref();if(!node||!card.contains(node))continue;for(const [name,value]of Object.entries(asset.attrs)){if(value===null)node.removeAttribute(name);else node.setAttribute(name,value);}}
      for(const source of snapshot.sources){const parent=source.parent.deref(),node=source.node;if(parent&&card.contains(parent)&&!node.parentNode)parent.insertBefore(node,source.next?.deref()?.parentNode===parent?source.next.deref():null);}
      for(const video of card.querySelectorAll('video')){try{video.load();}catch{}}
    }
    function restoreAll(){for(const snapshot of history){try{if(!snapshot.retired)restore(snapshot);}catch{errors++;}}history.length=0;}
    function prepare(element){
      const body=typeof document!=='undefined'?document.body:null;
      for(let node=element;node&&node!==body;node=node.parentElement){
        const snapshot=snapshots.get(node);if(!snapshot)continue;
        const text=(node.textContent||'').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g,'').replace(/Kütüphane\s*Kodu/gi,'Kütüphane Kodu').replace(/Library\s*ID/gi,'Library ID');
        const id=text.match(idPattern)?.[1];
        if(id&&id!==snapshot.id){try{restore(snapshot,false);}catch{errors++;}snapshots.delete(node);lightened.delete(node);attempted.delete(node);snapshot.retired=true;}
        return;
      }
    }
    function track(card,id){
      if(!card||!/^\d{10,}$/.test(id)||byId.has(id))return;
      const entry={card:ref(card),id,saved:false};entries.push(entry);byId.set(id,entry);nodeIds.set(card,id);
    }
    function safeToChange(card){
      if(!card.isConnected||attempted.has(card))return false;
      const rect=card.getBoundingClientRect();
      return rect.height>0&&(rect.bottom<=0||rect.top>=(options.viewportHeight?.()??root.innerHeight))?rect:null;
    }
    function lightenCard(entry,measured=null){
      const card=entry?.card?.deref();
      if(!entry?.saved||!card||nodeIds.get(card)!==entry.id)return false;
      try{measured??=safeToChange(card);if(!measured)return false;}catch{errors++;attempted.add(card);return false;}
      attempted.add(card);
      const snapshot={id:entry.id,card:ref(card),assets:[],sources:[],style:{height:card.style.height,boxSizing:card.style.boxSizing,contentVisibility:card.style.contentVisibility,containIntrinsicSize:card.style.containIntrinsicSize}};
      try{
        const height=measured.height;
        for(const img of card.querySelectorAll('img'))snapshot.assets.push(capture(img,['src','srcset','sizes']));
        for(const source of card.querySelectorAll('picture source'))snapshot.assets.push(capture(source,['srcset','sizes']));
        for(const video of card.querySelectorAll('video')){
          snapshot.assets.push(capture(video,['src','poster','preload']));
          for(const source of video.querySelectorAll('source'))snapshot.sources.push({node:source,parent:ref(source.parentNode),next:source.nextSibling?ref(source.nextSibling):null});
        }
        card.style.boxSizing='border-box';card.style.height=height+'px';card.style.contentVisibility='auto';card.style.containIntrinsicSize='auto '+height+'px';
        for(const asset of snapshot.assets){const node=asset.node.deref();if(!node)continue;node.removeAttribute('src');node.removeAttribute('srcset');node.removeAttribute('sizes');if(node.tagName==='VIDEO'){node.pause();node.removeAttribute('poster');node.setAttribute('preload','none');}}
        for(const source of snapshot.sources)source.node.remove();
        for(const video of card.querySelectorAll('video'))video.load();
        snapshots.set(card,snapshot);history.push(snapshot);lightened.add(card);lightenedCount++;return true;
      }catch{errors++;try{restore(snapshot);}catch{errors++;}return false;}
    }
    function arm(){
      if((changed||blocked)&&baseline!==null)return true;
      if(readySamples.length<3)return false;
      const value=readySamples.reduce((a,b)=>a+b,0)/3;if(value<=0)return false;
      baseline=value;after=[];return true;
    }
    function runBatch(limit=BATCH){
      if(!enabled||bypass||!arm())return;
      // All geometry reads precede every style/media write in this batch.
      const candidates=[];
      for(let i=0;i<Math.max(0,entries.length-KEEP)&&candidates.length<limit;i++){
        const entry=entries[i],card=entry.card.deref();if(!entry.saved||!card||nodeIds.get(card)!==entry.id)continue;
        try{const rect=safeToChange(card);if(rect)candidates.push({entry,rect});}catch{errors++;attempted.add(card);}
      }
      for(const {entry,rect}of candidates){try{if(lightenCard(entry,rect))changed=true;}catch{errors++;const card=entry.card.deref();if(card)attempted.add(card);}}

    }
    function snapshot(){
      const used=typeof performance!=='undefined'?performance.memory?.usedJSHeapSize:null;
      return {enabled,blocked,safetyOff,closures,retryAt,permanent,cohorts:structuredClone(cohorts),lightened:lightenedCount,errors,missingMedia,speed,last50Seconds:seconds,memoryMB:Number.isFinite(used)?Math.round(used/1048576*10)/10:null,warning:warning||((enabled||blockingWanted)&&readySamples.length<3?'İlk 3 kaydırma ölçülüyor.':''),total};
    }
    async function publish(log=false){if(bypass||!active)return;try{const response=await send({type:'LIGHTENER_REPORT',sessionId:options.sessionId,metrics:snapshot(),log});if(!response?.ok)throw new Error('Hafifletme teşhisi kaydedilemedi.');}catch{errors++;}}
    async function start(){
      try{
        const response=await send({type:'LIGHTENER_START',sessionId:options.sessionId});
        if(!response?.ok)throw new Error(response?.error||'Hafifletme ayarları okunamadı.');
        bypass=Boolean(response.bypass);enabled=!bypass&&response.enabled!==false;blockingWanted=!bypass&&Boolean(response.blockMedia);configured=enabled;safetyOff=Boolean(response.safetyOff);active=true;warning=response.warning||'';
      }catch{errors++;enabled=false;blockingWanted=false;warning='Hafifletme başlatılamadı; tarama normal sürüyor.';}
      await publish();return {legacy:bypass||(!enabled&&!blockingWanted)};
    }
    async function committed(records){
      if(bypass)return;
      let added=0;
      for(const ad of records){const entry=byId.get(ad.id);if(!entry||entry.saved)continue;entry.saved=true;added++;const cohort=cohorts[enabled&&changed?'on':'off'];cohort.cards++;if(!ad.mediaUrl){missingMedia++;cohort.missing++;}}
      total+=added;pending+=added;
      if(retryAt!==null&&total>=retryAt&&!permanent){enabled=configured;retryAt=null;readStreak=0;readWindow=[];cohorts.on={cards:0,missing:0};warning='Hafifletme yeniden deneniyor ('+closures+'/3).';await publish(true);}
      if(enabled||blocked){
        if(readStreak>=10)await dataGuard('Ardışık 10 kartta okuma hatası');
        else if(readWindow.length===100&&readWindow.includes(false))await dataGuard('Son 100 kartta okuma hatası');
        else if(cohorts.off.cards&&cohorts.on.cards>=50&&cohorts.on.missing/cohorts.on.cards-cohorts.off.missing/cohorts.off.cards>.02)await dataGuard('Medya URL boşluk oranı kapalı ölçümden 2 yüzde puan fazla');
      }
      const groups=Math.floor(pending/BATCH);
      if(groups&&(!enabled||readySamples.length>=3)){pending-=groups*BATCH;runBatch(groups*BATCH);}
      const tick=now();let report=false,log=false;
      if(total>=nextSpeed){seconds=Math.max(.001,(tick-speedAt)/1000);speed=50*60/seconds;speedAt=tick;nextSpeed+=50;report=true;}
      if(total>=nextLog){nextLog+=200;log=true;report=true;}
      if(report)await publish(log);
    }
    function beforeScroll(count){scrollStart={at:now(),count};}
    async function afterScroll(count){
      if(!bypass&&(enabled||blocked)){if(readStreak>=10)await dataGuard('Ardışık 10 kartta okuma hatası');else if(readWindow.length===100&&readWindow.includes(false))await dataGuard('Son 100 kartta okuma hatası');}
      if(!scrollStart||bypass)return;
      const rate=Math.max(0,count-scrollStart.count)/Math.max(.001,(now()-scrollStart.at)/1000);scrollStart=null;
      if(changed||blocked){
        after.push(rate);if(after.length>3)after.shift();
        if((enabled||blocked)&&after.length===3&&baseline!==null&&after.reduce((a,b)=>a+b,0)/3<baseline*.3){
          warning='Hız düştü: '+Math.round(after.reduce((a,b)=>a+b,0)/3*60)+' reklam/dk';await publish(true);
        }
      }else{readySamples.push(rate);if(readySamples.length>3)readySamples.shift();}
      if(blockingWanted&&!blocked&&arm()){
        try{const result=await send({type:'LIGHTENER_BLOCK',sessionId:options.sessionId,enabled:true});blocked=Boolean(result?.ok&&result.blocked);if(!blocked){blockingWanted=false;warning=result?.error||'Medya engelleme uygulanamadı.';}}catch{blockingWanted=false;errors++;warning='Medya engelleme uygulanamadı.';}
        await publish();
      }
    }
    async function stop(){if(stopped)return;stopped=true;try{const response=await send({type:'LIGHTENER_STOP',sessionId:options.sessionId});if(!response?.ok)throw new Error('Kural temizlenemedi.');blocked=false;}catch{errors++;}}
    async function finish(){await stop();await publish();}
    return {start,track,committed,beforeScroll,afterScroll,prepare,restoreAll,finish,stop,snapshot,lightenCard,runBatch,readResult};
  }
  const api={create,KEEP,BATCH};root.PageLightener=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
