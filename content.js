(() => {
  'use strict';
  if (globalThis.__metaAdCollector) return;
  globalThis.__metaAdCollector = true;

  const ID_LABEL = /(?:Library ID|Ad Library ID|Kütüphane (?:Kimliği|No(?:su)?)|Reklam Kütüphanesi Kimliği)\s*[:：]?\s*(\d{5,})/i;
  const LABEL = /Library ID|Ad Library ID|Kütüphane (?:Kimliği|No)|Reklam Kütüphanesi Kimliği/i;
  const DELAYS = { slow: 3000, medium: 1800, fast: 1000 };
  let session = null;
  let wake = null;
  const onLibrary = () => location.hostname === 'www.facebook.com' && /^\/ads\/library\/?$/.test(location.pathname);
  const textOf = (node) => (node.innerText || node.textContent || '').trim();

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

  function cards() {
    const found = new Map();
    // Semantic ID labels survive changes to Meta's generated CSS classes.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!LABEL.test(node.textContent)) continue;
      let card = node.parentElement;
      if (!card || card.closest('script,style,[hidden]')) continue;
      // Some layouts put the label and number in separate sibling spans.
      for (let depth = 0; depth < 3 && !ID_LABEL.test(textOf(card)) && card.parentElement; depth++) card = card.parentElement;
      const id = textOf(card).match(ID_LABEL)?.[1];
      if (!id) continue;
      for (let depth = 0; depth < 14 && card.parentElement && card.parentElement !== document.body; depth++) {
        if (card.matches('article,[role="article"]')) break;
        const parent = card.parentElement;
        const ids = [...textOf(parent).matchAll(new RegExp(ID_LABEL.source, 'gi'))].map((match) => match[1]);
        // Never merge adjacent ads into a single card.
        if (new Set(ids).size > 1 || parent.matches('main,[role="main"]')) break;
        card = parent;
      }
      if (card.getClientRects().length && !found.has(id)) found.set(id, card);
    }
    // Fallback for cards identified by a permalink or a semantic data attribute.
    for (const marker of document.querySelectorAll('a[href*="/ads/library/"], [data-ad-id]')) {
      let id = marker.getAttribute('data-ad-id');
      if (!id && marker.href) { try { id = new URL(marker.href).searchParams.get('id'); } catch {} }
      if (!/^\d{5,}$/.test(id || '') || found.has(id)) continue;
      let card = marker;
      for (let depth = 0; depth < 14 && card.parentElement && card.parentElement !== document.body; depth++) {
        if (card.matches('article,[role="article"]')) break;
        const parent = card.parentElement;
        if (parent.matches('main,[role="main"]')) break;
        const otherIds = [...textOf(parent).matchAll(new RegExp(ID_LABEL.source, 'gi'))].map((match) => match[1]);
        for (const link of parent.querySelectorAll('a[href*="/ads/library/"]')) {
          try { const other = new URL(link.href).searchParams.get('id'); if (other) otherIds.push(other); } catch {}
        }
        if (otherIds.some((other) => other !== id)) break;
        card = parent;
      }
      if (card.getClientRects().length) found.set(id, card);
    }
    return found;
  }

  function extract(id, card) {
    const links = [...new Set([...card.querySelectorAll('a[href]')].map((a) => safeUrl(a.href)).filter(Boolean))];
    const textNodes = [...card.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"], [dir="auto"]')];
    const texts = [...new Set(textNodes.filter((node) => !node.querySelector('[dir="auto"]'))
      .map(textOf).filter((text) => text && !ID_LABEL.test(text)))];
    const advertiserLink = [...card.querySelectorAll('a[href]')].find((a) => {
      const url = safeUrl(a.href);
      const host = url ? new URL(url).hostname : '';
      return textOf(a) && url && (host === 'facebook.com' || host.endsWith('.facebook.com')) && !url.includes('/ads/library') && !url.includes('/help/');
    });
    return {
      id, advertiser: advertiserLink ? textOf(advertiserLink) : null,
      advertiserUrl: advertiserLink ? safeUrl(advertiserLink.href) : null,
      text: texts.join('\n').slice(0, 30000), rawText: textOf(card).slice(0, 50000),
      mediaType: card.querySelector('video') ? 'video' : card.querySelector('img') ? 'image' : 'text',
      libraryUrl: `https://www.facebook.com/ads/library/?id=${id}`,
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
    let reason = 'stopped';
    try {
      while (!current.stopped) {
        if (!onLibrary() || location.href !== current.url) { reason = 'page-changed'; break; }
        const before = current.ads.size;
        const visibleCards = cards();
        for (const [id, card] of visibleCards) {
          if (current.ads.size >= current.settings.maxAds) break;
          current.ads.set(id, extract(id, card));
        }
        idle = current.ads.size === before ? idle + 1 : 0;
        await report(current, false, 'running');
        if (current.ads.size >= current.settings.maxAds) { reason = 'limit'; break; }
        if (!current.settings.autoScroll) { reason = 'visible-complete'; break; }
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
