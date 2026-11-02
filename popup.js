'use strict';

const $ = (selector) => document.querySelector(selector);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const feedback = (message) => { $('#feedback').textContent = message; };
let running = false;
let ready = false;
let liveProgress = null;
let busy = false;
let refreshQueue = Promise.resolve();
let state = {competitorProfiles:{},watchSettings:{enabled:false,time:'01:00',notifyUnchanged:true},watchRun:null,watchResults:{},watchReportError:'',watchSchedule:{}, telegramStatus: { enabled: false, tokenConfigured: false, chatId: '' }, ads: [], scrollCount: 0, settings: { autoScroll: true, speed: 'medium', maxAds: 100 }, history: [], competitors: [], competitorStats: {}, filters: { mediaType: 'all', platform: 'all' } };

function activateTab(tab) {
  tabs.forEach((item) => {
    const active = item === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  });
  feedback('');
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    activateTab(tabs[next]);
    tabs[next].focus();
  });
});

function render() {
  renderScan();
  $('#history-list').replaceChildren();
  state.history.forEach((entry) => {
    const li = document.createElement('li');
    const text = document.createElement('div');
    text.textContent = entry.query || 'Tarama oturumu';
    const detail = document.createElement('small');
    detail.textContent = `${entry.adCount ?? 0} reklam · ${new Date(entry.createdAt).toLocaleString('tr-TR')}`;
    text.append(detail);
    const archive = Array.isArray(entry.ads);
    const status = document.createElement('small');
    const telegramLabels = { queued: 'Telegram sırada', retrying: 'Telegram yeniden denenecek', sent: 'Telegram gönderildi', failed: 'Telegram gönderilemedi', disabled: 'Telegram kapalı', 'queue-full': 'Telegram kuyruğu dolu' };
    status.textContent = `${archive ? 'Veriler arşivlendi' : 'Yalnızca özet (arşiv yok)'} · ${telegramLabels[entry.telegram] || ''}`;
    text.append(status);
    const actions = document.createElement('div');
    actions.className = 'history-actions';
    for (const format of ['csv', 'json']) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'remove'; button.textContent = format.toUpperCase();
      button.disabled = !archive || !entry.ads.length;
      button.setAttribute('aria-label', `${new Date(entry.createdAt).toLocaleString('tr-TR')} oturumunu ${format.toUpperCase()} indir`);
      button.addEventListener('click', () => downloadRecords(entry.ads, format, `oturum-${entry.sessionId || entry.createdAt}`,queryName(entry.sourceUrl)));
      actions.append(button);
    }
    const summary = document.createElement('button');
    summary.type = 'button'; summary.className = 'remove'; summary.textContent = 'Telegram özeti';
    summary.disabled = !state.telegramStatus.enabled || !entry.sessionId;
    summary.addEventListener('click', () => perform(summary, async () => {
      await command('SEND_SUMMARY', { sessionId: entry.sessionId });
      feedback('Özet Telegram gönderim sırasına alındı.');
    }));
    actions.append(summary);
    li.className = 'history-item';
    li.append(text, actions);
    $('#history-list').append(li);
  });
  $('#history-empty').hidden = state.history.length > 0;
  $('#clear-history').hidden = state.history.length === 0;
  for (const id of ['history-csv', 'history-json']) document.getElementById(id).disabled = !ready || !state.history.some((entry) => entry.ads?.length);
  $('#competitor-list').replaceChildren();
  const watching=Boolean(state.watchRun?.running);
  $('#watch-all').disabled=!ready||busy||watching||!state.competitors.length;
  $('#watch-status').textContent=watching?`Rakip taraması çalışıyor · ${state.watchRun.active?.brand.name||state.watchRun.phase} · ${state.watchRun.items?.length||0}/${(state.watchRun.items?.length||0)+(state.watchRun.queue?.length||0)+(state.watchRun.active?1:0)}`:'Rakip taraması hazır';
  $('#watch-error').textContent=state.watchReportError||'';
  $('#watch-missed').hidden=!state.watchSchedule?.missed;
  state.competitors.forEach(name=>{
    const result=state.watchResults[name];const li=document.createElement('li');const title=document.createElement('strong');title.textContent=name;li.append(title);
    const detail=document.createElement('small');detail.textContent=result?.baseline?`Son tarama: ${new Date(result.lastScan).toLocaleString('tr-TR')} · ${result.newAds?.length||0} yeni · ${result.missingIds?.length||0} durmuş olabilir · toplam ${result.total}${result.partial?' (kısmi)':''}`:'Henüz taranmadı';li.append(detail);
    if(result?.error){const error=document.createElement('small');error.className='watch-error';error.textContent=`Taranamadı: ${result.error}`;li.append(error);}
    const actions=document.createElement('div');actions.className='history-actions';
    const scan=document.createElement('button');scan.type='button';scan.className='remove';scan.textContent='Şimdi tara';scan.disabled=watching;scan.addEventListener('click',()=>watchAction(()=>command('WATCH_START',{name})));actions.append(scan);
    const link=document.createElement('a');link.textContent='Reklamları aç';link.href=state.competitorProfiles[name]?.pageId?`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TR&view_all_page_id=${encodeURIComponent(state.competitorProfiles[name].pageId)}`:`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TR&q=${encodeURIComponent(name)}`;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
    const excel=document.createElement('button');excel.type='button';excel.className='remove';excel.textContent='Son analizi Excel indir';excel.disabled=!result?.ads?.length;excel.addEventListener('click',()=>downloadRecords(result.ads,'excel','rakip-analizi',name));actions.append(excel);
    const remove=document.createElement('button');remove.type='button';remove.className='remove';remove.textContent='Kaldır';remove.disabled=watching;remove.addEventListener('click',()=>watchAction(()=>command('REMOVE_COMPETITOR',{name})));actions.append(remove);li.append(actions);
    if(result?.newAds?.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Hook’ları gör (${result.newAds.length})`;details.append(summary);for(const ad of result.newAds){const text=document.createElement('p');text.textContent=ad.hook||AdData.makeHook(ad.fullText||ad.text,ad.headline,name);details.append(text);}li.append(details);}
    $('#competitor-list').append(li);
  });
  $('#competitors-empty').hidden=state.competitors.length>0;

}

async function command(type, payload = {}) {
  let response;
  try { response = await chrome.runtime.sendMessage({ type, ...payload }); }
  catch { throw new Error('Eklenti bağlantısı kurulamadı. Eklentiyi yeniden yükle.'); }
  if (!response?.ok) throw new Error(response?.error || 'İşlem tamamlanamadı.');
  return response;
}
async function perform(button, operation) {
  if (!ready || busy) return;
  busy = true;
  button.disabled = true;
  renderScan();
  try { await operation(); }
  catch (error) { feedback(error.message || 'İşlem tamamlanamadı.'); }
  finally { busy = false; if (button.isConnected) button.disabled = false; renderScan(); }
}

function filteredAds() {
  return state.ads.filter((ad) => {
    const media = state.filters.mediaType;
    const mediaMatch = media === 'all' || (media === 'video' ? (ad.mediaType === 'video' || ad.videos?.length > 0) : (ad.mediaType === 'image' || ad.images?.length > 0) && ad.mediaType !== 'video' && !ad.videos?.length);
    return mediaMatch && (state.filters.platform === 'all' || ad.platforms?.includes(state.filters.platform));
  });
}

function animateCount(node, value) {
  const formatted = value.toLocaleString('tr-TR');
  if (node.textContent === formatted) return;
  node.textContent = formatted;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.getAnimations().forEach((animation) => animation.cancel());
    node.animate([{transform:'scale(1)'},{transform:'scale(1.1)'},{transform:'scale(1)'}],{duration:180,easing:'ease-out'});
  }
}
function renderLiveBar() {
  const fallback = { ads:state.ads.length, scrolls:state.scrollCount,
    status:state.scan?.running ? 'scanning' : ['limit','visible-complete','no-new-ads','meta-exhausted'].includes(state.scan?.reason) ? 'completed' : state.scan?.reason ? 'stopped' : 'ready' };
  const useLive = liveProgress && (liveProgress.sessionId === (state.scan?.sessionId || null));
  const progress = useLive ? liveProgress : fallback;
  animateCount($('#ad-count'),progress.ads);
  animateCount($('#scroll-count'),progress.scrolls);
  const labels = { ready:'Hazır', scanning:'Taranıyor…', stopped:'Durduruldu', completed:`Tamamlandı (${progress.ads.toLocaleString('tr-TR')} reklam)` };
  $('#scan-status').textContent = !ready ? 'Yükleniyor…' : state.scan?.reason==='meta-exhausted' ? `Meta daha fazla reklam yüklemedi (${progress.ads.toLocaleString('tr-TR')} benzersiz reklam)` : progress.recoveryRound ? `Yükleme kurtarılıyor (${progress.recoveryRound}/3)` : labels[progress.status];
  $('#collected-summary').textContent = `${progress.ads.toLocaleString('tr-TR')} reklam toplandı`;
  $('#meta-totals').textContent=`Meta’nın bildirdiği: ${progress.reportedTotal!=null?'~'+progress.reportedTotal:'bilinmiyor'} / Toplanan benzersiz: ${progress.ads.toLocaleString('tr-TR')} · Çoklu versiyon karşılaşması: ${progress.versionEncounters||0}`;
  $('#scan-dot').classList.toggle('scanning',ready && progress.status === 'scanning');
}
function applyProgress(progress) {
  if (!progress || !Number.isInteger(progress.ads) || progress.ads < 0 || !Number.isInteger(progress.scrolls) || progress.scrolls < 0 ||
      !Number.isInteger(progress.revision) || !['ready','scanning','stopped','completed'].includes(progress.status)) return;
  if (liveProgress && progress.revision < liveProgress.revision) return;
  liveProgress = progress;
  renderLiveBar();
}
chrome.runtime.onMessage.addListener((message,sender) => {
  if (message?.type === 'SCAN_PROGRESS' && sender.id === chrome.runtime.id && !sender.tab) applyProgress(message);
});
function renderScan() {
  renderLiveBar();
  $('#start-label').textContent = running ? 'Çalışıyor…' : 'Taramayı Başlat';
  renderDateAnalysis();
  const exported = AdData.rows(state.ads);
  const filled = (column) => `${exported.filter((row) => row[column] !== '').length}/${exported.length}`;
  const completeness = (state.scan?.reason==='meta-exhausted'?`Meta daha fazla reklam yüklemedi (${state.ads.length.toLocaleString('tr-TR')} benzersiz reklam) · `:'')+`Hook: ${filled('Hook')}, Başlık: ${filled('Başlık (Headline)')}, CTA: ${filled('CTA')}, Tarih: ${filled('Yayın Başlangıç')}, Medya URL: ${filled('Medya URL')}, Hedef URL: ${filled('Hedef URL')}`;
  const discovery = state.scan?.discovery;
  const totals=liveProgress && liveProgress.sessionId===state.scan?.sessionId?liveProgress:discovery;
  $('#meta-totals').textContent=`Meta’nın bildirdiği: ${totals?.reportedTotal!=null?'~'+totals.reportedTotal:'bilinmiyor'} / Toplanan benzersiz: ${(liveProgress && liveProgress.sessionId===state.scan?.sessionId?liveProgress.ads:state.ads.length).toLocaleString('tr-TR')} · Çoklu versiyon karşılaşması: ${totals?.versionEncounters||0}`;
  $('#scan-diagnostics').textContent = discovery ? `Sayfa betiği v${discovery.version} · ${discovery.candidates} aday / ${discovery.matched} kart · Kütüphane Kodu: ${discovery.libraryCodeTexts || 0} · ${completeness}` : completeness;
  if(discovery?.speed)$('#scan-diagnostics').textContent+=` · Hız: ${Math.round(discovery.speed)} reklam/dk`;
  if(discovery?.slow)$('#scan-diagnostics').textContent+=" · Sayfa ağırlaştı, 'Devam Et' ile sayfayı yenileyip kaldığın yerden devam edebilirsin";
  $('#export-summary').textContent = `${filteredAds().length} / ${state.ads.length} reklam dışa aktarılacak`;

  $('#resume-scan').disabled=!ready||busy||running||!state.ads.length;
  $('#start-scan').disabled = !ready || busy || running;
  $('#stop-scan').disabled = !ready || busy || !running || Boolean(state.scan?.stopping);
  $('#auto-refresh').disabled=!ready||busy||running;
  $('#auto-scroll').disabled = !ready || busy || running;
  $('#scroll-speed').disabled = !ready || busy || running || !$('#auto-scroll').checked;
  $('#max-ads').disabled = !ready || busy || running;
  $('#clear-results').disabled = !ready || busy || running;
  $('#export-csv').disabled = !ready || busy || running || filteredAds().length === 0;
  $('#export-excel').disabled = !ready || busy || running || filteredAds().length === 0;
  $('#export-json').disabled = !ready || busy || running || filteredAds().length === 0;
}

$('#auto-scroll').addEventListener('change', renderScan);
$('#scan-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const maxAds = Number($('#max-ads').value);
  if (!Number.isInteger(maxAds) || maxAds < 1 || maxAds > 10000) {
    feedback('Maksimum reklam sayısı 1–10000 arasında bir tam sayı olmalı.'); return;
  }
  perform(event.submitter, async () => {
    const settings = { autoScroll: $('#auto-scroll').checked, autoRefresh:$('#auto-refresh').checked, speed: $('#scroll-speed').value, maxAds };
    await command('START_SCAN', { settings });
    state.settings = settings;
    await refreshState();
    feedback('Tarama başlatıldı. Açık Meta sayfasında devam eder.');
  }).then(renderScan);
});

$('#resume-scan').addEventListener('click',(event)=>perform(event.currentTarget,async()=>{await command('RESUME_SCAN',{settings:{autoScroll:$('#auto-scroll').checked,autoRefresh:$('#auto-refresh').checked,speed:$('#scroll-speed').value,maxAds:Number($('#max-ads').value)}});await refreshState();}));

$('#stop-scan').addEventListener('click', (event) => perform(event.currentTarget, async () => {
  await command('STOP_SCAN');
  await refreshState();
}).then(renderScan));

$('#clear-results').addEventListener('click', (event) => perform(event.currentTarget, async () => {
  await command('CLEAR_RESULTS');
  await refreshState();
  feedback('Tarama sonuçları temizlendi.');
}).then(renderScan));

function exportAds(format) {
  if (!ready || busy || running) return;
  downloadRecords(filteredAds(), format, 'meta-reklamlar');
}
function queryName(value){try{const url=new URL(value);return url.searchParams.get('q')||url.searchParams.get('view_all_page_id')||'Meta Ad Library';}catch{return 'Meta Ad Library';}}
function exportSearchName(ads) {
  for(const value of [state.scan?.sourceUrl,...ads.map(ad=>ad.sourceUrl)]) {
    try {const url=new URL(value);const name=url.searchParams.get('q')||url.searchParams.get('view_all_page_id');if(name)return name;}catch{}
  }
  return nameFromHistory(ads);
}
function nameFromHistory(ads){const ids=new Set(ads.map(ad=>ad.id));for(const entry of state.history){if(entry.ads?.some(ad=>ids.has(ad.id))){try{return new URL(entry.sourceUrl).searchParams.get('q')||'Meta Ad Library';}catch{}}}return 'Meta Ad Library';}
function downloadRecords(ads, format, name, searchName = null) {
  if (!ready || !ads.length) { feedback('İndirilecek arşiv verisi bulunamadı.'); return; }
  const records = AdData.rows(ads);
  let content;
  try { content = format === 'csv' ? AdData.csv(records) : format === 'excel' ? AdXlsx.workbook(AdData.EXCEL_COLUMNS,records,{searchName:searchName || exportSearchName(ads)}) : JSON.stringify(records,null,2); }
  catch (error) { feedback(error.message); return; }
  const types = { csv:'text/csv;charset=utf-8', json:'application/json;charset=utf-8', excel:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const url = URL.createObjectURL(new Blob([content],{type:types[format]}));
  const link = document.createElement('a');
  link.href = url; link.download = `${name}-${Date.now()}.${format === 'excel' ? 'xlsx' : format}`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
  feedback(`${format === 'excel' ? 'XLSX' : format.toUpperCase()} dosyası hazırlandı.`);
}
$('#export-csv').addEventListener('click', () => exportAds('csv'));
$('#export-json').addEventListener('click', () => exportAds('json'));
$('#export-excel').addEventListener('click', () => exportAds('excel'));
for (const format of ['csv', 'json']) document.getElementById(`history-${format}`).addEventListener('click', () => {
  const records = state.history.flatMap((entry) => (entry.ads || []).map((ad) => ({ sessionId: entry.sessionId, sessionDate: new Date(entry.createdAt).toISOString(), ...ad })));
  downloadRecords(records, format, 'meta-gecmis','Geçmiş arşivi');
});
const TOKEN_MASK='••••••••';
function telegramStatus(message,kind='success') {
  const line=$('#token-status');line.textContent=message;line.className=`hint token-status ${kind}`;
}
async function telegramAction(button,operation) {
  if(!ready||busy)return;
  busy=true;button.disabled=true;renderScan();
  try {await operation();}
  catch(error){telegramStatus(error.message||'Telegram ayarları kaydedilemedi. Tekrar dene.','error');}
  finally{busy=false;button.disabled=false;renderScan();}
}
$('#telegram-token').addEventListener('focus',()=>{if($('#telegram-token').value===TOKEN_MASK)$('#telegram-token').select();});
$('#telegram-form').addEventListener('submit',(event)=>{
  event.preventDefault();
  telegramAction(event.submitter,async()=>{
    const value=$('#telegram-token').value;
    telegramStatus('Kaydediliyor…','pending');
    await command('SAVE_TELEGRAM',{token:value,chatId:$('#telegram-chat-id').value,enabled:$('#telegram-enabled').checked});
    await refreshState();populateTelegram();
    telegramStatus(`Kaydedildi ✓ · Token kaydedildi (son 4 hane: ${state.telegramStatus.tokenSuffix||''})`);
  });
});
$('#telegram-test').addEventListener('click',(event)=>telegramAction(event.currentTarget,async()=>{
  telegramStatus('Test mesajı gönderiliyor…','pending');
  await command('TEST_TELEGRAM',{token:$('#telegram-token').value,chatId:$('#telegram-chat-id').value});telegramStatus('Test mesajı gönderildi ✓');
}));
$('#telegram-remove').addEventListener('click',(event)=>telegramAction(event.currentTarget,async()=>{
  await command('REMOVE_TELEGRAM');await refreshState();populateTelegram();telegramStatus('Telegram bilgileri silindi.');
}));
function populateTelegram() {
  $('#telegram-enabled').checked=state.telegramStatus.enabled;
  $('#telegram-chat-id').value=state.telegramStatus.chatId;
  $('#telegram-token').value='';
  $('#telegram-token').placeholder=state.telegramStatus.tokenConfigured?`Kayıtlı token: ••••${state.telegramStatus.tokenSuffix||''} (değiştirmek için yeni token yapıştır)`:'BotFather tokenını yapıştır';
  telegramStatus(state.telegramStatus.tokenConfigured?`Token kaydedildi (son 4 hane: ${state.telegramStatus.tokenSuffix||''})`:'Token henüz kaydedilmedi.',state.telegramStatus.tokenConfigured?'success':'pending');
}

$('#clear-history').addEventListener('click', (event) => perform(event.currentTarget, async () => {
  await command('CLEAR_HISTORY');
  await refreshState();
  feedback('Arama geçmişi temizlendi.');
}));

$('#competitor-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#competitor-name').value.trim();
  if (!name) { feedback('Bir marka adı gir.'); return; }
  if (state.competitors.some((item) => item.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'))) {
    feedback('Bu marka zaten listende.'); return;
  }
  perform(event.submitter, async () => {
    await command('ADD_COMPETITOR', { name,pageInput:$('#competitor-page').value });
    await refreshState();
    $('#competitor-name').value = '';$('#competitor-page').value='';
    render();
    feedback('Marka takip listesine eklendi.');
  });
});

async function watchAction(operation){try{await operation();await refreshState();}catch(error){$('#watch-error').textContent=error.message;}}
$('#watch-all').addEventListener('click',()=>watchAction(()=>command('WATCH_START')));
$('#watch-missed').addEventListener('click',()=>watchAction(()=>command('WATCH_START')));
$('#watch-save').addEventListener('click',()=>watchAction(()=>command('WATCH_SETTINGS',{enabled:$('#watch-enabled').checked,time:$('#watch-time').value,notifyUnchanged:$('#watch-unchanged').checked})));
$('#filters-form').addEventListener('submit', (event) => {
  event.preventDefault();
  perform(event.submitter, async () => {
    const filters = { mediaType: $('#media-type').value, platform: $('#platform').value };
    await command('SAVE_FILTERS', { filters });
    await refreshState();
    feedback('Filtre tercihlerin kaydedildi.');
  });
});

const REASONS = {
  limit: 'Maksimum reklam sayısına ulaşıldı.', 'visible-complete': 'Görünür reklamlar toplandı.',
  'meta-exhausted':'Meta daha fazla reklam yüklemedi. Toplanan veriler korunuyor; Devam Et ile yeniden deneyebilirsin.',
  'no-cards': 'Reklam kartı bulunamadı. Meta sayfasında sonuçların yüklenmesini bekle; giriş/çerez pencerelerini kapatıp tekrar dene.',
  'no-new-ads': 'Yeni reklam bulunamadı. Sayfa yüklemesini ve dilini kontrol et.',
  'page-changed': 'Sayfa değiştiği için tarama durdu.', error: 'Tarama sırasında hata oluştu.',
  'storage-error': 'Sonuçlar kaydedilemedi. Depolama alanını kontrol et.', stopped: 'Tarama durduruldu.',
  disconnected: 'Tarama sekmesi kapandı, yenilendi veya bağlantısı kesildi.', 'start-error': 'Tarama başlatılamadı. Meta sekmesini yenile.'
};
function refreshState(reconcile = false) {
  const refresh = async () => {
  const saved = reconcile ? (await command('GET_STATE')).state : await chrome.storage.local.get(Object.keys(state).concat('scan'));
  const oldScan = state.scan;
  state = { ...state, ...saved };
  running = Boolean(state.scan?.running);
  render();
  if (!running && state.scan?.reason && (oldScan?.running || oldScan?.reason !== state.scan.reason)) feedback(REASONS[state.scan.reason] || '');
  };
  refreshQueue = refreshQueue.then(refresh, refresh);
  return refreshQueue;
}
async function init() {
  const buttons = [...document.querySelectorAll('button:not([role="tab"])')];
  buttons.forEach((button) => { button.disabled = true; });
  renderScan();
  try {
    const savedProgress = await chrome.storage.session.get('scanProgress');
    applyProgress(savedProgress.scanProgress);
    await refreshState(true);
    const currentProgress = await chrome.storage.session.get('scanProgress');
    applyProgress(currentProgress.scanProgress);
    const { uiTheme } = await chrome.storage.local.get('uiTheme');
    applyTheme(uiTheme === 'dark' ? 'dark' : 'light');
    populateTelegram();
    $('#watch-enabled').checked=state.watchSettings.enabled;$('#watch-time').value=state.watchSettings.time;$('#watch-unchanged').checked=state.watchSettings.notifyUnchanged;
    $('#media-type').value = state.filters.mediaType;
    $('#platform').value = state.filters.platform;
    $('#auto-scroll').checked = state.settings.autoScroll;
    $('#auto-refresh').checked=Boolean(state.settings.autoRefresh);
    $('#scroll-speed').value = state.settings.speed;
    $('#max-ads').value = state.settings.maxAds;
    ready = true;
    buttons.forEach((button) => { button.disabled = false; });
    render();
  } catch (error) { feedback(error.message); }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.scanProgress) applyProgress(changes.scanProgress.newValue);
  if(area==='local'&&changes.scanBatches){refreshState(true).catch(()=>{});return;}
  if (area === 'local' && ['ads', 'scrollCount', 'scan', 'history', 'competitors', 'competitorStats', 'filters', 'telegramStatus','competitorProfiles','watchSettings','watchRun','watchResults','watchReportError','watchSchedule'].some((key) => key in changes)) {
    refreshState().catch(() => feedback('Tarama durumu okunamadı.'));
  }
});
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').setAttribute('aria-pressed', String(theme === 'dark'));
  $('#theme-toggle').setAttribute('aria-label', theme === 'dark' ? 'Açık temayı aç' : 'Koyu temayı aç');
}
$('#theme-toggle').addEventListener('click', async () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try { await chrome.storage.local.set({ uiTheme: theme }); }
  catch { feedback('Tema tercihi kaydedilemedi.'); }
});

function adStartDate(ad) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ad.startDate || '')) return validDate(...ad.startDate.split('-').map(Number));
  const months = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12,
    ocak:1, şubat:2, mart:3, nisan:4, mayıs:5, haziran:6, temmuz:7, ağustos:8, eylül:9, ekim:10, kasım:11, aralık:12 };
  // Only labelled ad start dates count; collection dates are not ad ages.
  const raw = ad.rawText || '';
  const match = raw.match(/started running(?: on)?\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i) ||
    raw.match(/(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})\s+(?:tarihinde )?yayınlanmaya başladı/i);
  if (!match) return null;
  const month = months[match[2].toLocaleLowerCase('tr-TR')] || months[match[2].toLowerCase()];
  return month ? validDate(Number(match[3]), month, Number(match[1])) : null;
}
function validDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day && value.getTime() <= Date.now() ? value : null;
}
function renderDateAnalysis() {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dates = state.ads.map(adStartDate).filter(Boolean).sort((a, b) => a - b);
  const ages = dates.map((date) => Math.max(0, Math.floor((today - date.getTime()) / 86400000)));
  const format = (date) => date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  $('#oldest-date').textContent = dates.length ? format(dates[0]) : '—';
  $('#newest-date').textContent = dates.length ? format(dates[dates.length - 1]) : '—';
  $('#oldest-age').textContent = dates.length ? `${ages[0]} gün` : 'Tarih yok';
  $('#newest-age').textContent = dates.length ? `${ages[ages.length - 1]} gün` : 'Tarih yok';
  $('#average-age').textContent = dates.length ? Math.round(ages.reduce((sum, age) => sum + age, 0) / dates.length) : '—';
  $('#long-running').textContent = ages.filter((age) => age >= 30).length;
  $('#new-week').textContent = ages.filter((age) => age < 7).length;
  $('#new-day').textContent = ages.filter((age) => age < 1).length;
  $('#dated-summary').textContent = `${dates.length} / ${state.ads.length} reklamda tarih`;
}
init();
