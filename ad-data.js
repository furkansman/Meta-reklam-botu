(function (root) {
  'use strict';
  const EXCEL_COLUMNS = ['Reklam ID','Reklam Veren','Hook','Başlık (Headline)','Yayın Başlangıç','Yaş (gün)','Durum','Medya Türü','Medya URL','CTA','Hedef URL'];
  const COLUMNS = [...EXCEL_COLUMNS,'Tam Metin'];
  const GROUPS = ['Uzun süreli (30+ gün)','Orta (8-29 gün)','Yeni (2-7 gün)','Test (0-1 gün)'];
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
  const compact = (line) => line.replace(/\s+/g,' ').trim();
  const domainLine = (line) => /^(?:whatsapp|instagram|facebook|messenger|(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/i.test(line);
  function cleanPrimary(value) {
    const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim());
    const unique=[];
    for(const line of lines){
      if(/^\d{1,2}:\d{2}(?:\s*\/\s*\d{1,2}:\d{2})?$/.test(line)||/Üzgünüz, bu videoyu oynatmada sorun yaşıyoruz|Düşük gösterim sayısı|Sorry, we.re having trouble playing this video|Low impressions/i.test(line))continue;
      if(line&&unique.some(other=>compact(other)===compact(line)))continue;
      unique.push(line);
    }
    return unique.filter((line,index)=>!line||compact(line)!==compact(unique.filter((_,i)=>i!==index).join(' '))).join('\n').trim();
  }
  function parseCardText(value,advertiser='') {
    let raw=String(value||'').replace(/\r\n?/g,'\n');
    const sponsor=raw.match(/(?:^|\n)[ \t]*(?:Sponsorlu|Sponsored)[ \t]*(?:\n|$)/i)||raw.match(/Sponsorlu|Sponsored/i);
    if(sponsor)raw=raw.slice(sponsor.index+sponsor[0].length);
    raw=raw.replace(/Reklam Detaylarını Gör|See ad details/gi,'');
    const lines=cleanPrimary(raw).split('\n').map(line=>line.trim()).filter(line=>
      !parseDate(line)&&!/^(?:Kütüphane Kodu|Library ID)\s*:?\s*\d+$/i.test(line)&&
      !/^(?:Active|Inactive|Aktif|Etkin|Platformlar|Platforms?)$/i.test(line));
    while(lines.length&&!lines.at(-1))lines.pop();
    const cta=lines.pop()||'';
    while(lines.length&&!lines.at(-1))lines.pop();
    let headline=lines.pop()||'';
    if(domainLine(headline))headline='';
    while(lines.length&&!lines.at(-1))lines.pop();
    if(lines.length&&domainLine(lines.at(-1)))lines.pop();
    const fullText=cleanPrimary(lines.join('\n'));
    return {fullText,headline,cta,hook:makeHook(fullText,headline,advertiser)};
  }
  function makeHook(fullText,headline='',advertiser='') {
    const contact=line=>/(?:https?:\/\/|www\.)|[^\s@]+@[^\s@]+\.[^\s@]+|^(?:e-?posta|email)\s*:|^(?:(?:tel(?:efon)?|phone|whatsapp)\s*:?[ ]*)?\+?[\d() .-]{7,}$/i.test(line)||/^(randevu al|book now|appointment|bize ulaşın|contact us|mesaj gönder|send message)$/i.test(line)||domainLine(line);
    const brand=compact(advertiser).toLocaleLowerCase('tr-TR');
    const removeBrand=line=>brand&&compact(line).toLocaleLowerCase('tr-TR').startsWith(brand)&&(line.length===advertiser.length||/[\s:|–—-]/.test(line[advertiser.length]))?line.slice(advertiser.length).replace(/^[\s:|–—-]+/,''):line;
    const lines=String(fullText||'').split('\n').map(line=>line.trim());let start=-1;
    for(let i=0;i<lines.length;i++){lines[i]=removeBrand(lines[i]);if(/[\p{L}\p{N}]/u.test(lines[i])&&!contact(lines[i])){start=i;break;}}
    if(start<0){const fallback=removeBrand(String(headline||'').trim());return truncate(sentence(fallback));}
    const paragraph=[];
    for(let i=start;i<lines.length;i++){
      const line=lines[i];if(!line)break;if(contact(line))break;
      if(!/[\p{L}\p{N}]/u.test(line))continue;
      paragraph.push(line);
    }
    return truncate(sentence(paragraph.join(' ')));
  }
  function sentence(text) {
    const abbreviations=/\b(?:Dt|Dr|Uzm|Op|Prof|Doç|Yrd)\.$/iu;
    for(let i=0;i<text.length;i++)if(/[.!?]/.test(text[i])){
      if(text[i]==='.'&&(abbreviations.test(text.slice(0,i+1))||(/\d/.test(text[i-1]||'')&&/\d/.test(text[i+1]||''))))continue;
      return text.slice(0,i+1);
    }
    return text;
  }
  function truncate(text){if(text.length<=150)return text;const prefix=text.slice(0,149);const boundary=prefix.lastIndexOf(' ');return (boundary>0?prefix.slice(0,boundary).trimEnd():'')+'…';}
  function status(age){return age===''||age<0?'':age>=30?GROUPS[0]:age>=8?GROUPS[1]:age>=2?GROUPS[2]:GROUPS[3];}
  function targetUrl(value) {
    try {
      let url = new URL(value);
      for (let depth=0; depth<4 && /^(?:l|lm)\.facebook\.com$/.test(url.hostname) && url.searchParams.has('u'); depth++) url = new URL(url.searchParams.get('u'));
      if (!/^https?:$/.test(url.protocol) || /(^|\.)(facebook\.com|instagram\.com|messenger\.com|m\.me|wa\.me|whatsapp\.com|whatsapp\.net)$/.test(url.hostname)) return '';
      for (const key of [...url.searchParams.keys()]) if (/^(fbclid|igshid|utm_.*)$/i.test(key)) url.searchParams.delete(key);
      return url.href;
    } catch { return ''; }
  }
  function rows(ads,now=new Date()) {
    const seen=new Set(), day=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
    return ads.filter(ad=>{const id=String(ad.libraryId||ad.id||'');if(!/^\d{10,}$/.test(id)||seen.has(id))return false;seen.add(id);return true;}).map(ad=>{
      const date=validDate(ad.startDate)||parseDate(ad.rawText), age=date?Math.floor((day-Date.parse(date+'T00:00:00Z'))/86400000):'';
      const fullText=cleanPrimary(ad.fullText??ad.primaryText??ad.text);
      const headline=ad.headline||'', hook=makeHook(fullText,headline,ad.advertiser||'');
      const type=({image:'Görsel',video:'Video',carousel:'Carousel','Görsel':'Görsel','Video':'Video','Carousel':'Carousel'})[ad.mediaType]||'';
      const values=[String(ad.libraryId||ad.id),ad.advertiser||'',hook,headline,date,age,status(age),type,ad.mediaUrl||'',ad.cta||'',targetUrl(ad.targetUrl),fullText];
      return Object.fromEntries(COLUMNS.map((column,index)=>[column,values[index]]));
    }).sort((a,b)=>(b['Yaş (gün)']===''?-Infinity:b['Yaş (gün)'])-(a['Yaş (gün)']===''?-Infinity:a['Yaş (gün)']));
  }
  function summary(records,searchName='') {
    const distribution=(key,labels)=>labels.map(label=>[label,records.filter(row=>row[key]===label).length]);
    const advertisers=new Map(),ctas=new Map(),patterns=new Map();
    for(const row of records){
      const name=row['Reklam Veren']||'Belirtilmemiş';if(!advertisers.has(name))advertisers.set(name,[]);advertisers.get(name).push(row);
      if(row.CTA)ctas.set(row.CTA,(ctas.get(row.CTA)||0)+1);
      const words=row.Hook.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}\s]/gu,'').split(/\s+/).filter(Boolean).slice(0,3);
      if(words.length){const key=words.join(' ');const group=patterns.get(key)||{count:0,example:row.Hook};group.count++;patterns.set(key,group);}
    }
    return {searchName,total:records.length,status:distribution('Durum',GROUPS).concat(records.some(row=>!row.Durum)?[['Tarihsiz',records.filter(row=>!row.Durum).length]]:[]),media:distribution('Medya Türü',['Görsel','Video','Carousel']).concat(records.some(row=>!row['Medya Türü'])?[['Belirtilmemiş',records.filter(row=>!row['Medya Türü']).length]]:[]),
      advertisers:[...advertisers].map(([name,items])=>{const ages=items.map(row=>row['Yaş (gün)']).filter(age=>age!=='');return [name,items.length,ages.length?Math.max(...ages):'',ages.length?Math.round(ages.reduce((sum,age)=>sum+age,0)/ages.length*10)/10:'',ages.filter(age=>age>=30).length];}).sort((a,b)=>b[4]-a[4]||b[1]-a[1]||a[0].localeCompare(b[0],'tr')),
      ctas:[...ctas].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'tr')).slice(0,8),patterns:[...patterns].filter(([,group])=>group.count>=2).map(([key,group])=>[key,group.count,group.example]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'tr'))};
  }
  function csv(records) {
    const quote = (value) => { let text=String(value ?? ''); if (/^(?:\s*[=+\-@]|[\t\r])/.test(text)) text="'"+text; return '"'+text.replaceAll('"','""')+'"'; };
    return '\uFEFF'+[COLUMNS.map(quote).join(','),...records.map((row) => COLUMNS.map((column) => quote(row[column])).join(','))].join('\r\n');
  }
  const api = { COLUMNS,EXCEL_COLUMNS,GROUPS,parseDate,validDate,cleanPrimary,parseCardText,makeHook,status,summary,targetUrl,rows,csv };
  root.AdData=api;
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
})(globalThis);
