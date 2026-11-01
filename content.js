(() => {
  'use strict';
  const VERSION = '0.4.0';
  if (globalThis.__metaAdCollector?.version === VERSION) return;
  // A previous boolean guard belongs to an older, non-disposable collector.
  if (globalThis.__metaAdCollector === true) return;
  globalThis.__metaAdCollector?.dispose?.();

  const ID_LABEL = /(?:Library ID|Ad Library ID|Kütüphane (?:Kimliği|Numarası|No(?:su)?)|Reklam Kütüphanesi Kimliği)\s*[:：]?\s*(\d{5,})/i;
  const LABEL = /Library ID|Ad Library ID|Kütüphane (?:Kimliği|Numarası|No)|Reklam Kütüphanesi Kimliği/i;
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

  const CARD_SELECTORS = [
    'div._7jvw', 'div[role="region"]', 'article', '[role="article"]',
    'div[style*="border" i]', '[data-pagelet*="AdLibrary"]', '[data-ad-id]'
  ];
  const SEMANTIC_CARD = 'div._7jvw,article,[role="article"],div[role="region"]';
  const MESSAGE_SELECTOR = '[data-ad-preview="message"],[data-ad-comet-preview="message"]';
  function cardIds(card) {
    const ids = [...textOf(card).matchAll(new RegExp(ID_LABEL.source, 'gi'))].map((match) => match[1]);
    for (const marker of card.querySelectorAll('[data-ad-id],a[href*="/ads/library"]')) {
      let id = marker.getAttribute('data-ad-id');
      if (!id && marker.href) { try { id = new URL(marker.href).searchParams.get('id'); } catch {} }
      if (/^\d{5,}$/.test(id || '')) ids.push(id);
    }
    const ownId = card.getAttribute('data-ad-id');
    if (/^\d{5,}$/.test(ownId || '')) ids.push(ownId);
    return [...new Set(ids)];
  }
  function adText(card) {
    const messages = [...card.querySelectorAll(MESSAGE_SELECTOR)];
    if (card.matches(MESSAGE_SELECTOR)) messages.unshift(card);
    if (messages.length) return [...new Set(messages.map(textOf).filter(Boolean))].join('\n');
    const nodes = [...card.querySelectorAll('[dir="auto"]')];
    const texts = nodes.filter((node) => !node.querySelector('[dir="auto"]')).map(textOf)
      .filter((text) => text && !ID_LABEL.test(text));
    // Plain-text layouts still retain their complete visible card content.
    return [...new Set(texts)].join('\n') || textOf(card);
  }
  function visible(card) {
    return !card.closest('script,style,[hidden],[aria-hidden="true"]') && card.getClientRects().length > 0 && getComputedStyle(card).visibility !== 'hidden';
  }
  function fingerprint(card) {
    const urls = [...card.querySelectorAll('a[href]')].map((link) => safeUrl(link.href)).filter(Boolean).sort();
    const media = [...card.querySelectorAll('img,video,source')].map((node) => node.getAttribute('src') || '').sort();
    const seed = JSON.stringify([adText(card), urls, media]);
    let first = 2166136261, second = 5381;
    for (let i = 0; i < seed.length; i++) {
      first = Math.imul(first ^ seed.charCodeAt(i), 16777619);
      second = Math.imul(second, 33) ^ seed.charCodeAt(i);
    }
    return `dom-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
  }
  let discovery = { candidates: 0, matched: 0, selectors: {} };
  function cards() {
    const pool = new Set();
    const counts = {};
    // Query separately: a Meta layout may only expose one of these contracts.
    for (const selector of CARD_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      counts[selector] = nodes.length;
      nodes.forEach((node) => pool.add(node));
    }
    // A labelled ID can still locate a card when no known class/border is present.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    const markers = [...document.querySelectorAll('[data-ad-id],a[href*="/ads/library"]')];
    while ((node = walker.nextNode())) if (LABEL.test(node.textContent)) markers.push(node.parentElement);
    for (const marker of markers) {
      let parent = marker;
      let largest;
      for (let depth = 0; depth < 12 && parent && parent !== document.body; depth++, parent = parent.parentElement) {
        if (parent.matches('main,[role="main"]')) break;
        const ids = cardIds(parent);
        if (ids.length > 1) break;
        if (ids.length === 1) largest = parent;
        if (parent.matches(SEMANTIC_CARD) && ids.length === 1 && parent.querySelector('a[href],img,video')) break;
      }
      if (largest) pool.add(largest);
    }
    const cache = new WeakMap();
    function evidence(card) {
      if (cache.has(card)) return cache.get(card);
      const ids = cardIds(card);
      const text = textOf(card);
      const hasMessage = Boolean(card.querySelector(MESSAGE_SELECTOR));
      const links = [...card.querySelectorAll('a[href]')].map((link) => safeUrl(link.href)).filter(Boolean);
      const hasMedia = Boolean(card.querySelector('img,video'));
      const hasStatus = /(?:Started running|Active|Inactive|Yayınlanmaya başla|Aktif|Etkin)/i.test(text);
      const semantic = card.matches(SEMANTIC_CARD);
      const payload = text.replace(new RegExp(ID_LABEL.source, 'gi'), '').trim();
      const enoughContent = payload.length >= 15;
      // A bare border, ID badge, navigation or image alone is not an advertisement.
      const supported = visible(card) && ids.length <= 1 && ((ids.length === 1 && payload.length > 0) ||
        ((hasMessage || enoughContent) && (links.length > 0 || hasMedia) && (semantic || hasMessage || hasStatus)));
      const value = { ids, supported };
      cache.set(card, value);
      return value;
    }
    const candidates = [...pool].filter((card) => evidence(card).supported);
    // DOM order makes a complete card win over its nested decorative borders.
    candidates.sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const found = new Map();
    const accepted = [];
    for (const card of candidates) {
      if (accepted.some((other) => other.contains(card))) continue;
      const own = evidence(card);
      const descendants = candidates.filter((other) => other !== card && card.contains(other));
      const branches = descendants.filter((other) => !descendants.some((ancestor) => ancestor !== other && ancestor.contains(other)));
      if (branches.length > 1 && (!own.ids.length || branches.filter((branch) => branch.matches(SEMANTIC_CARD)).length > 1)) continue;

      const id = own.ids[0] || fingerprint(card);
      if (!found.has(id)) { found.set(id, card); accepted.push(card); }
    }
    discovery = { candidates: pool.size, matched: found.size, selectors: counts, version: VERSION };
    return found;
  }

  function extract(id, card) {
    const links = [...new Set([...card.querySelectorAll('a[href]')].map((a) => safeUrl(a.href)).filter(Boolean))];
    const advertiserLink = [...card.querySelectorAll('a[href]')].find((a) => {
      const url = safeUrl(a.href);
      const host = url ? new URL(url).hostname : '';
      return textOf(a) && url && (host === 'facebook.com' || host.endsWith('.facebook.com')) && !url.includes('/ads/library') && !url.includes('/help/');
    });
    return {
      id, libraryId: /^\d+$/.test(id) ? id : null, identitySource: id.startsWith('dom-') ? 'dom-fingerprint' : 'library-id', advertiser: advertiserLink ? textOf(advertiserLink) : null,
      advertiserUrl: advertiserLink ? safeUrl(advertiserLink.href) : null,
      text: adText(card), rawText: textOf(card),
      mediaType: card.querySelector('video') ? 'video' : card.querySelector('img') ? 'image' : 'text',
      libraryUrl: /^\d+$/.test(id) ? `https://www.facebook.com/ads/library/?id=${id}` : null,
      links,
      destinationUrls: links.filter((href) => { const host = new URL(href).hostname; return host !== 'facebook.com' && !host.endsWith('.facebook.com'); }),
      images: [...new Set([...card.querySelectorAll('img')].map((img) => safeUrl(img.currentSrc || img.src)).filter(Boolean))],
      videos: [...new Set([...card.querySelectorAll('video, video source')].map((video) => safeUrl(video.currentSrc || video.src)).filter(Boolean))],
      platforms: [...new Set([...card.querySelectorAll('[aria-label], [title]')].flatMap((element) => {
        const label = element.getAttribute('aria-label') || element.getAttribute('title') || '';
        return /^(facebook|instagram)$/i.test(label) ? [label.toLowerCase()] : [];
      }))],
      sourceUrl: location.href, collectedAt: new Date().toISOString()
    };
  }

  async function report(current, finished, reason) {
    const response = await chrome.runtime.sendMessage({ type: finished ? 'META_SCAN_FINISHED' : 'META_SCAN_PROGRESS',
      sessionId: current.sessionId, ads: [...current.ads.values()], scrollCount: current.scrollCount, reason, discovery });
    if (!response?.ok) throw new Error(response?.error || 'Tarama durumu kaydedilemedi.');
  }

  function waitForPage(current, delay, detectCards = false) {
    return new Promise((resolve) => {
      let observer;
      let debounce;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(debounce);
        observer?.disconnect();
        if (wake === finish) wake = null;
        resolve();
      };
      const timer = setTimeout(finish, delay);
      wake = finish;
      if (detectCards) {
        observer = new MutationObserver(() => {
          if (debounce) return;
          debounce = setTimeout(() => {
            debounce = null;
            if (current.stopped || location.href !== current.url || cards().size) finish();
          }, 150);
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] });
      }
      if (current.stopped) finish();
    });
  }

  async function run(current) {
    let idle = 0;
    let empty = 0;
    let reason = 'stopped';
    try {
      while (!current.stopped) {
        if (!onLibrary() || location.href !== current.url) { reason = 'page-changed'; break; }
        const before = current.ads.size;
        let visibleCards = cards();
        if (!visibleCards.size && !current.ads.size && !current.waitedForInitial) {
          current.waitedForInitial = true;
          // Initial React rendering/network loading can take longer than scroll speed.
          // Wait for actual DOM cards before deciding the result set is empty.
          await waitForPage(current, 12000, true);
          if (current.stopped) break;
          if (location.href !== current.url) { reason = 'page-changed'; break; }
          visibleCards = cards();
        }
        empty = visibleCards.size ? 0 : empty + 1;
        for (const [id, card] of visibleCards) {
          if (current.ads.size >= current.settings.maxAds) break;
          current.ads.set(id, extract(id, card));
        }
        idle = current.ads.size === before ? idle + 1 : 0;
        await report(current, false, 'running');
        if (current.ads.size >= current.settings.maxAds) { reason = 'limit'; break; }
        if (empty >= 3 && !current.ads.size) { reason = 'no-cards'; break; }
        if (!current.settings.autoScroll) { reason = current.ads.size ? 'visible-complete' : 'no-cards'; break; }
        if (idle >= 8) { reason = 'no-new-ads'; break; }
        if (current.stopped) break;
        const firstCard = visibleCards.values().next().value;
        let scroller = firstCard?.parentElement;
        while (scroller && scroller !== document.body && !(scroller.scrollHeight > scroller.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        const target = scroller && scroller !== document.body ? scroller : window;
        target.scrollBy({ top: Math.max(500, (target === window ? window.innerHeight : target.clientHeight) * 0.85), behavior: 'instant' });
        current.scrollCount++;
        await waitForPage(current, DELAYS[current.settings.speed], !visibleCards.size);
      }
    } catch (error) {
      console.warn('Meta Reklam Botu: tarama kaydedilemedi.', error);
      reason = 'error';
    } finally {
      try { await report(current, true, reason); }
      catch (error) { console.warn('Meta Reklam Botu: oturum kapatıldı.', error); }
      if (session === current) session = null;
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
      const { settings, tabId, sessionId } = message;
      if (!settings || !Number.isInteger(settings.maxAds) || settings.maxAds < 1 || settings.maxAds > 10000 ||
          !Object.hasOwn(DELAYS, settings.speed) || typeof settings.autoScroll !== 'boolean' || !Number.isInteger(tabId) || typeof sessionId !== 'string') {
        throw new Error('Tarama ayarları geçersiz.');
      }
      const current = { settings, tabId, sessionId, ads: new Map(), scrollCount: 0, startedAt: Date.now(), url: location.href, stopped: false };
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
