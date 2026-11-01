(function (root) {
  'use strict';
  const COLUMNS = ['Reklam ID','Reklam Veren','Metin (Primary Text)','Başlık (Headline)','Yayın Başlangıç','Yaş (gün)','Medya Türü','Medya URL','CTA','Hedef URL','Platformlar','Reklam Linki'];
  const MONTHS = [['january','jan','ocak','oca'],['february','feb','şubat','şub'],['march','mar','mart'],['april','apr','nisan','nis'],['may','mayıs'],['june','jun','haziran','haz'],['july','jul','temmuz','tem'],['august','aug','ağustos','ağu'],['september','sep','sept','eylül','eyl'],['october','oct','ekim','eki'],['november','nov','kasım','kas'],['december','dec','aralık','ara']];
  function parseDate(raw) {
    const text = String(raw || '');
    let match = text.match(/(\d{1,2})\s+([\p{L}]+)\.?\s+(\d{4})\s+(?:tarihinde\s+)?yayınlanmaya başladı/iu) || text.match(/Started running on\s+(\d{1,2})\s+([\p{L}]+)\.?\s+(\d{4})/iu);
    if (!match) { const us = text.match(/Started running on\s+([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i); if (us) match = [us[0],us[2],us[1],us[3]]; }
    if (!match) return '';
    const month = MONTHS.findIndex((names) => names.includes(match[2].toLocaleLowerCase('tr-TR')) || names.includes(match[2].toLowerCase())) + 1;
    return validDate(`${match[3]}-${String(month).padStart(2,'0')}-${match[1].padStart(2,'0')}`);
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value ? value : '';
  }
  function cleanPrimary(value) {
    const lines = String(value || '').replace(/\r\n?/g,'\n').split('\n').map((line) => line.trim()).filter((line) => line && !/^\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}$/.test(line));
    const result = [];
    const compact = (line) => line.replace(/\s+/g,' ').trim();
    for (const line of lines) if (!result.some((other) => compact(other) === compact(line))) result.push(line);
    // A collapsed copy of the complete multiline text is often rendered for accessibility.
    return result.filter((line,index) => compact(line) !== compact(result.filter((_,i) => i !== index).join(' '))).join('\n');
  }
  function targetUrl(value) {
    try {
      let url = new URL(value);
      for (let depth=0; depth<4 && /^(?:l|lm)\.facebook\.com$/.test(url.hostname) && url.searchParams.has('u'); depth++) url = new URL(url.searchParams.get('u'));
      if (!/^https?:$/.test(url.protocol) || /(^|\.)(facebook\.com|instagram\.com|messenger\.com|m\.me|wa\.me|whatsapp\.com|whatsapp\.net)$/.test(url.hostname)) return '';
      for (const key of [...url.searchParams.keys()]) if (/^(fbclid|igshid|utm_.*)$/i.test(key)) url.searchParams.delete(key);
      return url.href;
    } catch { return ''; }
  }
  function rows(ads, now = new Date()) {
    const seen = new Set();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = Date.UTC(today.getFullYear(),today.getMonth(),today.getDate());
    return ads.filter((ad) => { const id=String(ad.libraryId || ad.id || ''); if (!/^\d{10,}$/.test(id) || seen.has(id)) return false; seen.add(id); return true; }).map((ad) => {
      const date = validDate(ad.startDate) || parseDate(ad.rawText);
      const type = ({image:'Görsel',video:'Video',carousel:'Carousel','Görsel':'Görsel','Video':'Video','Carousel':'Carousel'})[ad.mediaType] || '';
      const values = [String(ad.libraryId || ad.id),ad.advertiser || '',cleanPrimary(ad.primaryText ?? ad.text),ad.headline || '',date,date ? Math.floor((day-Date.parse(date+'T00:00:00Z'))/86400000) : '',type,ad.mediaUrl || '',ad.cta || '',targetUrl(ad.targetUrl),Array.isArray(ad.platforms) ? [...new Set(ad.platforms.map((name) => ({facebook:'Facebook',instagram:'Instagram',messenger:'Messenger','audience network':'Audience Network',whatsapp:'WhatsApp'})[String(name).toLowerCase()]).filter(Boolean))].join(', ') : '',ad.libraryUrl || (/^\d+$/.test(String(ad.libraryId || ad.id)) ? `https://www.facebook.com/ads/library/?id=${ad.libraryId || ad.id}` : '')];
      return Object.fromEntries(COLUMNS.map((column,i) => [column, values[i]]));
    });
  }
  function csv(records) {
    const quote = (value) => { let text=String(value ?? ''); if (/^(?:\s*[=+\-@]|[\t\r])/.test(text)) text="'"+text; return '"'+text.replaceAll('"','""')+'"'; };
    return '\uFEFF'+[COLUMNS.map(quote).join(','),...records.map((row) => COLUMNS.map((column) => quote(row[column])).join(','))].join('\r\n');
  }
  const api = { COLUMNS,parseDate,validDate,cleanPrimary,targetUrl,rows,csv };
  root.AdData=api;
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
})(globalThis);
