(function(root){
  'use strict';
  const xml=(value)=>String(value??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  function workbook(_columns,records,options={}){
    const columns=root.AdData.EXCEL_COLUMNS;
    records=[...records].sort((a,b)=>(b['Yaş (gün)']===''?-Infinity:b['Yaş (gün)'])-(a['Yaş (gün)']===''?-Infinity:a['Yaş (gün)']));
    if(records.length>1048575||records.some(row=>columns.some(column=>String(row[column]??'').length>32767)))throw new Error('Excel hücre/satır sınırı aşıldı. Tam veri için CSV veya JSON kullan.');
    const cell=(value,col,row,style)=>typeof value==='number'?`<c r="${col}${row}" s="${style}"><v>${value}</v></c>`:`<c r="${col}${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    const widths=[23,30,65,42,20,13,29,16,55,30,55];
    const sheetRows=[columns,...records.map(record=>columns.map(column=>record[column]))];
    const data=sheetRows.map((row,index)=>`<row r="${index+1}">${row.map((value,j)=>{
      const group=j===6?root.AdData.GROUPS.indexOf(value):-1;
      return cell(value,String.fromCharCode(65+j),index+1,index===0?1:j===0?2:j===2?3:group>=0?4+group:0);
    }).join('')}</row>`).join('');
    const summary=root.AdData.summary(records,options.searchName||'Meta Ad Library');
    const overview=[{values:['Arama adı',summary.searchName],style:8},{values:['Toplam reklam sayısı',summary.total],style:8}];
    function table(title,headers,rows){overview.push({values:[]},{values:[title],style:8},{values:headers,style:1},...rows.map(values=>({values})));}
    table('Durum grupları',['Durum','Reklam Sayısı'],summary.status);
    table('Medya türü dağılımı',['Medya Türü','Reklam Sayısı'],summary.media);
    table('Reklam verenler',['Reklam Veren','Reklam Sayısı','En Uzun Yayın (gün)','Ort. Yaş (gün)','30+ Gün Reklam'],summary.advertisers);
    table('En çok kullanılan 8 CTA',['CTA','Adet'],summary.ctas);
    table('Tekrar eden hook kalıpları',['İlk 3 Kelime','Adet','Örnek Hook'],summary.patterns);
    const summaryData=overview.map((row,index)=>`<row r="${index+1}">${row.values.map((value,j)=>cell(value,String.fromCharCode(65+j),index+1,row.style??(j===2?3:0))).join('')}</row>`).join('');
    const cols=values=>'<cols>'+values.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')+'</cols>';
    const mainSheet=`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>${cols(widths)}<sheetData>${data}</sheetData><autoFilter ref="A1:K${records.length+1}"/></worksheet>`;
    const overviewSheet=`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews>${cols([43,28,65,22,25])}<sheetData>${summaryData}</sheetData></worksheet>`;
    const fills=['<patternFill patternType="none"/>','<patternFill patternType="gray125"/>',...['163A70','E2EFDA','E7E6E6','D9EAF7','FFF2CC'].map(color=>`<patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill>`)];
    const xf=(font=0,fill=0,format=0,alignment='')=>`<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"${alignment?' applyAlignment="1"':''}>${alignment}</xf>`;
    const styles=`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="7">${fills.map(fill=>'<fill>'+fill+'</fill>').join('')}</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="9">${xf()}${xf(2,2)}${xf(0,0,49)}${xf(0,0,0,'<alignment wrapText="1" vertical="top"/>')}${[3,4,5,6].map(fill=>xf(0,fill)).join('')}${xf(1)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const files={
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+[1,2].map(i=>`<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Reklamlar" sheetId="1" r:id="rId1"/><sheet name="Özet" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+[1,2].map(i=>`<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')+'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml':styles,'xl/worksheets/sheet1.xml':mainSheet,'xl/worksheets/sheet2.xml':overviewSheet
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
