(function(root){
 'use strict';
 const FIRST=300000,LAST=300999;
 const supports=type=>['LIGHTENER_START','LIGHTENER_BLOCK','LIGHTENER_REPORT','LIGHTENER_STOP'].includes(type);
 function metrics(value={}){
  const count=key=>Number.isSafeInteger(value[key])&&value[key]>=0?value[key]:0;
  return {enabled:Boolean(value.enabled),blocked:Boolean(value.blocked),lightened:count('lightened'),errors:count('errors'),missingMedia:count('missingMedia'),total:count('total'),speed:Number.isFinite(value.speed)?Math.max(0,value.speed):0,last50Seconds:Number.isFinite(value.last50Seconds)?Math.max(0,value.last50Seconds):0,memoryMB:Number.isFinite(value.memoryMB)?Math.max(0,value.memoryMB):null,warning:String(value.warning||'').slice(0,200)};
 }
 function create(chrome,{enqueue}){
  const read=async()=>({lightenerSessions:{},...await chrome.storage.local.get(['lightenerSessions','pageLightenerSettings','scan','chunkRun','watchRun'])});
  const dnr=chrome.declarativeNetRequest;
  async function removeRule(ruleId){if(dnr&&Number.isInteger(ruleId))await dnr.updateSessionRules({removeRuleIds:[ruleId]});}
  function owner(state,tabId,sessionId){
   if(state.scan?.running&&state.scan.tabId===tabId&&state.scan.sessionId===sessionId)return 'normal';
   if(state.chunkRun?.running&&state.chunkRun.active?.tabId===tabId&&state.chunkRun.active.sessionId===sessionId)return 'chunk';
   if(state.watchRun?.running&&state.watchRun.active?.tabId===tabId&&state.watchRun.active.sessionId===sessionId)return 'watch';
   return null;
  }
  async function cleanup(tabId,sessionId=null,forget=true){
   const state=await read(),entry=state.lightenerSessions[tabId];if(!entry||sessionId&&entry.sessionId!==sessionId)return;
   try{await removeRule(entry.ruleId);}catch(error){entry.stopped=true;await chrome.storage.local.set({lightenerSessions:state.lightenerSessions});await chrome.alarms.create('page-lightener-cleanup',{delayInMinutes:1});throw error;}if(forget)delete state.lightenerSessions[tabId];else{entry.ruleId=null;entry.stopped=true;}
   await chrome.storage.local.set({lightenerSessions:state.lightenerSessions});
  }
  async function handle(message,sender){
   if(sender.id!==chrome.runtime.id||sender.frameId!==0||!Number.isInteger(sender.tab?.id)||!/^https:\/\/(?:www\.)?facebook\.com\/ads\/library\/?(?:\?|$)/.test(sender.url||''))throw new Error('Geçersiz hafifletme kaynağı.');
   const tabId=sender.tab.id,state=await read(),entry=state.lightenerSessions[tabId],kind=owner(state,tabId,message.sessionId);
   if(message.type==='LIGHTENER_STOP'){if(entry&&entry.sessionId!==message.sessionId)throw new Error('Eski hafifletme oturumu.');await cleanup(tabId,message.sessionId);return {ok:true};}
   if(!kind||entry&&entry.sessionId!==message.sessionId)throw new Error('Hafifletme oturumu etkin değil.');
   if(message.type==='LIGHTENER_START'){
    if(entry)await removeRule(entry.ruleId);
    const settings=state.pageLightenerSettings||{};
    state.lightenerSessions[tabId]={sessionId:message.sessionId,kind,ruleId:null,stopped:false};await chrome.storage.local.set({lightenerSessions:state.lightenerSessions});
    return {ok:true,bypass:kind==='watch',enabled:settings.enabled!==false,blockMedia:kind!=='watch'&&Boolean(settings.blockMedia)&&Boolean(dnr),warning:settings.blockMedia&&!dnr?'Medya engelleme API’si kullanılamıyor.':''};
   }
   if(message.type==='LIGHTENER_BLOCK'){
    if(!entry||entry.stopped||kind==='watch')return {ok:false,blocked:false,error:'Medya engelleme oturumu kapalı.'};
    if(!message.enabled){await cleanup(tabId,message.sessionId,false);return {ok:true,blocked:false};}
    if(!dnr||!state.pageLightenerSettings?.blockMedia)return {ok:false,blocked:false,error:'Deneysel medya engelleme kapalı.'};
    const rules=await dnr.getSessionRules(),used=new Set(rules.map(rule=>rule.id));let id=FIRST;while(used.has(id)&&id<=LAST)id++;
    if(id>LAST)throw new Error('Medya engelleme kural sınırı.');
    if(entry.ruleId)await removeRule(entry.ruleId);
    await dnr.updateSessionRules({addRules:[{id,priority:1,action:{type:'block'},condition:{tabIds:[tabId],requestDomains:['fbcdn.net','fbsbx.com'],resourceTypes:['image','media','font']}}]});
    entry.ruleId=id;try{await chrome.storage.local.set({lightenerSessions:state.lightenerSessions});}catch(error){await removeRule(id);throw error;}return {ok:true,blocked:true};
   }
   if(message.type==='LIGHTENER_REPORT'){
    if(kind==='watch')return {ok:true};
    const value=metrics(message.metrics),status={...value,sessionId:message.sessionId,tabId,at:Date.now()};
    const updates={pageLightenerStatus:status};
    if(message.log){const {pageLightenerLog=[]}=await chrome.storage.local.get('pageLightenerLog');updates.pageLightenerLog=[status,...pageLightenerLog].slice(0,100);}
    await chrome.storage.local.set(updates);return {ok:true};
   }
   throw new Error('Bilinmeyen hafifletme mesajı.');
  }
  async function after(message,sender,response){
   if(!response?.ok)return;
   if(message.type==='META_SCAN_FINISHED'&&sender.tab)await cleanup(sender.tab.id,message.sessionId);
   if(message.type==='STOP_SCAN'){const state=await read();for(const [tab,entry]of Object.entries(state.lightenerSessions))if(entry.kind!=='watch')await cleanup(Number(tab),entry.sessionId,false);}
   if(message.type==='SCAN_REFRESH'&&sender.tab)await cleanup(sender.tab.id,message.sessionId);
  }
  async function recover(force=false){
   const state=await read(),keep=new Set();
   for(const [tab,entry]of Object.entries(state.lightenerSessions)){
    let valid=!force&&Boolean(owner(state,Number(tab),entry.sessionId));
    try{const info=await chrome.tabs.get(Number(tab));if(info.url&&!/^https:\/\/(?:www\.)?facebook\.com\/ads\/library\/?(?:\?|$)/.test(info.url))valid=false;}catch{valid=false;}
    if(entry.kind==='normal'&&state.scan?.stopping)valid=false;
    if(valid&&!entry.stopped){if(entry.ruleId)keep.add(entry.ruleId);}else await cleanup(Number(tab),entry.sessionId);
   }
   if(dnr){const rules=await dnr.getSessionRules();const removeRuleIds=rules.filter(rule=>rule.id>=FIRST&&rule.id<=LAST&&!keep.has(rule.id)).map(rule=>rule.id);if(removeRuleIds.length)await dnr.updateSessionRules({removeRuleIds});}
  }
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='page-lightener-cleanup')void enqueue(()=>recover()).catch(()=>{});});
  chrome.tabs.onRemoved.addListener(tab=>{void enqueue(()=>cleanup(tab)).catch(()=>{});});
  chrome.tabs.onUpdated.addListener((tab,change)=>{if(change.status==='loading')void enqueue(()=>cleanup(tab)).catch(()=>{});});
  chrome.runtime.onStartup.addListener(()=>{void enqueue(()=>recover(true)).catch(()=>{});});
  chrome.runtime.onInstalled.addListener(()=>{void enqueue(()=>recover(true)).catch(()=>{});});
  void enqueue(()=>recover()).catch(()=>{});
  return {supports,handle,after,cleanup,recover};
 }
 const api={create,metrics,FIRST,LAST};root.PageLightenerWorker=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
