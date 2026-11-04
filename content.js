(() => {
  'use strict';
  const VERSION = '0.9.2';
  if (globalThis.__metaAdCollector?.version === VERSION) return;
  // A previous boolean guard belongs to an older, non-disposable collector.
  if (globalThis.__metaAdCollector === true) return;
  globalThis.__metaAdCollector?.dispose?.();

  const ID_LABEL = /(Kütüphane Kodu|Library ID)\s*:?\s*(\d{10,})/gi;
  const DELAYS = { slow: 3000, medium: 1800, fast: 1000 };
  let session = null;
  let wake = null;
  const onLibrary = () => location.hostname === 'www.facebook.com' && /^\/ads\/library\/?$/.test(location.pathname);
  const textOf = (node) => (node.innerText || node.textContent || '').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();

  function safeUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (!['https:', 'http:'].includes(url.protocol)) return null;
      if (url.hostname === 'l.facebook.com' || url.hostname === 'lm.facebook.com') {
        const destination = url.searchParams.get('u');
        return destination ? safeUrl(destination) : url.href;
      }
      return url.href;
    } catch { return null; }
  }

  const normalized = (node) => textOf(node).replace(/\s+/g, ' ').trim();
  const isSponsored = (node) => /^(Sponsorlu|Sponsored)$/i.test(normalized(node));
  const isDetails = (node) => /^(Reklam Detaylarını Gör|See ad details)$/i.test(normalized(node));
  function visible(node) {
    return !node.closest('script,style,noscript,[hidden],[aria-hidden="true"]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  }
  function matchesIds(node) {
    return [...normalized(node).matchAll(new RegExp(ID_LABEL.source, ID_LABEL.flags))];
  }
  function advertiserAbove(sponsor, card) {
    for (let scope = sponsor.parentElement; scope && card.contains(scope); scope = scope.parentElement) {
      const preceding = [...scope.querySelectorAll('a,h1,h2,h3,h4,h5,h6,strong,b,span,div,p')].filter((node) => {
        const name = normalized(node);
        return !node.contains(sponsor) && visible(node) &&
          Boolean(node.compareDocumentPosition(sponsor) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          name.length >= 2 && name.length <= 200 && /[\p{L}]/u.test(name) &&
          !isSponsored(node) && !isDetails(node) && !matchesIds(node).length &&
          !/^(active|inactive|aktif|etkin|started running)/i.test(name) &&
          ![...node.children].some((child) => normalized(child) === name);
      });
      const node = preceding.at(-1);
      if (node) {
        const anchor = node.closest('a[href]') || node.querySelector('a[href]');
        return { name: normalized(node), url: anchor && card.contains(anchor) ? safeUrl(anchor.href) : null, node };
      }
      if (scope === card) break;
    }
    return null;
  }
  function cardHeader(card) {
    const nodes = [...card.querySelectorAll('*')].filter(visible);
    const details = nodes.find((node) => isDetails(node) && ![...node.children].some(isDetails));
    if (!details) return null;
    for (const sponsor of nodes.filter((node) => isSponsored(node) && ![...node.children].some(isSponsored))) {
      const advertiser = advertiserAbove(sponsor, card);
      if (advertiser) return { details, sponsor, advertiser };
    }
    return null;
  }
  let discovery = { candidates: 0, matched: 0, libraryCodeTexts: 0, version: VERSION };
  function createIndex(current) {
    const roots = new Set(), ready = new Map(), processed = new WeakSet(), elementIds = new WeakMap();
    let seen = new Set(), skipped = new Set(), invalid = new Set();
    const clean = value => String(value || '').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    const idsIn = node => [...clean(textOf(node)).replace(/\s+/g, ' ').matchAll(new RegExp(ID_LABEL.source, ID_LABEL.flags))];
    function enqueue(node) {
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (!element || element.closest('script,style,noscript')) return;
      current.lightener?.prepare(element);
      // React can recycle an old card element for a different ID. Restore it before reading.
      for (let old = element; old && old !== document.body; old = old.parentElement) {
        const prior = current.lightened.get(old);
        if (prior) { old.style.contentVisibility = prior.visibility; old.style.containIntrinsicSize = prior.size; }
      }
      if ([...roots].some(root => root.contains(element))) return;
      for (const root of roots) if (element.contains(root)) roots.delete(root);
      roots.add(element);
    }
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') enqueue(record.target);
        else for (const node of record.addedNodes) enqueue(node);
      }
      if (wake) wake();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    function scan(root) {
      if (!root.isConnected) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement.closest('script,style,noscript')) continue;
        const estimate = node.textContent.match(/(?:[~≈]\s*)?(\d+(?:[.,\u00a0 ]\d{3})*)\s*(?:sonuç|results)(?![\p{L}])/iu);
        if (estimate) current.reportedTotal = Number(estimate[1].replace(/[^\d]/g, ''));
        if (!/Kütüphane|Library/i.test(clean(node.textContent))) continue;
        // No ancestor-depth limit: Meta may split a label and ID across many wrappers.
        // innerText preserves boundaries between block elements, unlike textContent.
        let marker = node.parentElement, matches = [];
        while (marker && marker !== document.body) {
          matches = idsIn(marker);
          if (matches.length) break;
          marker = marker.parentElement;
        }
        if (!matches.length) { invalid.add(node.parentElement); continue; }
        for (const match of matches) {
          const id = match[2]; seen.add(id);
          if (current.ids.has(id)) { skipped.add(id); continue; }
          for (let card = marker; card && card !== document.body; card = card.parentElement) {
            const ids = new Set(idsIn(card).map(item => item[2]));
            // Never borrow the neighbouring card's advertiser or details button.
            if (ids.size !== 1 || !ids.has(id)) break;
            const header = cardHeader(card);
            if (header) {
              if (!processed.has(card) || elementIds.get(card) !== id) ready.set(id, { element: card, header });
              break;
            }
          }
        }
      }
    }
    function diagnostics() {
      discovery.candidates = seen.size + invalid.size;
      discovery.found = discovery.candidates;
      discovery.skipped = skipped.size;
      discovery.matched = current.ads.size + ready.size;
      discovery.unreadable = invalid.size;
      return ready;
    }
    function drain() {
      for (const root of roots) scan(root);
      roots.clear();
      return diagnostics();
    }
    return {
      drain,
      beginRound() { seen = new Set(ready.keys()); skipped = new Set(); invalid = new Set(); discovery.processed = 0; },
      fullScan() {
        scan(document.body);
        // Count split labels too, without reading the entire page's innerText.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), text = [];
        let node;
        while ((node = walker.nextNode())) if (!node.parentElement.closest('script,style,noscript')) text.push(node.textContent);
        discovery.libraryCodeTexts = (clean(text.join(' ')).match(/Kütüphane\s+Kodu/gi) || []).length;
        return diagnostics();
      },
      mark(card, id) { processed.add(card); elementIds.set(card, id); discovery.processed++; },
      dispose() { observer.disconnect(); roots.clear(); ready.clear(); }
    };
  }

  function callToAction(card, sponsor) {
    const candidates = [...card.querySelectorAll('button,[role="button"],a[href]')].filter((node) => {
      const label = normalized(node);
      return visible(node) && !isDetails(node) && label.length > 1 && label.length < 100 &&
        Boolean(sponsor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !/^(play|pause|mute|unmute|next|previous|sonraki|önceki|oynat|duraklat|see more|daha fazla gör)$/i.test(label) &&
        (node.matches('button,[role="button"]') || /^(shop|shop now|learn more|get quote|send message|contact us|book now|sign up|apply now|download|buy now|satın al|alışveriş yap|teklif al|daha fazla bilgi al|whatsapp mesajı gönder|mesaj gönder|hemen başvur|kaydol|indir)$/i.test(label));
    });
    return candidates.at(-1) || null;
  }
  function linkHeadline(card, cta, advertiser) {
    if (!cta) return { headline: '', block: null, heading: null };
    const invalid = (text) => /^(?:whatsapp|instagram|facebook|messenger|https?:\/\/\S+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/i.test(text);
    for (let scope = cta.parentElement; scope && card.contains(scope); scope = scope.parentElement) {
      const previous = cta.previousElementSibling;
      const possible = scope === card ? (previous?.matches('h1,h2,h3,h4,h5,h6,strong,b,[role="heading"]') ? [previous] : []) : [...scope.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,[role="heading"],div,span')];
      const headings = possible.filter((node) => {
        const label = normalized(node);
        return !node.contains(cta) && !cta.contains(node) && !node.contains(advertiser.node) &&
          Boolean(node.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          label && label !== advertiser.name && !invalid(label) && !isSponsored(node) && !matchesIds(node).length &&
          ![...node.children].some((child) => normalized(child) === label) &&
          (node.matches('h1,h2,h3,h4,h5,h6,strong,b,[role="heading"]') || Number.parseInt(getComputedStyle(node).fontWeight,10) >= 600);
      });
      if (headings.length) return { headline: normalized(headings.at(-1)), block: scope === card ? headings.at(-1) : scope, heading: headings.at(-1) };
      if (scope === card) break;
    }
    return { headline: '', block: cta.parentElement !== card ? cta.parentElement : null, heading: null };
  }
  function extract(id, record) {
    const { element: card, header } = record;
    const rawText = textOf(card);
    const parsedText = AdData.parseCardText(rawText,header.advertiser.name);
    const links = [...new Set([...card.querySelectorAll('a[href]')].map((node) => safeUrl(node.href)).filter(Boolean))];
    const ctaNode = callToAction(card, header.sponsor);
    const { block: linkBlock } = linkHeadline(card, ctaNode, header.advertiser);
    const platformText = [...card.querySelectorAll('[aria-label],[title],[alt]')].map((node) =>
      [node.getAttribute('aria-label'),node.getAttribute('title'),node.getAttribute('alt')].filter(Boolean).join(' ')).join(' ');
    const platforms = ['facebook','instagram','messenger','audience network','whatsapp'].filter((name) => new RegExp('(?:^|[^a-z])' + name + '(?:$|[^a-z])','i').test(platformText));
    const creativeImages = [...card.querySelectorAll('img')].filter((img) => {
      const url = img.currentSrc || img.src;
      return Boolean(header.sponsor.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !/s(?:40|60)x(?:40|60)|avatar|profile|profil/i.test(url + ' ' + (img.getAttribute('alt') || '') + ' ' + (img.getAttribute('aria-label') || '')) &&
        !/^(facebook|instagram|messenger|whatsapp|audience network)$/i.test(img.getAttribute('alt') || '') &&
        !(img.naturalWidth > 0 && img.naturalWidth <= 80 && img.naturalHeight <= 80);
    }).sort((a,b) => Math.max(b.naturalWidth*b.naturalHeight,b.width*b.height)-Math.max(a.naturalWidth*a.naturalHeight,a.width*a.height));
    const images = creativeImages.map((img) => safeUrl(img.currentSrc || img.src)).filter(Boolean);
    const videos = [...new Set([...card.querySelectorAll('video,video source')].flatMap((video) => [video.currentSrc,video.src]).filter((url) => /^https?:/i.test(url || '') && /\.mp4(?:[?#]|$)/i.test(url)))];
    const carousel = (images.length > 1 || card.querySelectorAll('video').length > 1) && (
      [...card.querySelectorAll('[aria-roledescription],[aria-label],button,[role="button"]')].some((node) => /carousel|karusel|döngü|sonraki|next|slide|slayt/i.test((node.getAttribute('aria-roledescription') || '') + ' ' + (node.getAttribute('aria-label') || '') + ' ' + normalized(node))) ||
      [...card.querySelectorAll('div')].some((node) => node.scrollWidth > node.clientWidth + 20 && /auto|scroll/.test(getComputedStyle(node).overflowX)));
    const cta = parsedText.cta;
    const targetLinks = [...(linkBlock?.querySelectorAll('a[href]') || [])];
    if (linkBlock?.matches('a[href]')) targetLinks.unshift(linkBlock);
    if (ctaNode?.matches('a[href]')) targetLinks.unshift(ctaNode);
    const targetUrl = /whatsapp|instagram|messenger/i.test(cta) ? '' : targetLinks.map((node) => AdData.targetUrl(node.href)).find(Boolean) || '';
    return { id, libraryId: id, advertiser: header.advertiser.name, advertiserUrl: header.advertiser.url,
      fullText:parsedText.fullText, primaryText:parsedText.fullText, text:parsedText.fullText, hook:parsedText.hook, headline:parsedText.headline, cta:parsedText.cta,
      startDate: AdData.parseDate(rawText), platforms, mediaType: carousel ? 'carousel' : card.querySelector('video') ? 'video' : 'image',
      mediaUrl: card.querySelector('video') ? videos[0] || '' : images[0] || '', targetUrl,
      libraryUrl: `https://www.facebook.com/ads/library/?id=${id}`, collectedAt: new Date().toISOString() };
  }

  async function liveProgress(current,status='scanning') {
    if(Date.now()-current.lastProgress<500){current.pendingStatus=status;if(!current.progressTimer)current.progressTimer=setTimeout(()=>{current.progressTimer=null;void liveProgress(current,current.pendingStatus).catch(()=>{});},500-(Date.now()-current.lastProgress));return;}
    current.lastProgress=Date.now();
    const response=await chrome.runtime.sendMessage({type:'SCAN_PROGRESS',ads:current.ads.size,scrolls:current.scrollCount,status,discovery:{...discovery,speed:current.speed||null,slow:current.slow||false},reportedTotal:current.reportedTotal??null,versionEncounters:current.versionEncounters,recoveryRound:current.recoveryRound||0,sessionId:current.sessionId});
    if(!response?.ok)throw new Error(response?.error||'Canlı sayaç güncellenemedi.');
    if(!response.competitor)await chrome.storage.session.set({scanProgress:response.progress});
  }
  async function flush(current,finished=false,reason='running'){
    while(current.pending.length){
      const records=current.pending.slice(0,25);
      const response=await chrome.runtime.sendMessage({type:'META_SCAN_APPEND',sessionId:current.sessionId,records,batchId:`${current.sessionId}:${current.savedCount}`,scrollCount:current.scrollCount,discovery:{...discovery,reportedTotal:current.reportedTotal??null,versionEncounters:current.versionEncounters,recoveryRound:current.recoveryRound||0,speed:current.speed||null,slow:current.slow||false,scrollY:window.scrollY}});
      if(!response?.ok)throw new Error(response?.error||'Reklam paketi kaydedilemedi.');
      current.pending.splice(0,records.length);current.savedCount+=records.length;
      await current.lightener?.committed(records);
    }
    if(finished){await current.lightener?.finish();const response=await chrome.runtime.sendMessage({type:'META_SCAN_FINISHED',sessionId:current.sessionId,ads:[...current.ads.values()],scrollCount:current.scrollCount,reason,discovery:{...discovery,reportedTotal:current.reportedTotal??null,versionEncounters:current.versionEncounters,speed:current.speed||null,slow:current.slow||false,scrollY:window.scrollY}});if(!response?.ok)throw new Error(response?.error||'Tarama sonlandırılamadı.');}
  }
  function waitUntil(current,predicate,timeout){
    return new Promise(resolve=>{
      let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);if(wake===check)wake=null;resolve();};
      const check=()=>{if(current.stopped||location.href!==current.url||predicate())finish();};
      const timer=setTimeout(finish,timeout);wake=check;check();
    });
  }
  function lighten(current,card){
    current.recent.push(card);
    // Preserve React's DOM and measured list height; only skip old offscreen rendering.
    if(current.recent.length>100){const old=current.recent.shift();if(old.isConnected){const prior=current.lightened.get(old)||{visibility:old.style.contentVisibility,size:old.style.containIntrinsicSize};current.lightened.set(old,prior);current.styles.push({node:new WeakRef(old),...prior});const height=Math.max(600,old.getBoundingClientRect().height);old.style.containIntrinsicSize=`0px ${height}px`;old.style.contentVisibility='hidden';}}
  }
  async function run(current){
    let reason='stopped',initialPassPending=true;discovery={candidates:0,matched:0,libraryCodeTexts:0,version:VERSION};
    const index=createIndex(current);current.index=index;
    const collect=async(forceFull=false)=>{
      const before=current.ads.size;
      index.beginRound();
      let queued=index.drain();
      // Existing DOM is authoritative when no new observer cards were found.
      const fullScanned=forceFull||!queued.size;
      if(fullScanned)queued=index.fullScan();
      for(const [id,record]of queued){
        if(current.ids.has(id)){index.drain().delete(id);continue;}
        if(current.ads.size>=current.settings.maxAds)break;
        let ad;
        try { ad=extract(id,record); if(!ad || ad.id!==id)throw new Error('Reklam ID okunamadı.'); }
        catch { queued.delete(id); discovery.extractionFailures=(discovery.extractionFailures||0)+1; continue; }
        current.ids.add(id);current.ads.set(id,ad);current.pending.push(ad);index.mark(record.element,id);
        if(/birden fazla versiyonu var|multiple versions|several versions/i.test(record.element.textContent||''))current.versionEncounters++;
        current.lightener?.track(record.element,id);if(current.useLegacy)lighten(current,record.element);index.drain().delete(id);
        if((current.ads.size-current.initialCount)%50===0){const elapsed=Math.max(.001,(performance.now()-current.speedAt)/1000);current.speed=3000/elapsed;current.baselineSpeed??=current.speed;current.slow=current.speed<current.baselineSpeed*.3;current.speedAt=performance.now();}
        if(current.pending.length>=25)await flush(current);
        await liveProgress(current);
        if(current.settings.autoRefresh&&current.ads.size>=current.nextRefresh&&current.ads.size<current.settings.maxAds){
          await flush(current);current.refreshing=true;const response=await chrome.runtime.sendMessage({type:'SCAN_REFRESH',sessionId:current.sessionId,scrollY:window.scrollY,scrollCount:current.scrollCount});
          if(!response?.ok){current.refreshing=false;throw new Error(response?.error||'Otomatik yenileme başlatılamadı.');}current.refreshing=true;current.stopped=true;break;
        }
      }
      if(current.ads.size===before&&!fullScanned&&!current.stopped){await collect(true);return;}
      if(current.ads.size>before)current.recoveryRound=0;
      await current.lightener?.afterScroll(current.ads.size);
      await liveProgress(current);
    };
    const waitForNew=timeout=>waitUntil(current,()=>index.drain().size>0,timeout);
    try{
      if(current.lightener){const result=await current.lightener.start();current.useLegacy=result.legacy;}
      // Process the complete current DOM before waiting for mutations or scrolling.
      await collect();
      if(!current.ads.size&&!current.stopped){
        await waitForNew(Math.max(0,5000-(Date.now()-current.startedAt)));
        await collect();
      }
      if(!current.ads.size&&!current.stopped){
        reason=discovery.extractionFailures?'extraction-failed':discovery.found ? (discovery.unreadable===discovery.found?'id-unreadable':'incomplete-cards') : 'no-cards';
      }else reason=await ScanLoop.run(current.settings,{stopped:()=>current.stopped||!onLibrary()||location.href!==current.url,count:()=>current.ads.size,collect:async()=>{if(initialPassPending){initialPassPending=false;return;}await collect();},waitForNew,
        scroll:async()=>{current.lightener?.beforeScroll(current.ads.size);window.scrollTo(0,document.body.scrollHeight);current.scrollCount++;await liveProgress(current);},
        recovery:async round=>{current.recoveryRound=round;await flush(current);await liveProgress(current);},
        clickMore:async()=>{[...document.querySelectorAll('button,[role="button"],a')].find(node=>visible(node)&&/^(daha fazla göster|daha çok göster|see more|load more|show more)$/i.test(normalized(node)))?.click();},
        bounce:async()=>{current.lightener?.beforeScroll(current.ads.size);window.scrollBy(0,-600);window.scrollTo(0,document.body.scrollHeight);current.scrollCount+=2;await liveProgress(current);},
        waitSpinner:timeout=>waitUntil(current,()=>![...document.querySelectorAll('[role="progressbar"],[aria-busy="true"],[aria-label*="loading" i],[aria-label*="yüklen" i],[class*="spinner" i]')].some(visible),timeout)
      });
      if(location.href!==current.url)reason='page-changed';
    }catch(error){console.warn('Meta Reklam Botu: tarama durdu.',error);reason='error';}
    finally{
      clearTimeout(current.progressTimer);index.dispose();
      if(!current.refreshing)try{await flush(current,true,reason);}catch(error){console.warn('Meta Reklam Botu: son kayıt gönderilemedi.',error);}
      for(const style of current.styles){const card=style.node.deref();if(card?.isConnected){card.style.contentVisibility=style.visibility;card.style.containIntrinsicSize=style.size;}}
      if(session===current)session=null;
    }
  }

  const onMessage = (message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'META_SCAN_STATUS') { respond({ running: Boolean(session), sessionId: session?.sessionId, version: VERSION }); return; }
    if (message?.type === 'META_SCAN_STOP') {
      if (session && message.sessionId !== session.sessionId) { respond({ ok: false }); return; }
      if (session) session.stopped = true;
      wake?.();
      respond({ ok: true });
      return;
    }
    if (message?.type !== 'META_SCAN_START') return;
    (async () => {
      if (!onLibrary()) throw new Error('Meta Reklam Kütüphanesi sayfasını aç.');
      if (session) throw new Error('Bu sekmede zaten bir tarama çalışıyor.');
      const { settings, tabId, sessionId, resumeAds = [], resumeScrolls = 0, resumeVersionEncounters = 0, resumeReportedTotal = null } = message;
      if (!settings || !Number.isInteger(settings.maxAds) || settings.maxAds < 1 || settings.maxAds > 10000 ||
          !Object.hasOwn(DELAYS, settings.speed) || typeof settings.autoScroll !== 'boolean' || !Number.isInteger(tabId) || typeof sessionId !== 'string') {
        throw new Error('Tarama ayarları geçersiz.');
      }
      const current = { settings, tabId, sessionId, ads: new Map(resumeAds.map(ad=>[ad.id,ad])), savedCount:resumeAds.length, ids:new Set(resumeAds.map(ad=>ad.id)),pending:[],recent:[],styles:[],lightened:new WeakMap(),lastProgress:0,speedAt:performance.now(),initialCount:resumeAds.length,nextRefresh:(Math.floor(resumeAds.length/300)+1)*300,versionElements:new WeakMap(), versionEncounters:resumeVersionEncounters, reportedTotal:resumeReportedTotal, scrollCount:resumeScrolls, startedAt: Date.now(), url: location.href, stopped: false };
      globalThis.__lastPageLightener?.restoreAll();
      current.lightener=globalThis.PageLightener?.create({sessionId});current.useLegacy=!current.lightener;
      globalThis.__lastPageLightener=current.lightener;
      session = current;
      respond({ ok: true });
      if(message.scrollY)window.scrollTo(0,message.scrollY);
      void run(current);
    })().catch((error) => respond({ ok: false, error: error.message }));
    return true;
  };
  const onPageHide = () => { void session?.lightener?.stop();if (session) session.stopped = true; wake?.(); };
  chrome.runtime.onMessage.addListener(onMessage);
  addEventListener('pagehide', onPageHide);
  globalThis.__metaAdCollector = { version: VERSION, dispose() {
    onPageHide();
    chrome.runtime.onMessage.removeListener(onMessage);
    removeEventListener('pagehide', onPageHide);
  } };
})();
