(() => {
  'use strict';
  const $=selector=>document.querySelector(selector),number=value=>(Number(value)||0).toLocaleString('tr-TR');
  let loading=false,lastEvents='',lastFailures='';
  const pieceLabel=piece=>piece.round?`Tur ${piece.round} · ${piece.cursor||'tarihsiz'}${piece.platform?' · '+piece.platform:''}`:`${piece.start}${piece.end!==piece.start?' → '+piece.end:''}${piece.media?' · '+piece.media:''}${piece.platform?' · '+piece.platform:''}`;
  async function refresh(){
    if(loading)return;loading=true;
    try{
      const [{chunkRun:run,chunkEvents=[],uiTheme},{scanProgress}]=await Promise.all([chrome.storage.local.get(['chunkRun','chunkEvents','uiTheme']),chrome.storage.session.get('scanProgress')]);
      document.documentElement.dataset.theme=uiTheme==='dark'?'dark':'light';
      const chunk=run?.visible,active=chunk?run.active:null;
      $('#panel-ads').textContent=number(chunk?run.uniqueCount:scanProgress?.ads);
      $('#panel-scrolls').textContent=number(chunk?run.scrollCount:scanProgress?.scrolls);
      const running=chunk?run.running:scanProgress?.status==='scanning';
      $('#panel-status').classList.toggle('scanning',Boolean(running));
      $('#panel-status').textContent=chunk?(run.stopReason||(!run.running&&run.phase!=='done'?'Durduruldu':null)||run.statusText||(run.running?'Taranıyor…':run.phase==='done'?'Tamamlandı':'Durduruldu')):({scanning:'Taranıyor…',stopped:'Durduruldu',completed:'Tamamlandı',ready:'Hazır'}[scanProgress?.status]||'Hazır');
      if(chunk){
        $('#panel-progress').textContent=`Tur ${active?.piece.round??run.round??1} · imleç: ${run.cursor||active?.piece.cursor||'tarihsiz'} · bu turda ${number(active?.newCount??run.last?.count)} yeni · toplam benzersiz ${number(run.uniqueCount)} · Meta'nın bildirdiği ${(active?.total??run.last?.total)!=null?'~'+number(active?.total??run.last?.total):'okunamadı'} · ${run.phase}`;
      }else $('#panel-progress').textContent='Uzun taramaların ilerlemesini bu panelden izleyebilirsin.';
      const failures=chunk?run.done.filter(item=>item.status==='failed'):[],failureKey=JSON.stringify(failures);
      if(failureKey!==lastFailures){lastFailures=failureKey;$('#panel-failures').replaceChildren();for(const item of failures){const li=document.createElement('li');li.textContent=`${pieceLabel(item.piece)}: ${item.error}`;$('#panel-failures').append(li);}}
      $('#panel-failures-empty').hidden=failures.length>0;
      const events=chunkEvents.slice(0,100),eventKey=JSON.stringify(events);
      if(eventKey!==lastEvents){lastEvents=eventKey;$('#panel-events').replaceChildren();for(const event of events){const li=document.createElement('li'),time=document.createElement('time'),title=document.createElement('strong'),reason=document.createElement('p');time.dateTime=new Date(event.at).toISOString();time.textContent=new Date(event.at).toLocaleTimeString('tr-TR',{timeZone:'Europe/Istanbul'})+' · '+event.piece;title.textContent=event.type;reason.textContent=event.reason||'';li.append(time,title,reason);$('#panel-events').append(li);}}
      $('#panel-events-empty').hidden=events.length>0;$('#panel-error').textContent='';
    }catch{ $('#panel-error').textContent='Tarama durumu okunamadı; bir sonraki saniyede yeniden denenecek.';}
    finally{loading=false;}
  }
  void refresh();setInterval(()=>{void refresh();},1000);
})();
