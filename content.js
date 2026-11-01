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
      text: texts.join('\n'), rawText: textOf(card),
      libraryUrl: `https://www.facebook.com/ads/library/?id=${id}`,
      links,
      destinationUrls: links.filter((href) => { const host = new URL(href).hostname; return host !== 'facebook.com' && !host.endsWith('.facebook.com'); }),
      images: [...new Set([...card.querySelectorAll('img')].map((img) => safeUrl(img.currentSrc || img.src)).filter(Boolean))],
      videos: [...new Set([...card.querySelectorAll('video')].map((video) => safeUrl(video.currentSrc || video.src)).filter(Boolean))],
      sourceUrl: location.href, collectedAt: new Date().toISOString()
    };
  }

  function snapshot(current, running, reason) {
    return { ads: [...current.ads.values()], scrollCount: current.scrollCount,
      scan: { running, tabId: current.tabId, startedAt: current.startedAt, updatedAt: Date.now(), reason } };
  }

  async function run(current) {
    let idle = 0;
    let reason = 'stopped';
    try {
      while (!current.stopped) {
        if (!onLibrary() || location.href !== current.url) { reason = 'page-changed'; break; }
        const before = current.ads.size;
        for (const [id, card] of cards()) {
          if (current.ads.size >= current.settings.maxAds) break;
          current.ads.set(id, extract(id, card));
        }
        idle = current.ads.size === before ? idle + 1 : 0;
        await chrome.storage.local.set(snapshot(current, true, 'running'));
        if (current.ads.size >= current.settings.maxAds) { reason = 'limit'; break; }
        if (!current.settings.autoScroll) { reason = 'visible-complete'; break; }
        if (idle >= 8) { reason = 'no-new-ads'; break; }
        if (current.stopped) break;
        window.scrollBy({ top: Math.max(500, window.innerHeight * 0.85), behavior: 'instant' });
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
      try {
        const { history = [] } = await chrome.storage.local.get('history');
        await chrome.storage.local.set({ ...snapshot(current, false, reason), history: [
          { createdAt: current.startedAt, adCount: current.ads.size, scrollCount: current.scrollCount, reason, settings: current.settings },
          ...history
        ].slice(0, 100) });
      } catch {
        // Even if results exceed the storage quota, release the running state.
        await chrome.storage.local.set({ scan: { running: false, tabId: current.tabId, reason: 'storage-error' } }).catch(() => {});
      }
      if (session === current) session = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'META_SCAN_STATUS') { respond({ running: Boolean(session), tabId: session?.tabId }); return; }
    if (message?.type === 'META_SCAN_STOP') {
      if (session) session.stopped = true;
      wake?.();
      respond({ ok: true });
      return;
    }
    if (message?.type !== 'META_SCAN_START') return;
    (async () => {
      if (!onLibrary()) throw new Error('Meta Reklam Kütüphanesi sayfasını aç.');
      if (session) throw new Error('Bu sekmede zaten bir tarama çalışıyor.');
      const { settings, tabId } = message;
      if (!settings || !Number.isInteger(settings.maxAds) || settings.maxAds < 1 || settings.maxAds > 10000 ||
          !Object.hasOwn(DELAYS, settings.speed) || typeof settings.autoScroll !== 'boolean' || !Number.isInteger(tabId)) {
        throw new Error('Tarama ayarları geçersiz.');
      }
      const current = { settings, tabId, ads: new Map(), scrollCount: 0, startedAt: Date.now(), url: location.href, stopped: false };
      session = current;
      try { await chrome.storage.local.set(snapshot(current, true, 'running')); }
      catch (error) { session = null; throw error; }
      respond({ ok: true });
      void run(current);
    })().catch((error) => respond({ ok: false, error: error.message }));
    return true;
  });
  addEventListener('pagehide', () => { if (session) session.stopped = true; wake?.(); });
})();
