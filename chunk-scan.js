(function (root) {
  'use strict';
  const DAY = 86400000, NEXT = 'chunk-next', TIMEOUT = 'chunk-timeout', REPORT = 'chunk-report';
  const FILTER_HELP = 'Sayfada tarih filtresini bir kez uygulayıp tekrar dene';
  const OVERLAP = 'Meta filtresi pencerede yayında olan reklamları getiriyor, parçalar çakışabilir';
  const SLOW = 'Hız düştü, sekme öne alınmalı ya da dinlenmeli';
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const iso = time => new Date(time).toISOString().slice(0, 10);
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const library = value => { try { const url = new URL(value); return url.origin === 'https://www.facebook.com' && /^\/ads\/library\/?$/.test(url.pathname); } catch { return false; } };
  function settings(value) {
    if (!date(value?.start) || !date(value?.end) || value.start > value.end || value.start < '2000-01-01' || value.end > today() ||
        !['day', 'week', 'month'].includes(value.unit) || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 10000 ||
        !Number.isInteger(value.waitMin) || !Number.isInteger(value.waitMax) || value.waitMin < 1 || value.waitMax < value.waitMin || value.waitMax > 3600) {
      throw new Error('Parçalı tarama ayarlarını kontrol et: geçerli tarih aralığı, 1–10000 reklam ve 1–3600 saniye bekleme gir.');
    }
    return { start: value.start, end: value.end, unit: value.unit, limit: value.limit, waitMin: value.waitMin, waitMax: value.waitMax };
  }
  const key = piece => [piece.start, piece.end, piece.media || '', piece.platform || ''].join('|');
  const label = piece => `${piece.start}${piece.end !== piece.start ? ' → ' + piece.end : ''}${piece.media ? ' · ' + piece.media : ''}${piece.platform ? ' · ' + piece.platform : ''}`;
  function ranges(config) {
    const parts = [];
    for (let start = config.start; start <= config.end;) {
      const value = new Date(start);
      let next;
      if (config.unit === 'month') {
        const year = value.getUTCFullYear(), month = value.getUTCMonth();
        const day = Math.min(value.getUTCDate(), new Date(Date.UTC(year, month + 2, 0)).getUTCDate());
        next = Date.UTC(year, month + 1, day);
      } else next = value.getTime() + DAY * (config.unit === 'week' ? 7 : 1);
      parts.push({ start, end: iso(Math.min(Date.parse(config.end), next - DAY)), attempt: 0 });
      start = iso(next);
    }
    return parts;
  }
  function learnDateParams(value, saved = null) {
    if (!library(value)) throw new Error('Önce Meta Reklam Kütüphanesi sonuç sayfasını aç.');
    const entries = [...new URL(value).searchParams].filter(([name, value]) => /date/i.test(name) && date(value));
    for (const [min] of entries) {
      if (!/(?:\[|_|^)(?:min|from|since|start)(?:\]|_|$)/i.test(min)) continue;
      const stem = name => name.toLowerCase().replace(/min|max|from|since|start|to|until|end/g, '');
      const max = entries.find(([name]) => name !== min && /(?:\[|_|^)(?:max|to|until|end)(?:\]|_|$)/i.test(name) && stem(name) === stem(min))?.[0];
      if (max) return { min, max };
    }
    if (saved && typeof saved.min === 'string' && typeof saved.max === 'string' && saved.min !== saved.max && /date/i.test(saved.min) && /date/i.test(saved.max)) return { min: saved.min, max: saved.max };
    throw new Error(FILTER_HELP);
  }
  function baseFilters(value) {
    const url = new URL(value), media = url.searchParams.get('media_type');
    const platforms = [...url.searchParams].filter(([name]) => /^publisher_platforms(?:\[.*\])?$/.test(name)).map(([, value]) => value).filter(value => value && value !== 'all');
    return { media: media && media !== 'all' ? media : null, platforms };
  }
  function split(piece, baseUrl) {
    if (piece.start !== piece.end) {
      const mid = Date.parse(piece.start) + Math.floor((Date.parse(piece.end) - Date.parse(piece.start)) / DAY / 2) * DAY;
      return [{ ...piece, end: iso(mid), attempt: 0, seenIds: [] }, { ...piece, start: iso(mid + DAY), attempt: 0, seenIds: [] }];
    }
    const filters = baseFilters(baseUrl);
    if (!piece.media && !filters.media) return ['image', 'video'].map(media => ({ ...piece, media, attempt: 0, seenIds: [] }));
    if (!piece.platform) {
      const allowed = ['facebook', 'instagram'].filter(platform => !filters.platforms.length || filters.platforms.includes(platform));
      if (allowed.length > 1) return allowed.map(platform => ({ ...piece, platform, attempt: 0, seenIds: [] }));
    }
    return [];
  }
  function pieceUrl(base, params, piece) {
    const url = new URL(base);
    url.searchParams.set(params.min, piece.start); url.searchParams.set(params.max, piece.end);
    if (piece.media) url.searchParams.set('media_type', piece.media);
    if (piece.platform) {
      for (const name of [...url.searchParams.keys()]) if (/^publisher_platforms(?:\[.*\])?$/.test(name)) url.searchParams.delete(name);
      url.searchParams.set('publisher_platforms[0]', piece.platform);
    }
    return url.href;
  }
  function parseResults(text) {
    if (/\bno (?:ads|results) found\b|reklam bulunamadı|sonuç bulunamadı/i.test(text)) return 0;
    const match = text.match(/(?:[~≈]\s*)?(\d+(?:[.,\u00a0 ]\d{3})*)\s*(?:sonuç|results)(?![\p{L}])/iu);
    return match ? Number(match[1].replace(/\D/g, '')) : null;
  }
  // Self-contained for chrome.scripting.executeScript; does not modify the scan engine.
  function probePage() {
    return new Promise(resolve => {
      let observer, timer;
      const finish = result => { observer?.disconnect(); clearTimeout(timer); resolve(result); };
      const check = final => {
        const text = document.body?.innerText || '';
        const blocked = /temporarily blocked|too many requests|try again later|geçici olarak engell|çok fazla istek|rate limit|hız sınırı|istek sınırı|daha sonra tekrar dene|log in to continue|devam etmek için giriş/i.test(text);
        const match = text.match(/(?:[~≈]\s*)?(\d+(?:[.,\u00a0 ]\d{3})*)\s*(?:sonuç|results)(?![\p{L}])/iu);
        const total = match ? Number(match[1].replace(/\D/g, '')) : /\bno (?:ads|results) found\b|reklam bulunamadı|sonuç bulunamadı/i.test(text) ? 0 : null;
        if (blocked || total !== null || final) finish({ blocked, total, url: location.href });
      };
      observer = new MutationObserver(() => check(false));
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      timer = setTimeout(() => check(true), 8000); check(false);
    });
  }
  function summary(run) {
    const failures = run.done.filter(item => item.status === 'failed');
    const lines = ['Meta Reklam Botu — Parçalı tarama tamamlandı', `Toplam benzersiz reklam: ${run.uniqueCount}`, `Ham reklam: ${run.rawCount}`, `Taranan parça: ${run.scannedParts}`, `Başarısız parça: ${failures.length}`];
    // One Telegram message; the complete list remains in the popup/durable run.
    for (const item of failures) {
      const line = `• ${label(item.piece)}: ${item.error}`;
      if (lines.join('\n').length + line.length > 3700) { lines.push('Diğer başarısız parçalar eklentide listeleniyor.'); break; }
      lines.push(line);
    }
    if (run.overlap) lines.push(OVERLAP);
    return lines.join('\n');
  }
  function create(chrome, hooks) {
    const enqueue = hooks.enqueue, now = hooks.now || Date.now, random = hooks.random || Math.random;
    let cacheId = null, pool = new Map(), cachedKeys = new Set(), timer = null;
    const read = async () => (await chrome.storage.local.get('chunkRun')).chunkRun;
    const save = run => chrome.storage.local.set({ chunkRun: run });
    const close = async (tabId, expected = null) => {
      if (!Number.isInteger(tabId)) return;
      // Tab IDs can be reused across browser restarts. Never close an unrelated tab.
      try {
        const tab = await chrome.tabs.get(tabId);
        if (expected) {
          const actual = new URL(tab.url), wanted = new URL(expected);
          const identity=[...wanted.searchParams.keys()].filter(name=>/date/i.test(name)&&date(wanted.searchParams.get(name))).concat(['q','view_all_page_id','country']);
          if(actual.origin!==wanted.origin || actual.pathname.replace(/\/$/,'')!==wanted.pathname.replace(/\/$/,'') || identity.some(name=>wanted.searchParams.has(name)&&actual.searchParams.get(name)!==wanted.searchParams.get(name)))return;
        }
        await chrome.tabs.remove(tabId);
      } catch { /* Already closed. */ }
    };
    async function poolFor(run) {
      if (cacheId !== run.id) { cacheId = run.id; pool = new Map(); cachedKeys = new Set(); }
      const missing = run.poolKeys.filter(name => !cachedKeys.has(name));
      if (missing.length) {
        const batches = await chrome.storage.local.get(missing);
        for (const name of missing) { for (const ad of batches[name] || []) pool.set(ad.id, ad); cachedKeys.add(name); }
      }
      return pool;
    }
    async function progress(run) {
      return hooks.publishProgress({ ads: [], scrollCount: run.scrollCount, scan: { running: run.running, sessionId: run.id, sourceUrl: run.baseUrl, reason: run.phase === 'done' ? 'visible-complete' : run.running ? 'running' : 'stopped' } }, { ads: run.uniqueCount, scrolls: run.scrollCount, status: run.running ? 'scanning' : run.phase === 'done' ? 'completed' : 'stopped', chunk: true });
    }
    async function schedule(run, delay = 0) {
      run.nextAt = now() + delay; await save(run);
      await chrome.alarms.create(NEXT, { when: run.nextAt });
      clearTimeout(timer);
      // Alarm survives suspension; the timer keeps a 20-second wait accurate while awake.
      if (delay > 0 && delay <= 60000) { timer = setTimeout(() => { void enqueue(next).catch(failSafe); }, delay); timer?.unref?.(); }
      await progress(run);
    }
    const wait = run => (run.config.waitMin + Math.floor(random() * (run.config.waitMax - run.config.waitMin + 1))) * 1000;
    async function view(state) {
      const run = state.chunkRun;
      if (!run?.visible) return state;
      return { ...state, ads: [...(await poolFor(run)).values()], scrollCount: run.scrollCount, scan: { ...state.scan, sourceUrl: run.baseUrl } };
    }
    async function start(config) {
      config = settings(config);
      const stored = await chrome.storage.local.get(['scan', 'chunkRun', 'chunkDateParams', 'scanBatches', 'settings']);
      if (stored.scan?.running || stored.chunkRun?.running) throw new Error('Önce çalışan taramayı durdur.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const params = learnDateParams(tab?.url, stored.chunkDateParams);
      const run = { id: crypto.randomUUID(), config, baseUrl: tab.url, params, visible: true, running: true, phase: 'queued', queue: ranges(config), done: [], splits: [], active: null, poolKeys: [], uniqueCount: 0, rawCount: 0, scrollCount: 0, scannedParts: 0, baselineSpeed: null, overlap: false, startedAt: now(), nextAt: now(), speed: stored.settings?.speed || 'medium' };
      await chrome.storage.local.set({ chunkRun: run, chunkConfig: config, chunkDateParams: params, ads: [], scrollCount: 0, scan: { running: false, reason: '', sourceUrl: tab.url }, scanBatches: null });
      const obsolete = [...(stored.chunkRun?.poolKeys || []), ...(stored.scanBatches?.keys || [])];
      if (obsolete.length) await chrome.storage.local.remove(obsolete);
      await progress(run); await next(); return { ok: true };
    }
    async function next() {
      const run = await read(); if (!run?.running || run.active) return;
      if (run.nextAt > now()) { await chrome.alarms.create(NEXT, { when: run.nextAt }); return; }
      if (!run.queue.length) { await finishRun(run); return; }
      const piece = run.queue.shift();
      run.active = { piece, sessionId: crypto.randomUUID(), tabId: null, phase: 'creating', deadline: now() + 45000, startedAt: now(), scrolls: 0, count: 0, seenIds: piece.seenIds || [], total: null };
      run.phase = 'running'; await save(run); await chrome.alarms.create(TIMEOUT, { when: run.active.deadline });
      try {
        const tab = await chrome.tabs.create({ url: pieceUrl(run.baseUrl, run.params, piece), active: true });
        run.active.tabId = tab.id; run.active.phase = 'loading'; await save(run); await progress(run);
        if (tab.status === 'complete') await loaded(tab.id);
      } catch { await retry('Parça sekmesi açılamadı.'); }
    }
    async function loaded(tabId) {
      let run = await read(), active = run?.active;
      if (!run?.running || active?.tabId !== tabId || active.phase !== 'loading') return;
      active.phase = 'probing'; await save(run);
      try {
        const [probe] = await chrome.scripting.executeScript({ target: { tabId }, func: probePage });
        const result = probe?.result;
        if (!result || result.blocked || !library(result.url)) { await retry('Meta sayfası yüklenmedi, erişimi kısıtladı veya giriş istiyor.'); return; }
        active.total = Number.isSafeInteger(result.total) && result.total >= 0 ? result.total : null;
        await save(run);
        if (active.total === 0) { await settle('empty'); return; }
        if (active.total > run.config.limit) { await divide('Meta sonuç sayısı parça sınırını aşıyor.'); return; }
        active.phase = 'starting'; active.deadline = now() + 600000; await save(run);
        await chrome.alarms.create(TIMEOUT, { when: active.deadline });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['ad-data.js', 'scan-loop.js', 'content.js'] });
        const response = await chrome.tabs.sendMessage(tabId, { type: 'META_SCAN_START', tabId, sessionId: active.sessionId, settings: { autoScroll: true, autoRefresh: false, speed: run.speed, maxAds: run.config.limit } }, { frameId: 0 });
        if (!response?.ok) throw new Error('Tarama motoru başlatılamadı.');
        active.phase = 'scanning'; await save(run); await progress(run);
      } catch { await retry('Parça yüklenmedi veya tarama motoru başlatılamadı.'); }
    }
    async function append(run, incoming) {
      const map = await poolFor(run), seen = new Set(run.active.seenIds);
      const fresh = [], freshIds = new Set();
      for (const ad of incoming) {
        if (!seen.has(ad.id)) { seen.add(ad.id); run.rawCount++; }
        if (!map.has(ad.id) && !freshIds.has(ad.id)) { fresh.push(ad); freshIds.add(ad.id); }
      }
      run.active.seenIds = [...seen];
      run.active.count = Math.max(run.active.count, seen.size);
      for (let offset = 0; offset < fresh.length; offset += 25) {
        const batch = fresh.slice(offset, offset + 25), name = `chunk-pool:${run.id}:${run.poolKeys.length}`;
        run.poolKeys.push(name); run.uniqueCount += batch.length;
        await chrome.storage.local.set({ [name]: batch, chunkRun: run });
        for (const ad of batch) map.set(ad.id, ad); cachedKeys.add(name);
      }
      await save(run);
    }
    async function owns(sender, message) {
      const run = await read();
      return Boolean(sender.tab && run?.active?.tabId === sender.tab.id && run.active.sessionId === message.sessionId);
    }
    async function content(message, sender) {
      const run = await read(), active = run?.active;
      if (!active || !await owns(sender, message) || sender.frameId !== 0 || !library(sender.url) || !['SCAN_PROGRESS', 'META_SCAN_APPEND', 'META_SCAN_PROGRESS', 'META_SCAN_FINISHED'].includes(message.type)) throw new Error('Geçersiz parça mesajı.');
      const incoming = message.type === 'SCAN_PROGRESS' ? [] : message.type === 'META_SCAN_APPEND' ? message.records : message.ads;
      if (!Array.isArray(incoming) || incoming.length > (message.type === 'META_SCAN_APPEND' ? 25 : run.config.limit) || incoming.some(ad => !/^\d{10,}$/.test(ad?.id || ''))) throw new Error('Geçersiz parça reklam verisi.');
      const reportedCount = message.type === 'SCAN_PROGRESS' ? message.ads : incoming.length;
      if (!Number.isInteger(reportedCount) || reportedCount < 0 || reportedCount > run.config.limit) throw new Error('Geçersiz parça sayacı.');
      const scrolls = message.scrolls ?? message.scrollCount ?? active.scrolls;
      if (!Number.isInteger(scrolls) || scrolls < active.scrolls) throw new Error('Geçersiz parça sayacı.');
      run.scrollCount += scrolls - active.scrolls; active.scrolls = scrolls;
      active.count = Math.max(active.count, reportedCount);
      if (Number.isSafeInteger(message.discovery?.reportedTotal)) active.total = message.discovery.reportedTotal;
      try { if (incoming.length) await append(run, incoming); else await save(run); }
      catch { await failSafe(); throw new Error('Parça verileri kaydedilemedi; kaydedilen paketler korundu.'); }
      if (message.type === 'META_SCAN_FINISHED') {
        const dated = incoming.filter(ad => date(ad.startDate)), before = dated.filter(ad => ad.startDate < active.piece.start);
        if (dated.length && before.length / dated.length > 0.25) run.overlap = true;
        active.count = Math.max(active.count, incoming.length);
        active.speed = incoming.length / Math.max((now() - active.startedAt) / 60000, 1 / 60);
        if (incoming.length && run.baselineSpeed === null) run.baselineSpeed = active.speed;
        active.slow = run.baselineSpeed !== null && active.speed < run.baselineSpeed * 0.5;
        await save(run);
        if (!run.running) { await detach(run); return { ok: true, progress: await progress(await read()) }; }
        if (message.reason === 'limit') { run.scannedParts++; await save(run); await divide('Tarama parça sınırına ulaştı.'); }
        else if (!['meta-exhausted', 'visible-complete', 'no-new-ads'].includes(message.reason) || !incoming.length || active.total !== null && incoming.length < active.total) await retry('Meta daha fazla reklam yüklemedi veya parça taraması kesildi.');
        else { run.scannedParts++; await save(run); await settle('done'); }
      }
      return { ok: true, progress: await progress(await read()) };
    }
    async function disposeActive(run) {
      const tabId = run.active?.tabId, expected = run.active ? pieceUrl(run.baseUrl, run.params, run.active.piece) : null;
      run.active = null; await save(run); await chrome.alarms.clear(TIMEOUT); await close(tabId, expected);
    }
    async function detach(run) {
      if (run.active) run.queue.unshift({ ...run.active.piece, seenIds: run.active.seenIds });
      await disposeActive(run); run.phase = 'paused'; await save(run);
    }
    async function settle(status, error = '') {
      const run = await read(), active = run?.active; if (!active) return;
      run.done.push({ piece: active.piece, status, error, count: active.count, speed: active.speed || 0, slow: active.slow || false, total: active.total });
      run.last = { label: label(active.piece), count: active.count, speed: active.speed || 0, slow: active.slow || false };
      await disposeActive(run);
      if (run.queue.length) await schedule(run, wait(run)); else await finishRun(run);
    }
    async function divide(reason) {
      const run = await read(), active = run?.active; if (!active) return;
      const children = split(active.piece, run.baseUrl);
      if (!children.length) { await settle('failed', '1 günlük medya/platform parçası da sınırı aşıyor; kısmi veriler korundu.'); return; }
      run.splits.push({ piece: active.piece, reason }); run.queue.unshift(...children);
      await disposeActive(run); await schedule(run, wait(run));
    }
    async function retry(error) {
      const run = await read(), active = run?.active; if (!active) return;
      if (!run.running) { await detach(run); return; }
      const attempt = (active.piece.attempt || 0) + 1;
      if (attempt > 2) { await settle('failed', error); return; }
      run.queue.unshift({ ...active.piece, attempt, seenIds: active.seenIds }); run.lastError = `${label(active.piece)}: ${error} Yeniden deneme ${attempt}/2`;
      await disposeActive(run); await schedule(run, wait(run) * 2 ** attempt);
    }
    async function finishRun(run) {
      run.running = false; run.phase = 'done'; run.finishedAt = now();
      const { telegramConfig } = await chrome.storage.local.get('telegramConfig');
      run.notification = telegramConfig?.enabled ? { status: 'queued', attempts: 0, nextAt: now(), text: summary(run) } : { status: 'disabled' };
      await save(run); clearTimeout(timer); await chrome.alarms.clear(NEXT); await progress(run);
      if (run.notification.status === 'queued') await chrome.alarms.create(REPORT, { when: now() + 100 });
    }
    async function report() {
      const run = await read(), job = run?.notification;
      if (!job || !['queued', 'retrying'].includes(job.status) || job.nextAt > now()) return;
      const { telegramConfig } = await chrome.storage.local.get('telegramConfig');
      if (!telegramConfig?.enabled) { job.status = 'disabled'; await save(run); return; }
      // Durable lease prevents duplicate sends from concurrent alarms/worker wakeups.
      job.nextAt = now() + 60000; await save(run); await chrome.alarms.create(REPORT, { when: job.nextAt });
      try { await hooks.sendTelegram(telegramConfig, job.text); job.status = 'sent'; }
      catch (error) { job.attempts++; job.status = error.retryable && job.attempts < 3 ? 'retrying' : 'failed'; job.error = error.message; }
      await save(run);
      if (job.status === 'retrying') await chrome.alarms.create(REPORT, { when: job.nextAt }); else await chrome.alarms.clear(REPORT);
    }
    async function pause() {
      const run = await read(); if (!run?.running) return { ok: true };
      run.running = false; run.phase = 'paused'; clearTimeout(timer); await chrome.alarms.clear(NEXT); await save(run); await progress(run);
      if (run.active) {
        run.active.phase = 'stopping'; await save(run);
        await chrome.alarms.create(TIMEOUT, { when: now() + 5000 });
        try { const response = await chrome.tabs.sendMessage(run.active.tabId, { type: 'META_SCAN_STOP', sessionId: run.active.sessionId }, { frameId: 0 }); if (!response?.ok) await detach(run); }
        catch { await detach(run); }
      }
      return { ok: true };
    }
    async function resume() {
      const run = await read(), { scan } = await chrome.storage.local.get('scan');
      if (!run || run.phase === 'done' || run.running || scan?.running) throw new Error('Devam edilecek durmuş bir parçalı tarama yok.');
      if(run.active?.phase==='stopping')throw new Error('Son reklam paketi kaydediliyor; birkaç saniye sonra Devam Et ile yeniden dene.');
      if (run.active) await detach(run);
      run.running = true; run.visible = true; run.phase = 'queued'; run.nextAt = now(); await save(run); await progress(run); await next(); return { ok: true };
    }
    async function hide() {
      const run = await read(); if (run?.running) throw new Error('Önce parçalı taramayı durdur.');
      if(run?.active?.phase==='stopping')throw new Error('Son reklam paketi kaydediliyor; birkaç saniye sonra yeniden dene.');
      if(run?.active)await detach(run);
      if(run){run.visible=false;await save(run);}
    }
    async function clear() {
      const run = await read(); if (run?.running) throw new Error('Önce parçalı taramayı durdur.');
      if (run?.active) await disposeActive(run);
      await chrome.storage.local.set({ chunkRun: null }); if (run?.poolKeys.length) await chrome.storage.local.remove(run.poolKeys);
      pool = new Map(); cacheId = null;
    }
    async function recover(startup = false) {
      const run = await read(); if (!run) return;
      if (startup && (run.running || run.active)) { run.running = false; run.phase = 'paused'; if (run.active) await detach(run); else await save(run); }
      else if (run.active && run.running) {
        if (run.active.phase === 'loading') await loaded(run.active.tabId);
        else {
          let status; try { status = await chrome.tabs.sendMessage(run.active.tabId, { type: 'META_SCAN_STATUS' }, { frameId: 0 }); } catch {}
          if (!status?.running || status.sessionId !== run.active.sessionId) await retry('Tarama bağlantısı yeniden kurulamadı.');
        }
      } else if (run.running) await schedule(run, Math.max(0, run.nextAt - now()));
      const current = await read();
      if (['queued', 'retrying'].includes(current.notification?.status)) await chrome.alarms.create(REPORT, { when: Math.max(now() + 100, current.notification.nextAt) });
    }
    async function failSafe() {
      // Leave acknowledged pool batches intact even when a later storage/tab call fails.
      const run = await read().catch(() => null); if (!run) return;
      run.running = false; run.phase = 'paused'; run.lastError = 'Parça yöneticisi durdu; kaydedilen veriler korunuyor. Devam Et ile yeniden dene.';
      await save(run).catch(() => {});
      await progress(run).catch(() => {});
      if(run.active)await chrome.tabs.sendMessage(run.active.tabId,{type:'META_SCAN_STOP',sessionId:run.active.sessionId},{frameId:0}).catch(()=>{});
    }
    chrome.alarms.onAlarm.addListener(info => {
      if (![NEXT, TIMEOUT, REPORT].includes(info.name)) return;
      void enqueue(async () => {
        if (info.name === NEXT) await next();
        if (info.name === REPORT) await report();
        if (info.name === TIMEOUT) {
          const run = await read(); if (!run?.active) return;
          if (!run.running) await detach(run); else if (now() >= run.active.deadline) await retry('Parça yükleme/tarama zaman aşımı.');
        }
      }).catch(failSafe);
    });
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      void enqueue(async () => {
        const run = await read(); if (run?.active?.tabId !== tabId) return;
        if (change.status === 'complete') await loaded(tabId);
        if (change.status === 'loading' && ['scanning', 'starting'].includes(run.active.phase)) {
          const tab=await chrome.tabs.get(tabId).catch(()=>null);
          if(tab?.status==='loading')await retry('Meta parça sayfasını yeniden yükledi.');
        }
      }).catch(failSafe);
    });
    chrome.tabs.onRemoved.addListener(tabId => { void enqueue(async () => { const run = await read(); if (run?.active?.tabId === tabId) await retry('Parça sekmesi kapandı.'); }).catch(failSafe); });
    chrome.runtime.onStartup.addListener(() => { void enqueue(() => recover(true)).catch(failSafe); });
    chrome.runtime.onInstalled.addListener(() => { void enqueue(() => recover(false)).catch(failSafe); });
    return { start, next, loaded, owns, content, pause, resume, clear, hide, view, progress, recover, report, read };
  }
  const api = { create, ranges, split, pieceUrl, learnDateParams, settings, label, key, today, parseResults, probePage, summary, FILTER_HELP, OVERLAP, SLOW };
  root.ChunkScan = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
