/* Small offline OOXML writer. ZIP entries use storage (no external libraries). */
globalThis.VKXlsx = (() => {
  const encoder = new TextEncoder();
  const xml = value => String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  function column(index) { let s=''; for (index++; index; index=Math.floor((index-1)/26)) s=String.fromCharCode(65+(index-1)%26)+s; return s; }
  function sheet(rows) {
    const textColumn=rows[0].indexOf('text')+1;
    const columns=textColumn?`<col min="1" max="${textColumn-1}" width="25" customWidth="1"/><col min="${textColumn}" max="${textColumn}" width="80" customWidth="1"/><col min="${textColumn+1}" max="${Math.max(textColumn+1,rows[0].length)}" width="26" customWidth="1"/>`:'<col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="110" customWidth="1"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>'+columns+'</cols><sheetData>' +
      rows.map((row,i) => '<row r="'+(i+1)+'">'+row.map((v,j) => {
        const ref=column(j)+(i+1);
        if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
        if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v?1:0}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v??'').slice(0,32767))}</t></is></c>`;
      }).join('')+'</row>').join('') + '</sheetData></worksheet>';
  }
  const crcTable = Array.from({length:256}, (_,i) => { let c=i; for(let b=0;b<8;b++) c=c&1 ? 0xedb88320^(c>>>1) : c>>>1; return c>>>0; });
  function crc(data) { let c=0xffffffff; for(const byte of data) c=crcTable[(c^byte)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
  function concat(parts) { const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let at=0; for(const p of parts){result.set(p,at);at+=p.length;} return result; }
  function header(size, values) { const data=new Uint8Array(size), view=new DataView(data.buffer); for(const [offset,value,width] of values) width===2?view.setUint16(offset,value,true):view.setUint32(offset,value,true); return data; }
  function zip(files) {
    const local=[], central=[]; let offset=0;
    for(const [filename,text] of Object.entries(files)) {
      const name=encoder.encode(filename), data=encoder.encode(text), checksum=crc(data);
      const h=header(30,[[0,0x04034b50,4],[4,20,2],[6,0x800,2],[14,checksum,4],[18,data.length,4],[22,data.length,4],[26,name.length,2]]);
      local.push(h,name,data);
      const c=header(46,[[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[16,checksum,4],[20,data.length,4],[24,data.length,4],[28,name.length,2],[42,offset,4]]);
      central.push(c,name); offset+=h.length+name.length+data.length;
    }
    const directory=concat(central), count=Object.keys(files).length;
    const end=header(22,[[0,0x06054b50,4],[8,count,2],[10,count,2],[12,directory.length,4],[16,offset,4]]);
    return concat([...local,directory,end]);
  }
  function create(fields, records, report) {
    const files={
      '[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Комментарии" sheetId="1" r:id="rId1"/><sheet name="Отчёт" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': sheet([fields,...records.map(r=>fields.map(k=>r[k]))]),
      'xl/worksheets/sheet2.xml': sheet([['Поле','Значение'],...Object.entries(report||{}).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):v])])
    };
    return zip(files);
  }
  return { create };
})();
