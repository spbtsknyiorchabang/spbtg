/* Muat turun borang SPBT G dalam format xlsx (templat asal diisi dalam pelayar). */
(function () {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const colN = s => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const parse = x => new DOMParser().parseFromString(x, 'application/xml');
  const out = d => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new XMLSerializer().serializeToString(d.documentElement);

  function cellOf(doc, rows, ref) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) return null;
    let row = rows[m[2]];
    if (!row) {
      row = doc.createElementNS(NS, 'row'); row.setAttribute('r', m[2]);
      const sd = doc.getElementsByTagNameNS(NS, 'sheetData')[0]; let before = null;
      for (const r of sd.children) if (+r.getAttribute('r') > +m[2]) { before = r; break; }
      sd.insertBefore(row, before); rows[m[2]] = row;
    }
    for (const e of row.children) if (e.getAttribute('r') === ref) return e;
    const n = doc.createElementNS(NS, 'c'); n.setAttribute('r', ref); let before = null;
    for (const e of row.children) if (colN(/[A-Z]+/.exec(e.getAttribute('r'))[0]) > colN(m[1])) { before = e; break; }
    row.insertBefore(n, before); return n;
  }
  function setVal(doc, c, text) {
    Array.from(c.children).forEach(ch => c.removeChild(ch)); c.removeAttribute('t');
    if (text === '' || text === null || text === undefined) return;
    text = String(text);
    if (/^\d{1,9}$/.test(text)) { const v = doc.createElementNS(NS, 'v'); v.textContent = text; c.appendChild(v); return; }
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(NS, 'is'), t = doc.createElementNS(NS, 't'); t.textContent = text;
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); is.appendChild(t); c.appendChild(is);
  }

  async function make(ctx) {
    if (typeof JSZip === 'undefined') throw new Error('Pustaka ZIP tidak dimuatkan');
    const specs = []; window.SPBT_PRINT.buildPages(Object.assign({}, ctx, { collect: specs, specOnly: true }));
    const zip = await JSZip.loadAsync(window.SPBT_XLSX_TPL, { base64: true });
    const src = [await zip.file('xl/worksheets/sheet1.xml').async('string'), await zip.file('xl/worksheets/sheet2.xml').async('string')];
    // gaya tajuk buku: font sama seperti nama murid (tidak bold)
    const sd = parse(await zip.file('xl/styles.xml').async('string'));
    const fonts = sd.getElementsByTagNameNS(NS, 'fonts')[0], xfs = sd.getElementsByTagNameNS(NS, 'cellXfs')[0], cache = {};
    function plain(s) {
      s = +s || 0; if (cache[s] !== undefined) return cache[s];
      const xf = xfs.children[s].cloneNode(true), f = fonts.children[+xf.getAttribute('fontId') || 0].cloneNode(true);
      Array.from(f.children).forEach(ch => { if (ch.localName === 'b') f.removeChild(ch); });
      fonts.appendChild(f); fonts.setAttribute('count', fonts.children.length);
      xf.setAttribute('fontId', fonts.children.length - 1); xf.setAttribute('applyFont', '1');
      xfs.appendChild(xf); xfs.setAttribute('count', xfs.children.length); return cache[s] = xfs.children.length - 1;
    }
    const wb = parse(await zip.file('xl/workbook.xml').async('string')), rels = parse(await zip.file('xl/_rels/workbook.xml.rels').async('string')), ct = parse(await zip.file('[Content_Types].xml').async('string'));
    const sheets = wb.getElementsByTagNameNS(NS, 'sheets')[0]; Array.from(sheets.children).forEach(x => sheets.removeChild(x));
    Array.from(rels.documentElement.children).forEach(r => { if (/worksheets\/sheet[12]\.xml$/.test(r.getAttribute('Target'))) rels.documentElement.removeChild(r); });
    Array.from(ct.documentElement.children).forEach(r => { if (/\/worksheets\/sheet[12]\.xml$/.test(r.getAttribute('PartName') || '')) ct.documentElement.removeChild(r); });
    zip.remove('xl/worksheets/sheet1.xml'); zip.remove('xl/worksheets/sheet2.xml');
    specs.forEach((sp, i) => {
      const doc = parse(src[sp.si]), rows = {};
      Array.from(doc.getElementsByTagNameNS(NS, 'row')).forEach(r => rows[r.getAttribute('r')] = r);
      Array.from(doc.getElementsByTagNameNS(NS, 'sheetView')).forEach(v => v.removeAttribute('tabSelected'));
      if (i === 0) Array.from(doc.getElementsByTagNameNS(NS, 'sheetView')).forEach(v => v.setAttribute('tabSelected', '1'));
      Object.keys(sp.ov).forEach(ref => {
        const o = sp.ov[ref], c = cellOf(doc, rows, ref); if (!c) return;
        let text = o.text; if (text === undefined && o.html !== undefined) text = String(o.html).replace(/<[^>]+>/g, '');
        if (o.same) c.setAttribute('s', plain(c.getAttribute('s')));
        setVal(doc, c, text);
      });
      const n = 10 + i, name = 'Muka ' + (i + 1);
      zip.file(`xl/worksheets/sheet${n}.xml`, out(doc));
      const sh = wb.createElementNS(NS, 'sheet'); sh.setAttribute('name', name); sh.setAttribute('sheetId', String(n));
      sh.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r:id', 'rIdS' + n); sheets.appendChild(sh);
      const rl = rels.createElementNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship');
      rl.setAttribute('Id', 'rIdS' + n); rl.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'); rl.setAttribute('Target', `worksheets/sheet${n}.xml`); rels.documentElement.appendChild(rl);
      const ov = ct.createElementNS('http://schemas.openxmlformats.org/package/2006/content-types', 'Override');
      ov.setAttribute('PartName', `/xl/worksheets/sheet${n}.xml`); ov.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'); ct.documentElement.appendChild(ov);
    });
    zip.file('xl/workbook.xml', out(wb)); zip.file('xl/_rels/workbook.xml.rels', out(rels)); zip.file('[Content_Types].xml', out(ct)); zip.file('xl/styles.xml', out(sd));
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
  window.SPBT_XLSX = { make };
})();
