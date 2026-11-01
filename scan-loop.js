(function(root){
  'use strict';
  async function run(settings,hooks){
    let misses=0, stallStart=null;
    const now=()=>hooks.now ? hooks.now() : Date.now();
    const alive=()=>!hooks.stopped();
    const collect=async()=>{const before=hooks.count();await hooks.collect();return hooks.count()>before;};
    await collect();
    if(!alive())return 'stopped';
    if(hooks.count()>=settings.maxAds)return 'limit';
    if(!settings.autoScroll)return hooks.count()?'visible-complete':'no-cards';
    while(alive()){
      const before=hooks.count(), started=now();
      await hooks.scroll();
      await hooks.waitForNew(4000);
      if(!alive())break;
      await collect();
      if(hooks.count()>=settings.maxAds)return 'limit';
      if(hooks.count()>before){misses=0;stallStart=null;continue;}
      misses++;
      if(stallStart===null)stallStart=started;
      if(now()-stallStart>=120000)return 'meta-exhausted';
      if(misses<6)continue;
      const deadline=stallStart+120000;
      let recovered=false;
      for(let round=0;round<3&&alive()&&now()<deadline;round++){
        await hooks.recovery(round+1);
        await hooks.clickMore();
        await hooks.bounce();
        if(!alive())break;
        await hooks.waitSpinner(Math.min(10000,Math.max(0,deadline-now())));
        await hooks.waitForNew(Math.min(1000*2**round,Math.max(0,deadline-now())));
        if(!alive())break;
        if(now()>=deadline)break;
        if(await collect()){recovered=true;misses=0;stallStart=null;break;}
      }
      if(!alive())break;
      if(hooks.count()>=settings.maxAds)return 'limit';
      if(!recovered)return 'meta-exhausted';
    }
    return 'stopped';
  }
  root.ScanLoop={run};if(typeof module!=='undefined'&&module.exports)module.exports={run};
})(globalThis);
