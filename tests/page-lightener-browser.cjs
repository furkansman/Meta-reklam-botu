const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{webcrypto}=require('node:crypto');
const AdData=require('../ad-data.js'),PageLightenerWorker=require('../page-lightener-worker.js');
const root=path.resolve(__dirname,'..'),TARGET=Number(process.env.LIGHTENER_TEST_ADS||240);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const results=[];
 try{for(const options of [{enabled:false,blockMedia:false},{enabled:true,blockMedia:false},{enabled:true,blockMedia:true}]){
  const page=await browser.newPage({viewport:{width:1000,height:700}}),store={pageLightenerSettings:options},session={},rules=[],writes=[],errors=[];let listener;
  const events={};const event=name=>({addListener(fn){(events[name]??=[]).push(fn);if(name==='message')listener=fn;}});
  const chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,async sendMessage(){},onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup')},storage:{local:{async setAccessLevel(){},async get(keys){if(typeof keys==='string')keys=[keys];return structuredClone(Object.fromEntries(keys.filter(k=>k in store).map(k=>[k,store[k]])));},async set(values){writes.push(structuredClone(values));Object.assign(store,structuredClone(values));},async remove(keys){for(const k of keys)delete store[k];}},session:{async setAccessLevel(){},async get(keys){if(typeof keys==='string')keys=[keys];return structuredClone(Object.fromEntries(keys.filter(k=>k in session).map(k=>[k,session[k]])));},async set(values){Object.assign(session,structuredClone(values));}}},tabs:{async query(){return [{id:7,url:page.url()}];},async get(){return {id:7,url:page.url()};},async sendMessage(id,msg){return page.evaluate(msg=>new Promise(resolve=>window.collector(msg,{id:'test'},resolve)),msg);},onUpdated:event('updated'),onRemoved:event('removed')},alarms:{async create(){},async clear(){},onAlarm:event('alarm')},scripting:{async executeScript(){}},declarativeNetRequest:{async getSessionRules(){return structuredClone(rules)},async updateSessionRules({removeRuleIds=[],addRules=[]}){for(const id of removeRuleIds){const i=rules.findIndex(r=>r.id===id);if(i>=0)rules.splice(i,1);}rules.push(...structuredClone(addRules));}}};
  const context={chrome,PageLightenerWorker,AdData,crypto:webcrypto,URL,Date,AbortSignal,console,setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(root+'/background.js','utf8'),context);
  const send=(message,sender)=>new Promise(resolve=>listener(message,sender,resolve));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='www.facebook.com')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<style>article{height:640px;box-sizing:border-box;border:1px solid #ddd;padding:10px;margin:10px}img{width:500px;height:200px}video{height:100px}</style><main></main>'});
   if(rules.length&&/fbcdn\.net$/.test(url.hostname))return route.abort('blockedbyclient');
   return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><rect width="500" height="200" fill="blue"/></svg>'});
  });
  await page.goto('https://www.facebook.com/ads/library/?q=lightener-test');
  await page.exposeFunction('runtimeSend',message=>send(message,{id:'test',tab:{id:7},frameId:0,url:page.url()}));await page.exposeFunction('sessionSet',values=>chrome.storage.session.set(values));
  await page.evaluate(target=>{window.targetCards=target;
   window.chrome={runtime:{id:'test',sendMessage:runtimeSend,onMessage:{addListener(fn){window.collector=fn;}}},storage:{session:{set:sessionSet}}};
   window.addCards=(count)=>{for(let i=0;i<count;i++){const n=++window.cardCount,id=(8800000000000000n+BigInt(n)).toString(),card=document.createElement('article');card.dataset.testId=id;card.innerHTML=`<div>Library ID: ${id}</div><div><b>Test Marka</b><span>Sponsored</span></div><p>İlk anlamlı hook. İkinci cümle.</p><p>Started running on 1 October 2026</p><img src="https://scontent.fbcdn.net/${n}.svg" srcset="https://scontent.fbcdn.net/${n}.svg 1x" width="500" height="200">${n===1?'<video src="https://video.fbcdn.net/creative.mp4"><source src="https://video.fbcdn.net/alt.mp4"></video>':''}<a href="https://example.org"><strong>Yeni teklif</strong><button>Get Quote</button></a><button>See ad details</button>`;document.querySelector('main').append(card);}};
   window.cardCount=0;window.addCards(40);const native=window.scrollTo;window.scrollTo=(...args)=>{native.apply(window,args);if(window.cardCount<window.targetCards)setTimeout(()=>window.addCards(Math.min(25,window.targetCards-window.cardCount)),200);};
  },TARGET);
  page.on('pageerror',e=>errors.push(e.message));
  for(const file of ['ad-data.js','scan-loop.js','page-lightener.js','content.js'])await page.addScriptTag({content:fs.readFileSync(root+'/'+file,'utf8')});
  const started=performance.now();const response=await send({type:'START_SCAN',settings:{autoScroll:true,speed:'medium',maxAds:TARGET}},{id:'test',url:'chrome-extension://test/popup.html'});assert(response.ok);
  for(let i=0;store.scan?.running&&i<20000;i++)await page.waitForTimeout(10);
  console.log('STATUS '+JSON.stringify({options,metrics:store.pageLightenerStatus,elapsedSeconds:(performance.now()-started)/1000}));assert.equal(store.scan.running,false);assert.equal(store.scan.reason,'limit');assert.equal(store.ads.length,TARGET);assert.equal(rules.length,0);assert.deepEqual(errors,[]);
  assert.equal(store.ads[0].mediaUrl,'https://video.fbcdn.net/creative.mp4');assert.equal(store.ads[1].mediaUrl,'https://scontent.fbcdn.net/2.svg');
  const dom=await page.evaluate(()=>({firstSrc:document.querySelector('article img').getAttribute('src'),firstHeight:document.querySelector('article').getBoundingClientRect().height,firstStyle:document.querySelector('article').style.height,latest:[...document.querySelectorAll('article')].slice(-60).map(card=>card.querySelector('img').getAttribute('src'))}));
  if(options.enabled){assert(store.pageLightenerStatus.lightened>0);assert.equal(dom.firstSrc,null);assert.equal(dom.firstHeight,640);assert.equal(dom.firstStyle,'640px');assert(dom.latest.every(Boolean));}
  else{assert.equal(store.pageLightenerStatus.lightened,0);assert(dom.firstSrc);}
  assert(store.pageLightenerLog.some(item=>item.total===200));
  const fields=['id','advertiser','fullText','hook','headline','cta','startDate','mediaType','mediaUrl','targetUrl','platforms'];results.push(store.ads.map(ad=>Object.fromEntries(fields.map(key=>[key,ad[key]]))));
  console.log(`PASS: lightening ${options.enabled}, blocking ${options.blockMedia}: ${TARGET} records preserved in ${((performance.now()-started)/1000).toFixed(2)}s, ${store.pageLightenerStatus.lightened} old cards reduced, no lingering rules.`);
  await page.close();
 }
 assert.deepEqual(results[0],results[1]);assert.deepEqual(results[0],results[2]);console.log('PASS: all extracted IDs, hooks, headlines, CTA, dates, media/target URLs and platforms are identical across off/on/blocking cases.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
