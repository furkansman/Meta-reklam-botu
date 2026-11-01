(() => {
  'use strict';
  if (globalThis.__metaAdCollector) return;
  globalThis.__metaAdCollector = true;

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

  const CARD_SELECTOR = 'article,[role="article"],div[style*="border" i],[data-pagelet*="AdLibrary"],[data-ad-id]';
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
  function cards() {
    const found = new Map();
    const accepted = new Set();
    function add(id, card) {
      if (!visible(card) || accepted.has(card)) return;
      if (!found.has(id)) { found.set(id, card); accepted.add(card); }
    }
    // First resolve explicit IDs, even when their label and number are separate nodes.
    const markers = [...document.querySelectorAll('[data-ad-id],a[href*="/ads/library"]')];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (LABEL.test(node.textContent)) markers.push(node.parentElement);
    for (const marker of markers) {
      let card = marker;
      let ids = cardIds(card);
      for (let depth = 0; !ids.length && depth < 4 && card.parentElement && card.parentElement !== document.body; depth++) {
        card = card.parentElement; ids = cardIds(card);
      }
      if (ids.length !== 1) continue;
      const id = ids[0];
      for (let depth = 0; depth < 14 && card.parentElement && card.parentElement !== document.body; depth++) {
        if (card.matches('article,[role="article"]')) break;
        const parent = card.parentElement;
        if (parent.matches('main,[role="main"]') || cardIds(parent).some((other) => other !== id)) break;
        // A border wrapping a complete message/link area is a card boundary,
        // whereas small bordered badges/buttons are not.
        if (card.matches(CARD_SELECTOR) && card.querySelector(MESSAGE_SELECTOR) && card.querySelector('a[href],video,img')) break;
        card = parent;
      }
      add(id, card);
    }
    // New layouts sometimes omit the ID until the detail dialog is opened.
    // Border alone is insufficient: require ad-specific content and a creative/link.
    const candidates = [...document.querySelectorAll(CARD_SELECTOR)].filter((card) => {
      if (!visible(card) || cardIds(card).length) return false;
      const text = textOf(card);
      const hasMessage = Boolean(card.querySelector(MESSAGE_SELECTOR));
      const hasAdStatus = /(?:Started running|Active|Inactive|Yayınlanmaya başla|Aktif|Etkin)/i.test(text);
      const hasCreative = Boolean(card.querySelector('video,img,a[href]'));
      const externalLink = [...card.querySelectorAll('a[href]')].some((link) => {
        const url = safeUrl(link.href);
        if (!url) return false;
        const host = new URL(url).hostname;
        return host !== 'facebook.com' && !host.endsWith('.facebook.com');
      });
      return hasCreative && (hasMessage || (hasAdStatus && (externalLink || card.querySelector('video')) && adText(card).length >= 25));
    });
    for (const card of candidates) {
      if ([...accepted].some((existing) => card.contains(existing) || existing.contains(card))) continue;
      const children = candidates.filter((candidate) => candidate !== card && card.contains(candidate));
      // Reject list/grid wrappers containing separate candidate card branches.
      if (children.some((child, index) => children.slice(index + 1).some((other) => !child.contains(other) && !other.contains(child)))) continue;
      if (card.querySelectorAll(MESSAGE_SELECTOR).length > 1) continue;
      add(fingerprint(card), card);
    }
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
      sessionId: current.sessionId, ads: [...current.ads.values()], scrollCount: current.scrollCount, reason });
    if (!response?.ok) throw new Error(response?.error || 'Tarama durumu kaydedilemedi.');
  }

  async function run(current) {
    let idle = 0;
    let empty = 0;
    let reason = 'stopped';
    try {
      while (!current.stopped) {
        if (!onLibrary() || location.href !== current.url) { reason = 'page-changed'; break; }
        const before = current.ads.size;
        const visibleCards = cards();
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
        await new Promise((resolve) => {
          const timer = setTimeout(() => { wake = null; resolve(); }, DELAYS[current.settings.speed]);
          wake = () => { clearTimeout(timer); wake = null; resolve(); };
        });
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

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'META_SCAN_STATUS') { respond({ running: Boolean(session), sessionId: session?.sessionId }); return; }
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
  });
  addEventListener('pagehide', () => { if (session) session.stopped = true; wake?.(); });
})();
