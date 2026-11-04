const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const AdData=require('../ad-data.js'),ChunkExport=require('../chunk-export.js'),{workbook}=require('../xlsx.js');
const ads=[{id:'1234567890123456',advertiser:'Marka',fullText:'İlk anlamlı hook.\nİkinci satır',headline:'Teklif',cta:'Get Quote',startDate:'2026-10-21',chunkRank:2,chunkPiece:'2026-10-21 → 2026-10-27'},{id:'2234567890123456',advertiser:'Diğer',fullText:'=FORMULA()',chunkRank:1,chunkPiece:'2026-10-28 → 2026-11-04'}];
const now=new Date('2026-11-04T12:00:00Z');
test('only chunk exports append two columns; existing values, text ID, age ordering and normal schema are unchanged',()=>{
 const normal=ChunkExport.prepare(ads,false,now),chunk=ChunkExport.prepare(ads,true,now);
 assert.deepEqual(normal.rows,AdData.rows(ads,now));assert.deepEqual(normal.columns,AdData.COLUMNS);assert.deepEqual(normal.extraColumns,[]);
 assert.deepEqual(Object.keys(chunk.rows[0]),[...AdData.COLUMNS,...ChunkExport.EXTRA]);
 for(let i=0;i<normal.rows.length;i++)for(const column of AdData.COLUMNS)assert.equal(chunk.rows[i][column],normal.rows[i][column]);
 assert.equal(chunk.rows[0]['Sıra (gösterim sıralaması)'],2);assert.equal(chunk.rows[0]['Parça (tarih aralığı)'],'2026-10-21 → 2026-10-27');
 assert(!JSON.stringify(chunk.rows).includes('chunkRank'));assert(!JSON.stringify(chunk.rows).includes('chunkPiece'));
 const blank=ChunkExport.prepare([{id:'1234567890123456'}],true,now);assert.equal(blank.rows[0][ChunkExport.EXTRA[0]],'');
});
test('extended CSV preserves BOM, quoted multiline text, formula protection and appended order',()=>{
 const prepared=ChunkExport.prepare(ads,true,now),csv=ChunkExport.csv(prepared.rows);
 assert(csv.startsWith('\uFEFF'));assert(csv.split('\r\n')[0].endsWith('"Tam Metin","Sıra (gösterim sıralaması)","Parça (tarih aralığı)"'));
 assert(csv.includes('"İlk anlamlı hook.\nİkinci satır"'));assert(csv.includes("'=FORMULA()"));assert(csv.includes('"2","2026-10-21 → 2026-10-27"'));
});
test('extended XLSX has 13 columns with unchanged summary and styles; normal XLSX remains byte-identical',()=>{
 const prepared=ChunkExport.prepare(ads,true,now),normal=AdData.rows(ads,now);
 const bytes=workbook(AdData.EXCEL_COLUMNS,prepared.rows,{extraColumns:prepared.extraColumns,searchName:'implant'}),xml=Buffer.from(bytes).toString();
 assert(xml.includes('A1:M3'));assert(xml.includes('Sıra (gösterim sıralaması)'));assert(xml.includes('Parça (tarih aralığı)'));assert(xml.includes('topLeftCell="C2"'));assert(xml.includes('sheet name="Özet"'));assert(!xml.includes('>Tam Metin<'));
 assert.deepEqual(workbook(AdData.EXCEL_COLUMNS,normal,{extraColumns:[],searchName:'implant'}),workbook(AdData.EXCEL_COLUMNS,normal,{searchName:'implant'}));
 // Golden SHA-256 produced by the pre-change XLSX writer for this fixed fixture.
 assert.equal(require('node:crypto').createHash('sha256').update(workbook(AdData.EXCEL_COLUMNS,normal,{searchName:'implant'})).digest('hex'),'da20ae7b249410f24796badb78b177357e6bdf67aa10d7358e7ddc384880939a');
 fs.writeFileSync('/tmp/meta-chunk-export.xlsx',bytes);fs.writeFileSync('/tmp/meta-chunk-export.csv',ChunkExport.csv(prepared.rows));
});
