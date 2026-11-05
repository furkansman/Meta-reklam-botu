(function(root){
 'use strict';
 function create({command,refreshState,perform,getState,isReady,isBusy}){
  const $=s=>document.querySelector(s),number=n=>(Number(n)||0).toLocaleString('tr-TR');let populated=false,startError='',attemptedUrl='',firstPreview='';
  const resumable=()=>{const run=getState().chunkRun;return Boolean(run?.mode==='cursor'&&run.visible&&!run.running&&run.phase!=='done'&&run.active?.phase!=='stopping');};
  function render(){
   const state=getState(),run=state.chunkRun,active=run?.active;
   if(!populated&&isReady()){const config=state.chunkConfig;if(config)for(const [key,id]of Object.entries({limit:'limit',target:'target',waitMin:'wait-min',waitMax:'wait-max'}))if(config[key]!=null)$(`#chunk-${id}`).value=config[key];$('#chunk-enabled').checked=Boolean(run?.visible);populated=true;}
   const locked=!isReady()||isBusy()||state.scan?.running||run?.running;
   $('#chunk-enabled').disabled=Boolean(locked);$('#chunk-fields').disabled=Boolean(locked||!$('#chunk-enabled').checked);$('#chunk-fields').hidden=!$('#chunk-enabled').checked;
   $('#chunk-start-button').disabled=Boolean(locked||!$('#chunk-enabled').checked);$('#chunk-add-pool').disabled=Boolean(locked||!$('#chunk-enabled').checked);$('#chunk-clear-pool').disabled=Boolean(locked);
   $('#chunk-stop-button').disabled=!run?.running||isBusy();$('#chunk-resume-button').disabled=!resumable()||isBusy();
   const visible=Boolean(run?.visible);$('#chunk-progress').hidden=!visible;$('#chunk-failures').replaceChildren();
   const url=attemptedUrl||(visible?run.baseUrl:''),first=firstPreview||(visible?run.firstUrl:'');let query='';try{query=new URL(url).search.slice(1);}catch{}
   $('#chunk-url-diagnostics').textContent=url?`Okunan adres (?): ${query||'(parametre yok)'}\nİlk tur adresi: ${first||'henüz oluşturulmadı'}${visible&&run.currentUrl?'\nBu tur adresi: '+run.currentUrl:''}`:'';
   if(!visible){$('#chunk-failures').hidden=true;$('#chunk-feedback').textContent=startError;return;}
   $('#chunk-progress').textContent=`Tur ${active?.piece.round??run.round??1} · imleç: ${run.cursor||active?.piece.cursor||'tarihsiz'} · bu turda ${number(active?.newCount??run.last?.count)} yeni · toplam benzersiz ${number(run.uniqueCount)} · Meta'nın bildirdiği ${active?.total!=null?'~'+number(active.total):run.last?.total!=null?'~'+number(run.last.total):'okunamadı'}`;
   $('#chunk-feedback').textContent=startError||run.stopReason||run.lastError||run.statusText||(run.running?'Taranıyor…':'Durduruldu');
   const failures=run.done.filter(item=>item.status==='failed');$('#chunk-failures').hidden=!failures.length;for(const item of failures){const li=document.createElement('li');li.textContent=`${ChunkScan.label(item.piece)}: ${item.error}`;$('#chunk-failures').append(li);}
  }
  $('#chunk-enabled').addEventListener('change',render);
  async function start(button,addPool){
   const config={limit:Number($('#chunk-limit').value),target:$('#chunk-target').value===''?null:Number($('#chunk-target').value),waitMin:Number($('#chunk-wait-min').value),waitMax:Number($('#chunk-wait-max').value),addPool};
   await perform(button,async()=>{
    startError='';attemptedUrl='';firstPreview='';$('#chunk-feedback').textContent='Aktif sekme okunuyor…';
    try{let tab;try{[tab]=await chrome.tabs.query({active:true,currentWindow:true});}catch{throw new Error('sekme bulunamadı: Aktif sekmenin adresi okunamadı.');}
     if(!Number.isInteger(tab?.id))throw new Error('sekme bulunamadı.');attemptedUrl=tab.url||'';if(!ChunkScan.library(attemptedUrl))throw new Error(ChunkScan.LIBRARY_HELP);
     ChunkScan.settings(config);firstPreview=ChunkScan.pieceUrl(attemptedUrl,{cursor:null});render();await command('START_CHUNKS',{config,sourceTabId:tab.id});await refreshState(true);
    }catch(error){startError=error.message;render();throw error;}
   });render();
  }
  $('#chunk-form').addEventListener('submit',event=>{event.preventDefault();if($('#chunk-enabled').checked)void start(event.submitter,true);});
  $('#chunk-add-pool').addEventListener('click',event=>{void start(event.currentTarget,true);});
  $('#chunk-stop-button').addEventListener('click',event=>{void perform(event.currentTarget,async()=>{await command('STOP_SCAN');await refreshState(true);}).then(render);});
  $('#chunk-resume-button').addEventListener('click',event=>{void perform(event.currentTarget,async()=>{await command('RESUME_CHUNKS');await refreshState(true);}).then(render);});
  $('#chunk-clear-pool').addEventListener('click',event=>{void perform(event.currentTarget,async()=>{await command('CLEAR_CURSOR_POOL');await refreshState(true);}).then(render);});
  return {render,resumable,appendDiagnostics(){}};
 }
 root.ChunkPopup={create};
})(globalThis);
