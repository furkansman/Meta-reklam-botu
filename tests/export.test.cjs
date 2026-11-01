const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const data=require('../ad-data.js');
const xlsx=require('../xlsx.js');
const expected=['Reklam ID','Reklam Veren','Metin (Primary Text)','Başlık (Headline)','Yayın Başlangıç','Yaş (gün)','Medya Türü','Medya URL','CTA','Hedef URL','Platformlar','Reklam Linki'];
const fixture={id:'1234567890123456',libraryId:'1234567890123456',advertiser:'Örnek Marka',primaryText:'İlk satır\nİkinci satır\nİlk satır İkinci satır\n0:00 / 0:13',headline:'Özel teklif',startDate:'2026-05-26',mediaType:'video',mediaUrl:'https://example.org/ad.mp4',cta:'Get Quote',targetUrl:'https://l.facebook.com/l.php?u='+encodeURIComponent('https://example.org/offer?utm_source=meta&fbclid=test&igshid=x&keep=1'),platforms:['instagram','facebook'],rawText:'PRIVATE RAW TEXT',collectedAt:'PRIVATE TIMESTAMP'};
test('exact schema, flat JSON, string IDs, duplicate removal and no raw fields',()=>{
 const records=data.rows([fixture,{...fixture}],new Date('2026-11-01T12:00:00'));
 assert.equal(records.length,1);assert.deepEqual(Object.keys(records[0]),expected);assert.equal(records[0]['Reklam ID'],'1234567890123456');assert.equal(records[0]['Yaş (gün)'],159);assert.equal(records[0]['Metin (Primary Text)'],'İlk satır\nİkinci satır');assert.equal(records[0]['Hedef URL'],'https://example.org/offer?keep=1');assert.equal(records[0]['Platformlar'],'Instagram, Facebook');assert(!JSON.stringify(records).includes('PRIVATE'));assert(Object.values(records[0]).every(value=>['string','number'].includes(typeof value)));
});
test('Turkish abbreviated/full months and English date formats',()=>{
 const names=['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
 names.forEach((name,i)=>assert.equal(data.parseDate(`2 ${name} 2026 tarihinde yayınlanmaya başladı`),`2026-${String(i+1).padStart(2,'0')}-02`));
 assert.equal(data.parseDate('26 May 2026 tarihinde yayınlanmaya başladı'),'2026-05-26');assert.equal(data.parseDate('Started running on 26 May 2026'),'2026-05-26');assert.equal(data.parseDate('Started running on October 10, 2025'),'2025-10-10');assert.equal(data.parseDate('31 Şub 2026 tarihinde yayınlanmaya başladı'),'');
 const row=data.rows([{id:'9999999999999999'}])[0];assert.equal(row['Yaş (gün)'],'');assert.equal(row['Yayın Başlangıç'],'');
});
test('BOM CSV, quoted ordered header and preserved multiline cells',()=>{
 const records=data.rows([fixture],new Date('2026-11-01T12:00:00'));const csv=data.csv(records);
 assert(csv.startsWith('\uFEFF'));assert.equal(csv.slice(1).split('\r\n')[0],expected.map(name=>'"'+name+'"').join(','));assert(csv.includes('"İlk satır\nİkinci satır"'));assert(csv.includes('"1234567890123456"'));
 const output=path.join(__dirname,'../examples');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'reklamlar-ornek.csv'),csv);fs.writeFileSync('/tmp/meta-export-test.xlsx',xlsx.workbook(expected,records));
});
test('social and message destinations stay empty, campaign parameters removed',()=>{
 for(const url of ['https://wa.me/123','https://api.whatsapp.com/send?phone=123','https://instagram.com/test','https://m.me/example','https://messenger.com/t/example'])assert.equal(data.targetUrl(url),'');
 assert.equal(data.targetUrl('https://example.org/?utm_medium=ad&UTM_SOURCE=x&fbclid=y&product=1'),'https://example.org/?product=1');
});

test('XLSX enforces Excel limits with a clear error',()=>{assert.throws(()=>xlsx.workbook(expected,[{...data.rows([fixture])[0],'Metin (Primary Text)':'x'.repeat(32768)}]),/CSV veya JSON/);});
