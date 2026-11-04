(function(root){
  'use strict';
  const EXTRA=['Sıra (gösterim sıralaması)','Parça (tarih aralığı)'];
  function prepare(ads,chunked=false,now=new Date()){
    const rows=root.AdData.rows(ads,now);
    if(!chunked)return {rows,columns:root.AdData.COLUMNS,extraColumns:[]};
    const metadata=new Map(ads.map(ad=>[String(ad.libraryId||ad.id),ad]));
    return {rows:rows.map(row=>{const ad=metadata.get(row['Reklam ID']);return {...row,[EXTRA[0]]:Number.isInteger(ad?.chunkRank)?ad.chunkRank:'',[EXTRA[1]]:ad?.chunkPiece||''};}),columns:[...root.AdData.COLUMNS,...EXTRA],extraColumns:EXTRA};
  }
  function csv(rows){
    const columns=[...root.AdData.COLUMNS,...EXTRA];
    // Match the existing CSV escaping/BOM/formula protection for the extended schema.
    const quote=value=>{let text=String(value??'');if(/^(?:\s*[=+\-@]|[\t\r])/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
    return '\uFEFF'+[columns.map(quote).join(','),...rows.map(row=>columns.map(column=>quote(row[column])).join(','))].join('\r\n');
  }
  const api={EXTRA,prepare,csv};root.ChunkExport=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
