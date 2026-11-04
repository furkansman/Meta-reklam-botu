(() => {
  'use strict';
  if(globalThis.__metaChunkBridge)return;
  globalThis.__metaChunkBridge=true;
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id||message?.type!=='PING')return;
    respond({ok:true,ready:Boolean(globalThis.__metaAdCollector?.version),version:globalThis.__metaAdCollector?.version||null});
  });
})();
