(function(root){
  'use strict';
  const xml=(value)=>String(value??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  function workbook(columns,records){
    if (records.length > 1048575 || records.some(row => columns.some(column => String(row[column] ?? '').length > 32767))) throw new Error('Excel hücre/satır sınırı aşıldı. Tam veri için CSV veya JSON kullan.');
    const widths=[23,28,65,42,20,13,16,55,28,55,32,55];
    const cell=(value,col,row,style)=>typeof value==='number' ? `<c r="${col}${row}" s="${style}"><v>${value}</v></c>` : `<c r="${col}${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    const data=[columns,...records.map(record=>columns.map(column=>record[column]))].map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>cell(value,String.fromCharCode(65+j),i+1,i===0?1:j===0?2:j===2?3:0)).join('')}</row>`).join('');
    const files={
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Reklamlar" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData><autoFilter ref="A1:L${records.length+1}"/></worksheet>`
    };
    return zip(files);
  }
  function zip(files){
    const encoder=new TextEncoder(),chunks=[],central=[];let offset=0,centralSize=0;
    const crc=(bytes)=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
    const header=(length)=>{const bytes=new Uint8Array(length);return {bytes,view:new DataView(bytes.buffer)};};
    for(const [path,text] of Object.entries(files)){
      const name=encoder.encode(path),data=encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+text),checksum=crc(data);
      const local=header(30);local.view.setUint32(0,0x04034b50,true);local.view.setUint16(4,20,true);local.view.setUint32(14,checksum,true);local.view.setUint32(18,data.length,true);local.view.setUint32(22,data.length,true);local.view.setUint16(26,name.length,true);
      chunks.push(local.bytes,name,data);
      const item=header(46);item.view.setUint32(0,0x02014b50,true);item.view.setUint16(4,20,true);item.view.setUint16(6,20,true);item.view.setUint32(16,checksum,true);item.view.setUint32(20,data.length,true);item.view.setUint32(24,data.length,true);item.view.setUint16(28,name.length,true);item.view.setUint32(42,offset,true);central.push(item.bytes,name);centralSize+=46+name.length;offset+=30+name.length+data.length;
    }
    const end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,central.length/2,true);end.view.setUint16(10,central.length/2,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
    const result=new Uint8Array(offset+centralSize+22);let cursor=0;for(const chunk of [...chunks,...central,end.bytes]){result.set(chunk,cursor);cursor+=chunk.length;}return result;
  }
  root.AdXlsx={workbook};if(typeof module!=='undefined'&&module.exports)module.exports={workbook};
})(globalThis);
