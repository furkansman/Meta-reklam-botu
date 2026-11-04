(() => {
 'use strict';
 const $=selector=>document.querySelector(selector);let writing=false;
 async function refresh(){
  try{
   const {pageLightenerSettings:settings={},pageLightenerStatus:status,pageLightenerLog:log=[],scan,chunkRun}=await chrome.storage.local.get(['pageLightenerSettings','pageLightenerStatus','pageLightenerLog','scan','chunkRun']);
   if($('#page-lighten')){if(!writing){$('#page-lighten').checked=settings.enabled!==false;$('#block-media').checked=Boolean(settings.blockMedia);}const running=Boolean(scan?.running||chunkRun?.running);$('#page-lighten').disabled=running;$('#block-media').disabled=running;}
   const line=$('#page-lightener-diagnostics');if(line&&status)line.textContent=`Hız: ${Math.round(status.speed).toLocaleString('tr-TR')} reklam/dk · son 50: ${status.last50Seconds.toFixed(1)} sn · hafifletilen kart: ${status.lightened} · hata: ${status.errors}${status.memoryMB!=null?' · JS bellek: '+status.memoryMB+' MB':''}${status.missingMedia?' · Medya URL boş: '+status.missingMedia:''}${status.warning?' · '+status.warning:''}`;
   const list=$('#page-lightener-log');if(list){list.replaceChildren();for(const event of log){const li=document.createElement('li');li.textContent=`${new Date(event.at).toLocaleTimeString('tr-TR',{timeZone:'Europe/Istanbul'})} · ${event.total} reklam · hafifletme: ${event.enabled?'açık':'kapalı'} · engelleme: ${event.blocked?'açık':'kapalı'} · hız: ${Math.round(event.speed)} reklam/dk${event.warning?' · '+event.warning:''}`;list.append(li);}}
  }catch{if($('#page-lightener-diagnostics'))$('#page-lightener-diagnostics').textContent='Hafifletme durumu okunamadı; tarama verileri korunuyor.';}
 }
 for(const id of ['#page-lighten','#block-media'])$(id)?.addEventListener('change',async()=>{
  writing=true;try{await chrome.storage.local.set({pageLightenerSettings:{enabled:$('#page-lighten').checked,blockMedia:$('#block-media').checked}});}catch{$('#page-lightener-diagnostics').textContent='Hafifletme ayarı kaydedilemedi.';}finally{writing=false;}
 });
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&['pageLightenerSettings','pageLightenerStatus','pageLightenerLog','scan','chunkRun'].some(key=>key in changes))void refresh();});
 void refresh();
})();
