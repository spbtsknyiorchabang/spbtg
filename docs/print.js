/* Penjana halaman cetakan borang SPBT G (format sama dengan borang Excel asal).
   Susun atur (lebar lajur, tinggi baris, sempadan, gabungan sel, fon) datang daripada template.js. */
(function () {
  const T = window.SPBT_TEMPLATE;
  const PX = 96, A4W = 297 / 25.4 * PX, A4H = 210 / 25.4 * PX;
  const LAYOUT = [
    { start: 24, head: 22, total: 44, name: 'M7', kelas: null, guruKelas: 'A10', tajuk: 'A5', tahunSesi: 'A13', gb: 'D16', gk: 'V16', page: 'Z47' },
    { start: 13, head: 11, total: 33, name: 'J6', kelas: 'A8', tajuk: 'A4', page: 'Y36' }
  ];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const colL = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const bs = b => !b ? '' : (b.s === 'medium' ? '2px solid #000' : b.s === 'thick' ? '3px solid #000' : b.s === 'hair' || b.s === 'dotted' ? '1px dotted #000' : b.s === 'dashed' ? '1px dashed #000' : b.s === 'double' ? '3px double #000' : '1px solid #000');
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  function buildSheet(si, ov, rich) {
    const S = T[si];
    const px = S.widths, W = px.reduce((a, b) => a + b, 0);
    const hpx = S.heights.map(h => h * 96 / 72);
    const H = hpx.reduce((a, b) => a + b, 0);
    let html = `<table class="frm" style="width:${W}px;table-layout:fixed"><colgroup>${px.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;
    let curRow = 0;
    S.cells.forEach(c => {
      if (c.r !== curRow) { if (curRow) html += '</tr>'; html += `<tr style="height:${hpx[c.r - 1]}px">`; curRow = c.r; }
      const o = ov[c.a];
      const f = c.f, al = c.al;
      let st = '';
      ['t', 'l', 'b', 'r'].forEach(k => { const v = bs(c.b[k]); if (v) st += `border-${{ t: 'top', l: 'left', b: 'bottom', r: 'right' }[k]}:${v};`; });
      const fam = f.n === 'Calibri' ? 'Carlito,Calibri,Arial,sans-serif' : f.n === 'Times New Roman' ? '"Times New Roman",serif' : 'Arial,Helvetica,sans-serif';
      let fz = f.z;
      if (o && o.fz) fz = o.fz;
      st += `font:${f.i ? 'italic ' : ''}${f.b ? 'bold ' : ''}${fz}pt ${fam};`;
      if (f.u) st += 'text-decoration:underline;';
      if (c.fill) st += `background:#${c.fill.slice(-6)};`;
      const h = al.h === 'center' ? 'center' : al.h === 'right' ? 'right' : al.h === 'left' ? 'left' : 'left';
      st += `text-align:${(o && o.h) || h};vertical-align:${al.v === 'center' ? 'middle' : al.v === 'top' ? 'top' : 'bottom'};`;
      const rs = c.rs || 1, cs = c.cs || 1;
      let wpx = 0; for (let i = 0; i < cs; i++) wpx += px[c.c - 1 + i];
      let hh = 0; for (let i = 0; i < rs; i++) hh += hpx[c.r - 1 + i];
      let inner = '';
      let val = o && o.text !== undefined ? o.text : c.v;
      if (o && o.html !== undefined) inner = o.html; else if (val !== undefined) inner = esc(val).replace(/\n/g, '<br>');
      let cls = '';
      if (al.rot === 90 && inner) {
        inner = `<div class="vt" style="width:${wpx}px;height:${hh}px"><span style="font-size:${(o && o.fz) || f.z}pt${o && o.same ? ';font-family:Arial,Helvetica,sans-serif;font-weight:400;font-style:normal;-webkit-text-stroke:0' : ''}">${inner}</span></div>`;
        cls = 'rot';
      } else if (!al.w && cs === 1 && inner) { cls = 'ov'; }
      else if (!al.w && inner && (c.v || (o && o.text)) && String(val).length * f.z * 0.55 > wpx) { cls = 'ov'; }
      if (al.w) cls += ' wr';
      html += `<td${rs > 1 ? ` rowspan="${rs}"` : ''}${cs > 1 ? ` colspan="${cs}"` : ''} class="${cls}" style="${st}">${inner}</td>`;
    });
    html += '</tr></table>';
    return { html, W, H, margins: S.margins };
  }

  // ctx: {sekolah, sesi, namaKelas, guruKelas, guruBesar, titles:[{judul}], murid:[{nama,tarikh,recv:Set<bukuId>}]}
  function buildPages(ctx) {
    const pages = [];
    const titles = ctx.titles;
    const chunks = [];
    for (let i = 0; i < Math.max(titles.length, 1); i += 15) chunks.push(titles.slice(i, i + 15));
    let pageNo = 0;
    chunks.forEach(chunk => {
      const nPages = Math.max(1, Math.ceil(ctx.murid.length / 10));
      for (let p = 0; p < nPages; p++) {
        pageNo++;
        const si = p === 0 ? 0 : 1, L = LAYOUT[si];
        const ov = {};
        ov[L.name] = { text: ctx.sekolah, h: 'left' };
        ov[L.tajuk] = { text: si === 0 ? `SKIM PINJAMAN BUKU TEKS ${ctx.sesi}` : `SKIM PINJAMAN BUKU TEKS ${ctx.sesi}` };
        if (si === 0) {
          ov.A10 = { text: `Kepada Guru Kelas : ${ctx.guruKelas || '…………………………….'}` };
          ov.A13 = { text: `Murid-murid yang disenaraikan namanya di bawah ini adalah diluluskan pinjaman buku teks bagi sesi persekolahan tahun ${ctx.sesi}.` };
          ov.D16 = { text: `Nama: ${ctx.guruBesar || ''}` };
          ov.V16 = { text: `Nama Guru Kelas:  ${ctx.guruKelas || '…………………………………………………………………'}` };
          ov.D17 = { text: `Jawatan : Guru Besar ${(ctx.sekolahAsal || '').replace(/^sekolah kebangsaan/i, 'SK')}` };
          ov.Z47 = { text: `Muka surat ${pageNo}` };
        } else {
          ov.A8 = { text: `Nama Kelas: ${ctx.namaKelas}` };
          ov.Y36 = { text: `Muka surat ${pageNo}` };
        }
        // tajuk judul buku
        const fz = 6.5;
        chunk.forEach((b, j) => { ov[colL(3 + j) + L.head] = { text: b.judul, fz: 8, same: true }; });
        const rows = ctx.murid.slice(p * 10, p * 10 + 10);
        const tot = new Array(chunk.length).fill(0); let totAll = 0;
        rows.forEach((m, k) => {
          const r0 = L.start + 2 * k;
          ov['A' + r0] = { text: String(p * 10 + k + 1) };
          ov['B' + r0] = { text: m.nama, fz: 8 };
          let n = 0;
          chunk.forEach((b, j) => { if (m.recv.has(b.id)) { ov[colL(3 + j) + r0] = { text: '√', fz: 9 }; n++; tot[j]++; } });
          chunk.forEach((b, j) => { if (m.tak && m.tak.has(b.id)) ov[colL(3 + j) + r0] = { text: 'O', fz: 9 }; });
          if (n) ov['R' + r0] = { text: String(n), h: 'center' };
          totAll += n;
          if (m.tarikh && n) ov['U' + r0] = { text: fmtDate(m.tarikh), fz: 7 };
        });
        chunk.forEach((b, j) => { if (tot[j]) ov[colL(3 + j) + L.total] = { text: String(tot[j]), h: 'center' }; });
        if (totAll) ov['R' + L.total] = { text: String(totAll), h: 'center' };
        const sh = buildSheet(si, ov);
        const availW = A4W - (sh.margins.l + sh.margins.r) * PX;
        const scale = Math.min(availW / sh.W, (A4H - (sh.margins.t + sh.margins.b) * PX) / sh.H);
        const pg = document.createElement('div');
        pg.className = 'pg';
        pg.innerHTML = `<div class="pgi" style="left:${sh.margins.l * PX / scale}px;top:${sh.margins.t * PX / scale}px;width:${sh.W}px;height:${sh.H}px;zoom:${scale}">${sh.html}</div>`;
        pages.push(pg);
      }
    });
    return pages;
  }
  window.SPBT_PRINT = { buildPages };
})();
