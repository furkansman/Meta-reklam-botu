(function (root) {
  'use strict';
  function create({ command, refreshState, perform, getState, isReady, isBusy }) {
    const $ = selector => document.querySelector(selector);
    const end = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    $('#chunk-end').value = end(); $('#chunk-end').max = end(); $('#chunk-start').max = end();
    let populated = false;
    const resumable = () => { const run = getState().chunkRun; return Boolean(run?.visible && !run.running && run.phase !== 'done' && run.active?.phase !== 'stopping'); };
    const pieceLabel = piece => `${piece.start}${piece.start !== piece.end ? ' → ' + piece.end : ''}${piece.media ? ' · ' + piece.media : ''}${piece.platform ? ' · ' + piece.platform : ''}`;
    function render() {
      const state = getState(), run = state.chunkRun, active = run?.active;
      if (!populated && isReady()) {
        const config = state.chunkConfig;
        if (config) for (const [key, id] of Object.entries({ start: 'start', end: 'end', unit: 'unit', limit: 'limit', waitMin: 'wait-min', waitMax: 'wait-max' })) $(`#chunk-${id}`).value = config[key];
        $('#chunk-enabled').checked = Boolean(run?.visible); populated = true;
      }
      const locked = !isReady() || isBusy() || state.scan?.running || run?.running;
      $('#chunk-enabled').disabled = Boolean(locked);
      $('#chunk-fields').disabled = Boolean(locked || !$('#chunk-enabled').checked);
      $('#chunk-fields').hidden = !$('#chunk-enabled').checked;
      $('#chunk-start-button').disabled = Boolean(locked || !$('#chunk-enabled').checked);
      for (const button of document.querySelectorAll('[data-chunk-days]')) button.disabled = Boolean(locked);
      const visible = Boolean(run?.visible);
      $('#chunk-progress').hidden = !visible;
      $('#chunk-failures').replaceChildren();
      if (!visible) { $('#chunk-failures').hidden = true; return; }
      const total = run.done.length + run.queue.length + (active ? 1 : 0);
      const current = active ? run.done.length + 1 : run.done.length || Math.min(1,total);
      const speed = active?.speed ?? (active?.count ? active.count / Math.max((Date.now() - active.startedAt) / 60000, 1 / 60) : run.last?.speed || 0);
      const slow = run.baselineSpeed !== null && speed > 0 && speed < run.baselineSpeed * 0.5;
      const count = active?.count ?? run.last?.count ?? 0;
      const label = active ? pieceLabel(active.piece) : run.last?.label || (run.queue[0] ? pieceLabel(run.queue[0]) : 'Tamamlandı');
      const number = value => value.toLocaleString('tr-TR');
      $('#chunk-progress').textContent = `Parça ${current}/${total} (${label}) · bu parçada ${number(count)} reklam · toplam benzersiz: ${number(run.uniqueCount)} · ham: ${number(run.rawCount)} · ${Math.round(speed)} reklam/dk${slow ? ' · Hız düştü, sekme öne alınmalı ya da dinlenmeli' : ''}`;
      const notes = [run.phase === 'done' ? 'Parçalı tarama tamamlandı.' : !run.running ? 'Duraklatıldı. Devam Et ile kaldığın parçadan sürdürebilirsin.' : !active ? 'Sonraki parça bekleniyor.' : '', run.overlap ? 'Meta filtresi pencerede yayında olan reklamları getiriyor, parçalar çakışabilir' : '', run.lastError || '', run.notification?.status === 'failed' ? 'Telegram özeti gönderilemedi: ' + run.notification.error : ''];
      $('#chunk-feedback').textContent = notes.filter(Boolean).join(' ');
      const failures = run.done.filter(item => item.status === 'failed');
      $('#chunk-failures').hidden = !failures.length;
      for (const item of failures) { const li = document.createElement('li'); li.textContent = `${pieceLabel(item.piece)}: ${item.error}`; $('#chunk-failures').append(li); }
    }
    $('#chunk-enabled').addEventListener('change', render);
    for (const button of document.querySelectorAll('[data-chunk-days]')) button.addEventListener('click', () => {
      const last = end(), days = button.dataset.chunkDays;
      $('#chunk-start').value = days === 'all' ? '2020-09-01' : new Date(Date.parse(last) - (Number(days) - 1) * 86400000).toISOString().slice(0, 10);
      $('#chunk-end').value = last;
    });
    $('#chunk-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!$('#chunk-enabled').checked) return;
      const config = { start: $('#chunk-start').value, end: $('#chunk-end').value, unit: $('#chunk-unit').value, limit: Number($('#chunk-limit').value), waitMin: Number($('#chunk-wait-min').value), waitMax: Number($('#chunk-wait-max').value) };
      void perform(event.submitter, async () => {
        try { await command('START_CHUNKS', { config }); await refreshState(true); }
        catch (error) { $('#chunk-feedback').textContent = error.message; throw error; }
      }).then(render);
    });
    function appendDiagnostics(){if(getState().chunkRun?.visible && getState().chunkRun.overlap)$('#scan-diagnostics').textContent+=' · Meta filtresi pencerede yayında olan reklamları getiriyor, parçalar çakışabilir';}
    return { render, resumable, appendDiagnostics };
  }
  root.ChunkPopup = { create };
})(globalThis);
