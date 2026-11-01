(() => {
  'use strict';
  const VERSION = '0.8.0';
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
  function cards() {
    // Use minimal matching elements, including labels split across sibling spans.
    // No generated classes, borders, or semantic article contracts are required.
    const elements = [...document.body.querySelectorAll('*')].filter((node) =>
      !node.closest('script,style,noscript') && visible(node));
    const markers = elements.filter((node) => matchesIds(node).length &&
      ![...node.children].some((child) => matchesIds(child).length));
    const found = new Map();
    let candidates = 0;
    for (const marker of markers) {
      for (const match of matchesIds(marker)) {
        const id = match[2];

        candidates++;
        for (let card = marker; card && card !== document.body; card = card.parentElement) {
          // Never use a shared result list to supply another ad's button/header.
          const ids = new Set(matchesIds(card).map((item) => item[2]));
          if (ids.size !== 1 || !ids.has(id)) break;
          const header = cardHeader(card);
          if (header) {
            if(session && /birden fazla versiyonu var|multiple versions|several versions/i.test(textOf(card))){
              let ids=session.versionElements.get(card);if(!ids){ids=new Set();session.versionElements.set(card,ids);}
              if(!ids.has(id)){ids.add(id);session.versionEncounters++;}
            }
            if(!found.has(id))found.set(id, { element: card, header }); break;
          }
        }
      }
    }
    const textNodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const text = [];
    let node;
    while ((node = textNodes.nextNode())) if (!node.parentElement.closest('script,style,noscript')) text.push(node.textContent);
    discovery = { candidates, matched: found.size,
      libraryCodeTexts: (text.join(' ').match(/Kütüphane\s+Kodu/gi) || []).length, version: VERSION };
    return found;
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

  async function liveProgress(current, status = 'scanning', record = null) {
    const response = await chrome.runtime.sendMessage({ type:'SCAN_PROGRESS', record, ads:current.ads.size,
      scrolls:current.scrollCount, status, reportedTotal:current.reportedTotal??null, versionEncounters:current.versionEncounters, recoveryRound:current.recoveryRound||0, sessionId:current.sessionId });
    if (!response?.ok) throw new Error(response?.error || 'Canlı sayaç güncellenemedi.');
    if(!response.competitor)await chrome.storage.session.set({ scanProgress:response.progress });
  }
  async function report(current, finished, reason) {
    const response = await chrome.runtime.sendMessage({ type: finished ? 'META_SCAN_FINISHED' : 'META_SCAN_PROGRESS',
      sessionId: current.sessionId, ads: [...current.ads.values()], scrollCount: current.scrollCount, reason, discovery });
    if (!response?.ok) throw new Error(response?.error || 'Tarama durumu kaydedilemedi.');
  }

  function waitUntil(current,predicate,timeout) {
    return new Promise((resolve)=>{
      let timer,observer,debounce,done=false;
      const finish=()=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(debounce);observer?.disconnect();if(wake===finish)wake=null;resolve();};
      wake=finish;
      const check=()=>{if(current.stopped||location.href!==current.url||predicate())finish();};
      observer=new MutationObserver(()=>{clearTimeout(debounce);debounce=setTimeout(check,50);});
      observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','aria-busy']});
      timer=setTimeout(finish,timeout);check();
    });
  }
  function scanMetadata(current) {
    const page=textOf(document.body);
    const matches=[...page.matchAll(/(?:[~≈]\s*)?(\d+(?:[.,\u00a0 ]\d{3})*)\s*(?:sonuç|results)(?![\p{L}])/giu)];
    const estimate=matches.map(match=>Number(match[1].replace(/[^\d]/g,''))).find(Number.isSafeInteger);
    if(estimate!==undefined)current.reportedTotal=estimate;
    return {reportedTotal:current.reportedTotal??null,versionEncounters:current.versionEncounters,recoveryRound:current.recoveryRound||0};
  }
  function scrollTarget(records) {
    let node=records.values().next().value?.element.parentElement;
    while(node&&node!==document.body&&!(node.scrollHeight>node.clientHeight+50&&/auto|scroll/.test(getComputedStyle(node).overflowY)))node=node.parentElement;
    return node&&node!==document.body?node:window;
  }
  async function run(current) {
    let reason='stopped';
    const metadata=()=>{Object.assign(discovery,scanMetadata(current));};
    const collect=async()=>{
      const before=current.ads.size;
      metadata();
      for(const [id,record] of cards()){
        if(current.ads.has(id)||current.ads.size>=current.settings.maxAds)continue;
        const ad=extract(id,record);current.ads.set(id,ad);
        await liveProgress(current,'scanning',ad);
        if(current.ads.size-current.savedCount>=25){await report(current,false,'running');current.savedCount=current.ads.size;}
      }
      // Also checkpoint each completed DOM pass; partial passes still save every 25.
      if(current.ads.size>before)current.recoveryRound=0;
      metadata();await report(current,false,'running');current.savedCount=current.ads.size;await liveProgress(current);
    };
    const waitForNew=(timeout)=>waitUntil(current,()=>[...cards().keys()].some(id=>!current.ads.has(id)),timeout);
    try{
      if(!cards().size)await waitForNew(12000);
      reason=await ScanLoop.run(current.settings,{
        stopped:()=>current.stopped||!onLibrary()||location.href!==current.url,
        count:()=>current.ads.size,collect,waitForNew,
        scroll:async()=>{const target=scrollTarget(cards());target.scrollBy({top:Math.max(500,(target===window?innerHeight:target.clientHeight)*({slow:.6,medium:.85,fast:1.2}[current.settings.speed])),behavior:'instant'});current.scrollCount++;await liveProgress(current);},
        recovery:async(round)=>{current.recoveryRound=round;metadata();await liveProgress(current);await report(current,false,'running');},
        clickMore:async()=>{const button=[...document.querySelectorAll('button,[role="button"],a')].find(node=>visible(node)&&/^(daha fazla göster|daha çok göster|see more|load more|show more)$/i.test(normalized(node)));button?.click();},
        bounce:async()=>{const target=scrollTarget(cards());target.scrollBy({top:-600,behavior:'instant'});target.scrollTo({top:target===window?document.scrollingElement.scrollHeight:target.scrollHeight,behavior:'instant'});current.scrollCount+=2;await liveProgress(current);},
        waitSpinner:(timeout)=>waitUntil(current,()=>![...document.querySelectorAll('[role="progressbar"],[aria-busy="true"],[aria-label*="loading" i],[aria-label*="yüklen" i],[class*="spinner" i]')].some(visible),timeout)
      });
      if(location.href!==current.url)reason='page-changed';
    }catch(error){console.warn('Meta Reklam Botu: tarama durdu.',error);reason='error';}
    finally{
      metadata();
      try{await liveProgress(current,['limit','visible-complete','no-new-ads','meta-exhausted'].includes(reason)?'completed':'stopped');}catch{}
      try{await report(current,true,reason);}catch(error){console.warn('Meta Reklam Botu: son kayıt gönderilemedi.',error);}
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
      const current = { settings, tabId, sessionId, ads: new Map(resumeAds.map(ad=>[ad.id,ad])), savedCount:resumeAds.length, versionElements:new WeakMap(), versionEncounters:resumeVersionEncounters, reportedTotal:resumeReportedTotal, scrollCount:resumeScrolls, startedAt: Date.now(), url: location.href, stopped: false };
      session = current;
      respond({ ok: true });
      void run(current);
    })().catch((error) => respond({ ok: false, error: error.message }));
    return true;
  };
  const onPageHide = () => { if (session) session.stopped = true; wake?.(); };
  chrome.runtime.onMessage.addListener(onMessage);
  addEventListener('pagehide', onPageHide);
  globalThis.__metaAdCollector = { version: VERSION, dispose() {
    onPageHide();
    chrome.runtime.onMessage.removeListener(onMessage);
    removeEventListener('pagehide', onPageHide);
  } };
})();
