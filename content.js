(() => {
  'use strict';
  const VERSION = '0.5.0';
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
        if (found.has(id)) continue;
        candidates++;
        for (let card = marker; card && card !== document.body; card = card.parentElement) {
          // Never use a shared result list to supply another ad's button/header.
          const ids = new Set(matchesIds(card).map((item) => item[2]));
          if (ids.size !== 1 || !ids.has(id)) break;
          const header = cardHeader(card);
          if (header) { found.set(id, { element: card, header }); break; }
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
  function startDate(raw) {
    const months = { january:1, jan:1, february:2, feb:2, march:3, mar:3, april:4, apr:4, may:5, june:6, jun:6, july:7, jul:7, august:8, aug:8, september:9, sep:9, october:10, oct:10, november:11, nov:11, december:12, dec:12,
      ocak:1, şubat:2, mart:3, nisan:4, mayıs:5, haziran:6, temmuz:7, ağustos:8, eylül:9, ekim:10, kasım:11, aralık:12 };
    let match = raw.match(/(\d{1,2})\s+([\p{L}]+)\s+(\d{4})\s+(?:tarihinde\s+)?yayınlanmaya başladı/iu) ||
      raw.match(/Started running on\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
    if (!match) {
      const us = raw.match(/Started running on\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
      if (us) match = [us[0], us[2], us[1], us[3]];
    }
    if (!match) return null;
    const month = months[match[2].toLocaleLowerCase('tr-TR')] || months[match[2].toLowerCase()];
    const year = Number(match[3]), day = Number(match[1]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return month && year >= 2000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
  }
  function extract(id, record) {
    const { element: card, header } = record;
    const rawText = textOf(card);
    const links = [...new Set([...card.querySelectorAll('a[href]')].map((node) => safeUrl(node.href)).filter(Boolean))];
    const clone = card.cloneNode(true);
    const originals = [card, ...card.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    // Extract text after the sponsored header, excluding controls and metadata.
    const sponsorIndex = originals.indexOf(header.sponsor);
    const remove = new Set();
    originals.forEach((node, index) => {
      if ((index < sponsorIndex && !node.contains(header.sponsor)) || node === header.sponsor ||
          isDetails(node) || /^(Platforms?|Platformlar|Active|Inactive|Aktif|Etkin)$/i.test(normalized(node)) ||
          (matchesIds(node).length && ![...node.children].some((child) => matchesIds(child).length))) remove.add(copies[index]);
    });
    remove.forEach((node) => node.remove());
    clone.querySelectorAll('script,style,noscript,button,[role="button"]').forEach((node) => node.remove());
    // Detached innerText is unreliable; preserve block boundaries explicitly.
    clone.querySelectorAll('div,p,section,br,li').forEach((node) => node.append(document.createTextNode('\n')));
    const text = (clone.textContent || '').split('\n').map((line) => line.trim()).filter((line) => line &&
      !/^(?:\d{1,2}\s+[\p{L}]+\s+\d{4}.*yayınlanmaya başladı|Started running on.*)$/iu.test(line)).join('\n');
    const platformText = [...card.querySelectorAll('[aria-label],[title]')].map((node) => node.getAttribute('aria-label') || node.getAttribute('title')).join(' ') + ' ' + rawText;
    const platforms = ['facebook','instagram','messenger','audience network','threads'].filter((name) => new RegExp('(?:^|[^a-z])' + name + '(?:$|[^a-z])', 'i').test(platformText));
    return { id, libraryId: id, identitySource: 'library-id', advertiser: header.advertiser.name,
      advertiserUrl: header.advertiser.url, text, rawText, startDate: startDate(rawText), platforms,
      mediaType: card.querySelector('video') ? 'video' : card.querySelector('img') ? 'image' : 'text',
      libraryUrl: `https://www.facebook.com/ads/library/?id=${id}`, links,
      destinationUrls: links.filter((href) => { const host = new URL(href).hostname; return host !== 'facebook.com' && !host.endsWith('.facebook.com'); }),
      images: [...new Set([...card.querySelectorAll('img')].map((node) => safeUrl(node.currentSrc || node.src)).filter(Boolean))],
      videos: [...new Set([...card.querySelectorAll('video,video source')].map((node) => safeUrl(node.currentSrc || node.src)).filter(Boolean))],
      sourceUrl: location.href, collectedAt: new Date().toISOString() };
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
        let scroller = firstCard?.element.parentElement;
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
