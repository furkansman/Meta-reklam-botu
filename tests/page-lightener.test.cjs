const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../page-lightener.js'),workerApi=require('../page-lightener-worker.js');
class Element{
 constructor(tag,attrs={}){this.tagName=tag;this.attrs={...attrs};this.style={height:'',boxSizing:'',contentVisibility:'',containIntrinsicSize:''};this.isConnected=true;this.parentNode=null;this.parentElement=null;this.nextSibling=null;this.rect={top:-1000,bottom:-360,height:640};this.imgs=[];this.videos=[];this.sources=[];this.pauseCalls=0;this.loadCalls=0;}
 getAttribute(name){return this.attrs[name]??null;}setAttribute(name,value){this.attrs[name]=value;}removeAttribute(name){delete this.attrs[name];}
 getBoundingClientRect(){if(this.fail)throw new Error('layout unavailable');return this.rect;}
 querySelectorAll(selector){if(selector==='img')return this.imgs;if(selector==='video')return this.videos;if(selector==='source')return this.sources;return [];}
 contains(node){return node===this||this.imgs.includes(node)||this.videos.includes(node)||this.videos.some(v=>v.sources.includes(node));}
 pause(){this.pauseCalls++;}load(){this.loadCalls++;}
 remove(){const p=this.parentNode;if(p){p.sources=p.sources.filter(n=>n!==this);this.parentNode=null;}}
 insertBefore(node){node.parentNode=this;this.sources.push(node);}
}
const id=n=>'1234567890'+String(n).padStart(4,'0');
function harness({enabled=true,blockMedia=false}={}){
 let time=0;const messages=[];
 const controller=api.create({sessionId:'scan',now:()=>time,viewportHeight:()=>600,send:async message=>{messages.push(structuredClone(message));return message.type==='LIGHTENER_START'?{ok:true,enabled,blockMedia}:{ok:true,blocked:message.enabled};}});
 async function scroll(delta=10){controller.beforeScroll(100);time+=1000;await controller.afterScroll(100+delta);}
 async function baseline(){for(let i=0;i<3;i++)await scroll(10);}
 function cards(n=80){const cards=[],records=[];for(let i=0;i<n;i++){const card=new Element('ARTICLE'),img=new Element('IMG',{src:'https://cdn.example/'+i+'.jpg',srcset:'https://cdn.example/'+i+'-large.jpg 2x'});card.textContent='Library ID: '+id(i);card.imgs.push(img);cards.push(card);records.push({id:id(i),mediaUrl:img.getAttribute('src')});controller.track(card,id(i));}return {cards,records};}
 return {controller,messages,scroll,baseline,cards,advance:ms=>{time+=ms;}};
}
test('unacknowledged cards are never changed, including a failed/unread first card',async()=>{
 const h=harness();await h.controller.start();await h.baseline();const {cards,records}=h.cards();h.controller.runBatch();assert(cards.every(c=>c.imgs[0].getAttribute('src')));
 await h.controller.committed(records.slice(1));assert(cards[0].imgs[0].getAttribute('src'));assert.equal(h.controller.snapshot().lightened,19);
});
test('latest 60 and visible cards are preserved; height and text survive batch media removal',async()=>{
 const h=harness();await h.controller.start();await h.baseline();const {cards,records}=h.cards();cards[0].rect={top:0,bottom:640,height:640};await h.controller.committed(records);
 assert(cards[0].imgs[0].getAttribute('src'));assert.equal(cards[1].style.height,'640px');assert.equal(cards[1].style.boxSizing,'border-box');assert.equal(cards[1].style.contentVisibility,'auto');assert.equal(cards[1].style.containIntrinsicSize,'auto 640px');assert.equal(cards[1].imgs[0].getAttribute('src'),null);assert.equal(cards[1].imgs[0].getAttribute('srcset'),null);assert.equal(cards[1].textContent,'Library ID: '+id(1));assert(cards.slice(-60).every(c=>c.imgs[0].getAttribute('src')));assert.equal(records[1].mediaUrl,'https://cdn.example/1.jpg');
});
test('video is paused and unloaded only after save; sources are restored for a new scan',async()=>{
 const h=harness();await h.controller.start();await h.baseline();const {cards,records}=h.cards();const video=new Element('VIDEO',{src:'https://cdn.example/a.mp4'}),source=new Element('SOURCE',{src:'https://cdn.example/b.mp4'});source.parentNode=video;video.sources=[source];cards[0].videos=[video];await h.controller.committed(records);
 assert.equal(video.pauseCalls,1);assert.equal(video.loadCalls,1);assert.equal(video.getAttribute('src'),null);assert.equal(video.sources.length,0);h.controller.restoreAll();assert.equal(video.getAttribute('src'),'https://cdn.example/a.mp4');assert.equal(video.sources[0],source);assert.equal(cards[0].style.height,'');assert.equal(cards[0].imgs[0].getAttribute('src'),'https://cdn.example/0.jpg');
});
test('one media/layout failure increments errors, skips the card and allows later cards',async()=>{
 const h=harness();await h.controller.start();await h.baseline();const {cards,records}=h.cards();cards[0].fail=true;await h.controller.committed(records);assert.equal(h.controller.snapshot().errors,1);assert(cards[0].imgs[0].getAttribute('src'));assert.equal(cards[1].imgs[0].getAttribute('src'),null);
});
test('safety disables further lightening after three low-growth rounds without bulk media reload',async()=>{
 const h=harness();await h.controller.start();await h.baseline();const {cards,records}=h.cards();await h.controller.committed(records);assert(h.controller.snapshot().lightened>0);await h.scroll(1);await h.scroll(1);assert(h.controller.snapshot().enabled);await h.scroll(1);assert.equal(h.controller.snapshot().enabled,false);assert.equal(h.controller.snapshot().warning,'Hafifletme kapatıldı: yükleme düştü');assert.equal(cards[0].imgs[0].getAttribute('src'),null);h.controller.restoreAll();assert(cards[0].imgs[0].getAttribute('src'));
});
test('experimental blocking waits for three baseline rounds and is removed by safety and stop',async()=>{
 const h=harness({enabled:false,blockMedia:true});await h.controller.start();await h.scroll();await h.scroll();assert(!h.messages.some(m=>m.type==='LIGHTENER_BLOCK'));await h.scroll();assert.equal(h.controller.snapshot().blocked,true);await h.scroll(0);await h.scroll(0);await h.scroll(0);assert.equal(h.controller.snapshot().blocked,false);assert(h.messages.some(m=>m.type==='LIGHTENER_BLOCK'&&m.enabled===false));await h.controller.finish();assert(h.messages.some(m=>m.type==='LIGHTENER_STOP'));
});
test('both disabled preserve the legacy path; last-50 speed and every-200 log still report',async()=>{
 const h=harness({enabled:false});assert.deepEqual(await h.controller.start(),{legacy:true});await h.baseline();const {cards,records}=h.cards(200);for(let i=0;i<records.length;i+=25){h.advance(1000);await h.controller.committed(records.slice(i,i+25));}assert(cards.every(c=>c.imgs[0].getAttribute('src')));assert.equal(h.controller.snapshot().lightened,0);assert(h.messages.some(m=>m.type==='LIGHTENER_REPORT'&&m.log&&m.metrics.total===200&&m.metrics.speed>0));
});
function workerHarness(){
 const store={scan:{running:true,tabId:7,sessionId:'scan'},pageLightenerSettings:{enabled:true,blockMedia:true}},rules=[],events={};let queue=Promise.resolve();
 const event=name=>({addListener(fn){(events[name]??=[]).push(fn);}});
 const chrome={runtime:{id:'test',onStartup:event('startup'),onInstalled:event('installed')},storage:{local:{async get(keys){if(typeof keys==='string')keys=[keys];return structuredClone(Object.fromEntries(keys.filter(k=>k in store).map(k=>[k,store[k]])));},async set(value){Object.assign(store,structuredClone(value));}}},tabs:{async get(id){return {id}},onRemoved:event('removed'),onUpdated:event('updated')},alarms:{async create(){},onAlarm:event('alarm')},declarativeNetRequest:{async getSessionRules(){return structuredClone(rules)},async updateSessionRules({removeRuleIds=[],addRules=[]}){for(const id of removeRuleIds){const i=rules.findIndex(r=>r.id===id);if(i>=0)rules.splice(i,1);}rules.push(...structuredClone(addRules));}}};
 const enqueue=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};const service=workerApi.create(chrome,{enqueue});const sender={id:'test',frameId:0,tab:{id:7},url:'https://www.facebook.com/ads/library/?q=test'};return {store,rules,service,sender,events,chrome,enqueue,async idle(){await queue;}};
}
test('DNR rules are session-scoped to one tab and exactly the requested resource/domain set',async()=>{
 const h=workerHarness();await h.idle();await h.service.handle({type:'LIGHTENER_START',sessionId:'scan'},h.sender);await h.service.handle({type:'LIGHTENER_BLOCK',sessionId:'scan',enabled:true},h.sender);assert.equal(h.rules.length,1);assert.deepEqual(h.rules[0].condition,{tabIds:[7],requestDomains:['fbcdn.net','fbsbx.com'],resourceTypes:['image','media','font']});await h.service.after({type:'META_SCAN_FINISHED',sessionId:'scan'},h.sender,{ok:true});assert.equal(h.rules.length,0);
});
test('DNR rules are removed on stop, tab closure and stale-worker recovery',async()=>{
 for(const mode of ['stop','removed','recover']){const h=workerHarness();await h.idle();await h.service.handle({type:'LIGHTENER_START',sessionId:'scan'},h.sender);await h.service.handle({type:'LIGHTENER_BLOCK',sessionId:'scan',enabled:true},h.sender);if(mode==='stop')await h.service.after({type:'STOP_SCAN'},{id:'test'},{ok:true});if(mode==='removed'){for(const fn of h.events.removed)fn(7);await h.idle();}if(mode==='recover'){h.store.scan.running=false;await h.service.recover();}assert.equal(h.rules.length,0);}
});
test('foreign tabs/frames/sessions cannot activate media blocking; watch mode stays untouched',async()=>{
 const h=workerHarness();await h.idle();for(const sender of [{...h.sender,frameId:1},{...h.sender,tab:{id:8}},{...h.sender,id:'other'}])await assert.rejects(()=>h.service.handle({type:'LIGHTENER_START',sessionId:'scan'},sender));h.store.scan.running=false;h.store.watchRun={running:true,active:{tabId:7,sessionId:'scan'}};const response=await h.service.handle({type:'LIGHTENER_START',sessionId:'scan'},h.sender);assert.equal(response.bypass,true);assert.equal(response.blockMedia,false);
});
test('rule removal failure is retained for cleanup retry rather than silently abandoning the tab rule',async()=>{
 const h=workerHarness();await h.idle();await h.service.handle({type:'LIGHTENER_START',sessionId:'scan'},h.sender);await h.service.handle({type:'LIGHTENER_BLOCK',sessionId:'scan',enabled:true},h.sender);
 const update=h.chrome.declarativeNetRequest.updateSessionRules;let fail=true;h.chrome.declarativeNetRequest.updateSessionRules=async value=>{if(fail&&value.removeRuleIds?.length){fail=false;throw new Error('transient failure');}return update(value);};
 await assert.rejects(()=>h.service.handle({type:'LIGHTENER_BLOCK',sessionId:'scan',enabled:false},h.sender));assert.equal(h.store.lightenerSessions[7].stopped,true);assert.equal(h.rules.length,1);await h.service.recover();assert.equal(h.rules.length,0);
});
test('safety reference follows the three rounds immediately before the first actual change',async()=>{
 const h=harness();await h.controller.start();await h.baseline();const initial=h.cards(40);await h.controller.committed(initial.records);
 for(let i=0;i<3;i++)await h.scroll(100);
 const more=h.cards(80);await h.controller.committed(more.records);assert(h.controller.snapshot().lightened>0);
 for(let i=0;i<3;i++)await h.scroll(20);
 assert.equal(h.controller.snapshot().enabled,false);assert.equal(h.controller.snapshot().warning,'Hafifletme kapatıldı: yükleme düştü');
});
test('batch geometry is read before media/style writes to avoid repeated layout recalculation',async()=>{
 const h=harness();await h.controller.start();await h.baseline();const {cards,records}=h.cards();const events=[];
 for(const card of cards){const rect=card.getBoundingClientRect.bind(card);card.getBoundingClientRect=()=>{events.push('read');return rect();};const img=card.imgs[0],remove=img.removeAttribute.bind(img);img.removeAttribute=name=>{events.push('write');remove(name);};}
 await h.controller.committed(records.slice(0,20));const firstWrite=events.indexOf('write');assert(firstWrite>=20);assert(!events.slice(firstWrite).includes('read'));
});
test('recycled elements restore geometry without overwriting the new ad media URL',async()=>{
 const h=harness();await h.controller.start();await h.baseline();const {cards,records}=h.cards();await h.controller.committed(records);
 const card=cards[0];assert.equal(card.style.height,'640px');card.textContent='Library\u200bID: 9999999999999999';card.imgs[0].setAttribute('src','https://cdn.example/new-ad.jpg');h.controller.prepare(card);
 assert.equal(card.style.height,'');assert.equal(card.imgs[0].getAttribute('src'),'https://cdn.example/new-ad.jpg');h.controller.restoreAll();assert.equal(card.imgs[0].getAttribute('src'),'https://cdn.example/new-ad.jpg');
});
