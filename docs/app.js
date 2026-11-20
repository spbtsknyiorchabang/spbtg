(function () {
'use strict';
const CFG = window.SPBT_CONFIG;
const BELL='<svg class="bell" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* ---------- Nama: huruf besar di depan perkataan, bin/binti huruf kecil ---------- */
function tc(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).map(w => {
    const l = w.toLowerCase();
    if (l === 'bin' || l === 'binti') return l;
    return l.replace(/(^|[-.])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }).join(' ');
}
const genderOf = n => / bin /i.test(' ' + n + ' ') ? 'Lelaki' : / binti /i.test(' ' + n + ' ') ? 'Perempuan' : '';

/* ---------- API Supabase (REST) ---------- */
async function api(path, o = {}) {
  const r = await fetch(`${CFG.url}/rest/v1/${path}`, {
    method: o.method || 'GET',
    headers: Object.assign({ apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, 'Content-Type': 'application/json' }, o.headers || {}),
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined
  });
  if (!r.ok) { let t = ''; try { t = (await r.json()).message; } catch (e) { } throw new Error(t || ('Ralat ' + r.status)); }
  const tx = await r.text(); return tx ? JSON.parse(tx) : null;
}
async function all(table, query = '') {
  const out = []; let from = 0; const step = 1000;
  for (;;) {
    const r = await fetch(`${CFG.url}/rest/v1/${table}?${query}`, { headers: { apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, Range: `${from}-${from + step - 1}`, 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error('Gagal memuat ' + table);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < step) break; from += step;
  }
  return out;
}
const upsert = (table, rows, conflict) => api(`${table}?on_conflict=${conflict}`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: rows });

/* ---------- Keadaan ---------- */
const S = { cfg: {}, guru: [], buku: [], kelas: [], murid: [], terima: new Map() };
let W = null;          // salinan kerja kelas yang dibuka
let dirty = false;
let view = 'home';
const bukuBy = id => S.buku.find(b => b.id === id);
const k2 = (m, b) => m + '|' + b;

async function loadAll() {
  const [tet, guru, buku, kelas, murid, terima] = await Promise.all([
    all('spbt_tetapan', 'select=*'), all('spbt_guru', 'select=*&order=nama'), all('spbt_buku', 'select=*&order=tahun,susunan'),
    all('spbt_kelas', 'select=*&order=susunan'), all('spbt_murid', 'select=*&order=kelas_id,susunan'), all('spbt_terima', 'select=*&order=murid_id,buku_id')
  ]);
  S.cfg = Object.fromEntries(tet.map(t => [t.kunci, t.nilai]));
  S.guru = guru; S.buku = buku; S.kelas = kelas; S.murid = murid;
  S.terima = new Map(terima.map(t => [k2(t.murid_id, t.buku_id), t.status]));
}

/* ---------- Statistik ---------- */
function stats(kelas, murid, terima) {
  const ids = (kelas.buku_ids || []).filter(id => bukuBy(id));
  const per = ids.map(id => {
    let t = 0, x = 0; murid.forEach(m => { const s = terima.get(k2(m.id, id)); if (s === 'T') t++; else if (s === 'X') x++; });
    return { id, terima: t, na: 0, tak: x, kurang: murid.length - t };
  });
  const miss = [];
  murid.forEach(m => { let n = 0; ids.forEach(id => { if (terima.get(k2(m.id, id)) !== 'T') n++; }); if (n) miss.push({ m, n }); });
  const slots = murid.length * ids.length, na = per.reduce((a, p) => a + p.na, 0), got = per.reduce((a, p) => a + p.terima, 0);
  const need = slots - na;
  return { ids, per, miss, pct: need > 0 ? Math.round(got * 100 / need) : 0, kurang: per.reduce((a, p) => a + p.kurang, 0) };
}
const muridOf = kid => S.murid.filter(m => m.kelas_id === kid).sort((a, b) => a.susunan - b.susunan);
const kelasStats = k => stats(k, muridOf(k.id), S.terima);

/* ---------- Bunyi & tema ---------- */
const Snd = {
  lv: localStorage.getItem('spbt_snd') || 'mid', muted: localStorage.getItem('spbt_mute') === '1', ctx: null, pend: false,
  vol: { low: 0.04, mid: 0.16, high: 0.5 },
  ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } return this.ctx; },
  tone(f, t0, d, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.start(t0); o.stop(t0 + d + 0.05);
  },
  chime(force) {
    if (this.muted && !force) return;
    const c = this.ensure(); if (!c) return;
    if (c.state !== 'running') { c.resume && c.resume(); if (c.state !== 'running') { this.pend = true; return; } }
    const v = this.vol[this.lv], t = c.currentTime + 0.02;
    this.tone(880, t, 0.28, v); this.tone(660, t + 0.22, 0.4, v);
  },
  ui() {
    $('#sndMute').textContent = this.muted ? '🔇' : '🔊'; $('#snd').classList.toggle('mute', this.muted);
    document.querySelectorAll('#sndSeg button').forEach(b => b.classList.toggle('on', b.dataset.lv === this.lv));
  }
};
document.addEventListener('pointerdown', () => { if (Snd.pend) { Snd.pend = false; Snd.chime(); } else if (Snd.ctx && Snd.ctx.state === 'suspended') Snd.ctx.resume(); }, { capture: true });
$('#sndMute').onclick = () => { Snd.muted = !Snd.muted; localStorage.setItem('spbt_mute', Snd.muted ? '1' : '0'); Snd.ui(); if (!Snd.muted) Snd.chime(); };
$('#sndSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; Snd.lv = b.dataset.lv; localStorage.setItem('spbt_snd', Snd.lv); Snd.muted = false; localStorage.setItem('spbt_mute', '0'); Snd.ui(); Snd.chime(true); };
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('spbt_theme', t); } catch (e) { } document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.th === t)); }
$('#themeSeg').onclick = e => { const b = e.target.closest('button'); if (b) setTheme(b.dataset.th); };
setTheme(document.documentElement.dataset.theme || 'soft'); Snd.ui();

/* ---------- Utiliti UI ---------- */
function toast(msg, type = '', ms = 4200) {
  const d = document.createElement('div'); d.className = 'toast ' + type; d.innerHTML = msg; d.onclick = () => d.remove(); $('#toasts').appendChild(d);
  setTimeout(() => d.remove(), ms);
}
const dlg = $('#dlg');
function modal(title, body, buttons) {
  return new Promise(res => {
    dlg.innerHTML = `<div class="dh">${title}</div><div class="db">${body}</div><div class="df">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}</div>`;
    const done = v => { dlg.close(); res(v); };
    dlg.onclick = e => { const b = e.target.closest('.df button'); if (!b) return; const x = buttons[+b.dataset.i]; if (x.get) { const v = x.get(dlg); if (v === false) return; done(v); } else done(x.value); };
    dlg.oncancel = () => res(null);
    dlg.showModal();
    const f = dlg.querySelector('input,select'); if (f) f.focus();
  });
}
const confirmBox = (title, text, ok = 'Teruskan', dan = false) => modal(title, `<div>${text}</div>`, [{ label: 'Batal', value: false }, { label: ok, cls: dan ? 'dan' : 'pri', value: true }]);
let asT = null, saving = false, again = false;
function setDirty(v) { dirty = v; clearTimeout(asT); if (v && W) asT = setTimeout(() => saveClass(true), 1200); const c = $('#dirtyChip'); if (c) { c.hidden = true; } const b = $('#btnSave'); if (b) b.classList.toggle('pri', v); }
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Navigasi ---------- */
async function go(v, arg) {
  if (dirty && W) { clearTimeout(asT); await saveClass(true); }
  if (dirty && !(await confirmBox('Perubahan belum disimpan', 'Anda ada perubahan yang belum disimpan pada kelas ini. Tinggalkan halaman tanpa menyimpan?', 'Tinggalkan', true))) return;
  setDirty(false); W = null; view = v;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.go === (v === 'kelas' ? 'home' : v)));
  window.scrollTo(0, 0);
  if (v === 'home') renderHome(false); else if (v === 'rumusan') renderRumusan(); else if (v === 'tetapan') renderTetapan(); else if (v === 'kelas') await openClass(arg);
}
$('#nav').onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.go); };

function brand() { $('#brandTitle').textContent = `SPBT G ${S.cfg.sesi || ''}`; $('#brandSub').textContent = S.cfg.nama_sekolah || ''; document.title = `SPBT G ${S.cfg.sesi || ''} – ${S.cfg.nama_sekolah || ''}`; }

/* ---------- Halaman utama ---------- */
function renderHome(playSound = true) {
  brand();
  const per = S.kelas.map(k => ({ k, st: kelasStats(k), n: muridOf(k.id).length }));
  const totM = per.reduce((a, p) => a + p.n, 0);
  const missM = per.reduce((a, p) => a + p.st.miss.length, 0), missK = per.filter(p => p.st.miss.length).length;
  const withBooks = per.filter(p => p.n && p.st.ids.length);
  const done = withBooks.filter(p => !p.st.miss.length).length;
  let h = `<h1>Pengagihan Buku Teks ${esc(S.cfg.sesi || '')}</h1><div class="sub">Pilih kelas, kemudian klik petak judul buku bagi murid yang telah menerima buku.</div><div style="margin:10px 0"><button class="btn" id="btnAllX">⬇ Muat turun semua borang (ZIP xlsx)</button></div>`;
  h += `<div class="stats"><div class="card stat"><b>${totM}</b><span>Jumlah murid</span></div><div class="card stat"><b>${S.kelas.length}</b><span>Jumlah kelas</span></div>
  <div class="card stat ok"><b>${done}/${withBooks.length}</b><span>Kelas lengkap</span></div><div class="card stat ${missM ? 'wn' : 'ok'}"><b>${missM}</b><span>Murid belum terima buku lengkap</span></div></div>`;
  if (missM) h += `<div class="alertbar" role="alert"><span class="dot"></span><div><b>${missM} murid</b> di <b>${missK} kelas</b> belum menerima semua buku. Buka kelas berkenaan untuk melihat senarai nama dan buku yang kurang. <a href="#" id="lnkRum" style="color:var(--ac);font-weight:600">Lihat rumusan</a></div></div>`;
  for (let t = 1; t <= 6; t++) {
    const ks = per.filter(p => p.k.tahun === t);
    h += `<div class="tahun"><h2>Tahun ${t}</h2><div class="ln"></div><button class="btn sm" data-addk="${t}">+ Tambah kelas</button></div><div class="grid">`;
    ks.forEach(({ k, st, n }) => {
      const chip = !n ? `<span class="chip mu">Tiada murid</span>` : !st.ids.length ? `<span class="chip er">Judul buku belum dipilih</span>`
        : st.miss.length ? `<span class="chip wn">${BELL} ${st.miss.length} murid belum terima buku</span>` : `<span class="chip ok">✓ Semua murid lengkap</span>`;
      h += `<button class="card kc" data-k="${k.id}"><div class="nm">${esc(k.nama)}</div><div class="gu">${k.guru_kelas ? esc(k.guru_kelas) : 'Guru kelas belum dipilih'}</div>
      <div class="bar"><i style="width:${st.pct}%"></i></div><div class="meta"><span>${n} murid · ${st.ids.length} judul</span><span>${st.pct}%</span></div>${chip}</button>`;
    });
    if (!ks.length) h += `<div class="sub" style="padding:8px 2px">Tiada kelas.</div>`;
    h += `</div>`;
  }
  $('#main').innerHTML = h;
  if (missM && playSound) { toast(`${BELL} <b>${missM} murid</b> belum menerima buku lengkap`, 'wn'); Snd.chime(); }
}
$('#main').addEventListener('click', e => {
  const k = e.target.closest('[data-k]'); if (k && view === 'home') return go('kelas', k.dataset.k);
  const a = e.target.closest('[data-addk]'); if (a) return addKelas(+a.dataset.addk);
  if (e.target.closest('#btnAllX')) { downloadAllXlsx(); return; }
  if (e.target.id === 'lnkRum') { e.preventDefault(); go('rumusan'); }
});
async function addKelas(tahun) {
  const nama = await modal(`Tambah kelas Tahun ${tahun}`, `<label class="f">Nama kelas<input type="text" id="nk" value="${tahun} " autocomplete="off"></label><div class="sub">Judul buku Tahun ${tahun} dipilih secara automatik.</div>`,
    [{ label: 'Batal', value: null }, { label: 'Tambah', cls: 'pri', get: d => { const v = tc(d.querySelector('#nk').value); if (!v) return false; return v; } }]);
  if (!nama) return;
  const row = { id: uid(), tahun, nama, guru_kelas: '', penolong: '', tarikh_agih: null, buku_ids: S.buku.filter(b => b.tahun === tahun).map(b => b.id), susunan: tahun * 10 + S.kelas.filter(k => k.tahun === tahun).length };
  try { await api('spbt_kelas', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: row }); S.kelas.push(row); S.kelas.sort((a, b) => a.susunan - b.susunan); renderHome(false); toast('Kelas ditambah', 'ok'); } catch (e) { toast('Gagal: ' + esc(e.message), 'er'); }
}

/* ---------- Halaman kelas ---------- */
async function openClass(id) {
  $('#main').innerHTML = '<div class="loading">Memuatkan kelas…</div>';
  try {
    const [kr, mr] = await Promise.all([api(`spbt_kelas?id=eq.${id}&select=*`), api(`spbt_murid?kelas_id=eq.${id}&select=*&order=susunan`)]);
    if (!kr.length) { toast('Kelas tidak dijumpai', 'er'); return go('home'); }
    const ids = mr.map(m => m.id);
    const tr = ids.length ? await all('spbt_terima', `select=*&murid_id=in.(${ids.join(',')})`) : [];
    const i = S.kelas.findIndex(k => k.id === id); if (i >= 0) S.kelas[i] = kr[0]; else S.kelas.push(kr[0]);
    S.murid = S.murid.filter(m => m.kelas_id !== id).concat(mr);
    ids.forEach(mid => S.buku.forEach(b => S.terima.delete(k2(mid, b.id)))); tr.forEach(t => S.terima.set(k2(t.murid_id, t.buku_id), t.status));
  } catch (e) { toast('Gagal memuatkan: ' + esc(e.message), 'er'); return go('home'); }
  const k = S.kelas.find(x => x.id === id);
  W = { kelas: JSON.parse(JSON.stringify(k)), murid: muridOf(id).map(m => ({ ...m })), terima: new Map() };
  W.murid.forEach(m => S.buku.forEach(b => { const s = S.terima.get(k2(m.id, b.id)); if (s) W.terima.set(k2(m.id, b.id), s); }));
  renderClass(); setDirty(false);
  const st = stats(W.kelas, W.murid, W.terima);
}
function guruSelect(id, val) {
  const names = [...new Set([...S.guru.map(g => g.nama), ...(val ? [val] : [])])].sort((a, b) => a.localeCompare(b));
  return `<select id="${id}"><option value="">— Pilih —</option>${names.map(n => `<option ${n === val ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__lain">✎ Lain-lain (taip sendiri)…</option></select>`;
}
function renderClass() {
  brand();
  const k = W.kelas;
  let h = `<div class="hd"><div><button class="btn sm" id="btnBack">← Semua kelas</button></div><div class="spacer"></div>
  <span class="chip dirty" id="dirtyChip" hidden>● Belum disimpan</span>
  <button class="btn" id="btnTitles">Pilih judul buku</button><button class="btn" id="btnAdd">+ Tambah murid</button><button class="btn" id="btnPrint">🖨 Cetak</button><button class="btn" id="btnXlsx">⬇ Muat turun xlsx</button><button class="btn" id="btnSave">💾 Simpan</button></div>
  <h1>${esc(k.nama)} <button class="ib" id="btnRen" title="Tukar nama kelas">✎</button></h1><div class="sub">Tahun ${k.tahun} · ${W.murid.length} murid · ${(k.buku_ids || []).filter(bukuBy).length} judul buku</div>
  <div class="card meta" style="margin-top:14px"><label class="f">Guru kelas${guruSelect('gk', k.guru_kelas)}</label><label class="f">Penolong guru kelas${guruSelect('gp', k.penolong)}</label>
  <label class="f">Tarikh pengagihan (lalai tarikh murid menerima)<input type="date" id="tg" value="${k.tarikh_agih || ''}"></label></div>
  <div id="warnBox"></div>
  <div class="legend"><span><b style="background:var(--ok2);color:var(--ok)">✓</b>Terima (klik sekali; klik lagi untuk batal)</span><span><b style="background:var(--wn2);color:var(--wn)">✗</b>Tak dapat (guna butang pada Ikut buku / Ikut murid)</span><span>Klik tajuk buku untuk tindakan seluruh lajur</span></div>
  <div class="tabs" id="tabs"></div><div id="vw"></div>`;
  $('#main').innerHTML = h;
  renderTable(); renderWarn();
  $('#btnBack').onclick = () => go('home'); $('#btnSave').onclick = saveClass; $('#btnPrint').onclick = printClass; $('#btnXlsx').onclick = downloadXlsx;
  $('#btnAdd').onclick = () => editMurid(); $('#btnTitles').onclick = pickTitles; $('#btnRen').onclick = renameKelas;
  [['gk', 'guru_kelas'], ['gp', 'penolong']].forEach(([i, f]) => {
    const sel = $('#' + i);
    sel.onchange = async () => {
      if (sel.value !== '__lain') { W.kelas[f] = sel.value; setDirty(true); return; }
      const v = await modal('Nama guru', '<label class="f">Taip nama guru<input type="text" id="gn" autocomplete="off"></label><div class="sub">Huruf besar di depan setiap perkataan; bin/binti huruf kecil.</div>', [{ label: 'Batal', value: null }, { label: 'Guna', cls: 'pri', get: d => tc(d.querySelector('#gn').value) || false }]);
      if (v) { W.kelas[f] = v; setDirty(true); renderClass(); } else sel.value = W.kelas[f] || '';
    };
  });
  $('#tg').onchange = e => { W.kelas.tarikh_agih = e.target.value || null; setDirty(true); };
  setDirty(dirty);
}
function renderWarn() {
  const st = stats(W.kelas, W.murid, W.terima), box = $('#warnBox'); if (!box) return;
  if (!W.murid.length) box.innerHTML = '';
  else if (!st.ids.length) box.innerHTML = `<div class="warn">Judul buku belum dipilih untuk kelas ini. Klik <b>Pilih judul buku</b>.</div>`;
  else if (st.miss.length) box.innerHTML = `<div class="warn" role="alert"><b>${BELL} ${st.miss.length} murid belum menerima semua buku.</b> <a href="#" id="lnkLst" style="color:var(--ac);font-weight:600">${W.showMiss ? 'Sembunyi senarai' : 'Lihat senarai'}</a>
    ${W.showMiss ? `<div class="lst">${st.miss.map(x => `<span>${esc(x.m.nama)} · kurang ${x.n}</span>`).join('')}</div>` : ''}</div>`;
  else box.innerHTML = `<div class="warn ok">✓ Semua murid telah menerima buku lengkap.</div>`;
  const a = $('#lnkLst'); if (a) a.onclick = e => { e.preventDefault(); W.showMiss = !W.showMiss; renderWarn(); };
}
function renderMatrix() {
  const st = stats(W.kelas, W.murid, W.terima), ids = st.ids, missSet = new Set(st.miss.map(x => x.m.id));
  let h = `<table class="t"><thead><tr><th class="no">No</th><th class="nm">Nama murid</th><th class="dt">Tarikh terima</th>${ids.map(id => { const b = bukuBy(id); return `<th class="bk" data-col="${id}" title="${esc(b.judul)}"><div class="vt">${esc(b.judul)}</div></th>`; }).join('')}<th>Jum.</th><th></th></tr></thead><tbody>`;
  W.murid.forEach((m, i) => {
    let n = 0; const cells = ids.map(id => { const s = W.terima.get(k2(m.id, id)); if (s === 'T') n++; return `<td class="c ${s === 'T' ? 't' : s === 'X' ? 'x' : ''}" data-m="${m.id}" data-b="${id}">${s === 'T' ? '✓' : s === 'X' ? '✗' : ''}</td>`; }).join('');
    h += `<tr data-row="${m.id}" class="${missSet.has(m.id) ? 'miss' : ''}"><td class="no">${i + 1}</td><td class="nm">${esc(m.nama)}<small>${esc(m.jantina)}${m.nota ? ' · ' + esc(m.nota) : ''}</small></td>
    <td class="dt"><input type="date" data-dt="${m.id}" value="${m.tarikh_terima || ''}"></td>${cells}<td class="jm">${n}</td>
    <td class="ac"><button class="ib" data-all="${m.id}" title="Tandakan semua buku diterima">✓ semua</button><button class="ib" data-ed="${m.id}" title="Sunting">✎</button><button class="ib" data-del="${m.id}" title="Murid telah berpindah">🗑</button></td></tr>`;
  });
  h += `</tbody><tfoot><tr><td class="lb" colspan="3">Terima</td>${st.per.map(p => `<td>${p.terima}</td>`).join('')}<td>${st.per.reduce((a, p) => a + p.terima, 0)}</td><td></td></tr>
  <tr><td class="lb" colspan="3">Kurang</td>${st.per.map(p => `<td class="${p.kurang ? 'neg' : ''}">${p.kurang}</td>`).join('')}<td class="${st.kurang ? 'neg' : ''}">${st.kurang}</td><td></td></tr></tfoot></table>`;
  if (!W.murid.length) h = `<div style="padding:40px;text-align:center" class="sub">Belum ada murid dalam kelas ini. Klik <b>+ Tambah murid</b>.</div>`;
  const old = $('#tw'), sl = old ? old.scrollLeft : 0, stp = old ? old.scrollTop : 0; $('#vw').innerHTML = `<div class="tw card" id="tw">${h}</div>`; const tw = $('#tw'); tw.scrollLeft = sl; tw.scrollTop = stp;
}
function cellOf(mid, bid) { return W.terima.get(k2(mid, bid)) || ''; }
function setCell(mid, bid, v) {
  const key = k2(mid, bid), m = W.murid.find(x => x.id === mid);
  if (v) { W.terima.set(key, v); if (v === 'T' && !m.tarikh_terima) m.tarikh_terima = W.kelas.tarikh_agih || today(); } else W.terima.delete(key);
  setDirty(true);
}
function rowHtml(attr, label, no, s, extra) {
  return `<div class="trow ${s === 'T' ? 'on' : s === 'X' ? 'na' : ''}" ${attr}>${no ? `<span class="no">${no}</span>` : ''}<span class="nm">${label}</span><span class="box">${s === 'T' ? '✓' : s === 'X' ? '✗' : ''}</span><button class="xb" ${extra}>${s === 'X' ? 'Buang tanda' : 'Tak dapat'}</button></div>`;
}
function renderTabs() {
  const tb = [['buku', 'Ikut buku'], ['murid', 'Ikut murid'], ['jadual', 'Jadual']];
  $('#tabs').innerHTML = tb.map(([k, l]) => `<button data-tab="${k}" class="${W.tab === k ? 'on' : ''}">${l}</button>`).join('');
}
function renderByBook() {
  const ids = (W.kelas.buku_ids || []).filter(bukuBy); if (!ids.length) { $('#vw').innerHTML = '<div class="card sub" style="padding:30px;text-align:center">Judul buku belum dipilih. Klik <b>Pilih judul buku</b>.</div>'; return; }
  if (!ids.includes(W.book)) W.book = ids[0];
  const cnt = id => W.murid.filter(m => cellOf(m.id, id) === 'T').length, N = W.murid.length;
  let h = `<div class="sub" style="margin:0 2px 6px">${ids.length} judul buku · tekan satu untuk isi</div><div class="chips">${ids.map(id => `<button class="chip ${id === W.book ? 'on' : ''}" data-chip="${id}">${esc(bukuBy(id).judul)}<small>${cnt(id)}/${N}</small></button>`).join('')}</div>
  <div class="tbar"><span class="cnt"><b>${cnt(W.book)}</b> / ${N} murid menerima</span><span class="sp"></span><button class="btn sm" data-bulk="T">Tanda semua</button><button class="btn sm" data-bulk="">Kosongkan</button></div>`;
  if (!N) h += '<div class="card sub" style="padding:30px;text-align:center">Belum ada murid. Klik <b>+ Tambah murid</b>.</div>';
  W.murid.forEach((m, i) => { h += rowHtml(`data-tap="${m.id}:${W.book}"`, esc(m.nama), i + 1, cellOf(m.id, W.book), `data-xna="${m.id}:${W.book}"`); });
  const ch = $('#vw .chips'), sl = ch ? ch.scrollLeft : 0; $('#vw').innerHTML = h; const c2 = $('#vw .chips'); if (c2) { c2.scrollLeft = sl; const on = c2.querySelector('.chip.on'); if (on && (on.offsetLeft < c2.scrollLeft || on.offsetLeft + on.offsetWidth > c2.scrollLeft + c2.clientWidth)) c2.scrollLeft = on.offsetLeft - 12; }
}
function renderByStudent() {
  const ids = (W.kelas.buku_ids || []).filter(bukuBy); let h = '';
  if (!W.murid.length) h = '<div class="card sub" style="padding:30px;text-align:center">Belum ada murid. Klik <b>+ Tambah murid</b>.</div>';
  W.murid.forEach((m, i) => {
    const n = ids.filter(id => cellOf(m.id, id) === 'T').length, open = W.open === m.id;
    h += `<div class="scard ${open ? 'open' : ''}"><div class="shd" data-open="${m.id}"><span class="no">${i + 1}</span><span class="nm">${esc(m.nama)}</span><span class="pill ${n === ids.length && ids.length ? 'full' : ''}">${n}/${ids.length}</span></div>`;
    if (open) {
      h += `<div class="sbd"><div class="tbar"><label class="f" style="margin:0">Tarikh terima<input type="date" data-dt="${m.id}" value="${m.tarikh_terima || ''}"></label><span class="sp"></span><button class="btn sm" data-sall="${m.id}:T">Tanda semua</button><button class="btn sm" data-sall="${m.id}:">Kosongkan</button><button class="btn sm" data-ed="${m.id}">Sunting</button><button class="btn sm" data-del="${m.id}">Murid telah berpindah</button></div>`;
      ids.forEach(id => { h += rowHtml(`data-tap="${m.id}:${id}"`, esc(bukuBy(id).judul), 0, cellOf(m.id, id), `data-xna="${m.id}:${id}"`); });
      h += '</div>';
    }
    h += '</div>';
  });
  $('#vw').innerHTML = h;
}
function renderTable() {
  if (!$('#vw')) return;
  W.tab = W.tab || 'buku'; renderTabs(); const lg = document.querySelector('.legend'); if (lg) lg.hidden = W.tab !== 'jadual';
  if (W.tab === 'buku') renderByBook(); else if (W.tab === 'murid') renderByStudent(); else renderMatrix();
}
$('#main').addEventListener('click', async e => {
  if (view !== 'kelas' || !W) return;
  const tb = e.target.closest('[data-tab]'); if (tb) { W.tab = tb.dataset.tab; renderTable(); return; }
  const chip = e.target.closest('[data-chip]'); if (chip) { W.book = chip.dataset.chip; renderTable(); return; }
  const bulk = e.target.closest('[data-bulk]'); if (bulk) { W.murid.forEach(m => setCell(m.id, W.book, bulk.dataset.bulk)); renderTable(); renderWarn(); return; }
  const sall = e.target.closest('[data-sall]'); if (sall) { const [mid, v] = sall.dataset.sall.split(':'); (W.kelas.buku_ids || []).filter(bukuBy).forEach(b => setCell(mid, b, v)); renderTable(); renderWarn(); return; }
  const xna = e.target.closest('[data-xna]'); if (xna) { const [mid, bid] = xna.dataset.xna.split(':'); setCell(mid, bid, cellOf(mid, bid) === 'X' ? '' : 'X'); renderTable(); renderWarn(); return; }
  const tap = e.target.closest('[data-tap]'); if (tap) { const [mid, bid] = tap.dataset.tap.split(':'); setCell(mid, bid, cellOf(mid, bid) === 'T' ? '' : 'T'); renderTable(); renderWarn(); return; }
  const op = e.target.closest('[data-open]'); if (op) { W.open = W.open === op.dataset.open ? null : op.dataset.open; renderTable(); return; }
  const c = e.target.closest('td.c');
  if (c) {
    const key = k2(c.dataset.m, c.dataset.b), s = W.terima.get(key);
    const m = W.murid.find(x => x.id === c.dataset.m);
    if (s !== 'T') { W.terima.set(key, 'T'); if (!m.tarikh_terima) m.tarikh_terima = W.kelas.tarikh_agih || today(); } else W.terima.delete(key);
    setDirty(true); renderTable(); renderWarn(); return;
  }
  const th = e.target.closest('th.bk'); if (th) return colMenu(th, th.dataset.col);
  const al = e.target.closest('[data-all]'); if (al) { const m = W.murid.find(x => x.id === al.dataset.all); (W.kelas.buku_ids || []).forEach(b => { if (bukuBy(b)) W.terima.set(k2(m.id, b), 'T'); }); if (!m.tarikh_terima) m.tarikh_terima = W.kelas.tarikh_agih || today(); setDirty(true); renderTable(); renderWarn(); return; }
  const ed = e.target.closest('[data-ed]'); if (ed) return editMurid(ed.dataset.ed);
  const de = e.target.closest('[data-del]'); if (de) {
    const m = W.murid.find(x => x.id === de.dataset.del);
    if (await confirmBox('Murid telah berpindah', `Tandakan <b>${esc(m.nama)}</b> telah berpindah dan keluarkan daripada senarai kelas ini?`, 'Murid telah berpindah', true)) { W.murid = W.murid.filter(x => x !== m); S.buku.forEach(b => W.terima.delete(k2(m.id, b.id))); setDirty(true); renderTable(); renderWarn(); }
  }
});
$('#main').addEventListener('change', e => { const d = e.target.closest('[data-dt]'); if (d && W) { W.murid.find(x => x.id === d.dataset.dt).tarikh_terima = d.value || null; setDirty(true); } });
function colMenu(th, bid) {
  document.querySelectorAll('.pop').forEach(p => p.remove());
  const b = bukuBy(bid), r = th.getBoundingClientRect(), p = document.createElement('div'); p.className = 'pop';
  p.innerHTML = `<div class="h">${esc(b.judul)}</div><button data-a="T">✓ Semua murid terima</button><button data-a="X">✗ Semua tak dapat</button><button data-a="C">Kosongkan lajur</button>`;
  p.style.left = Math.min(r.left, innerWidth - 240) + 'px'; p.style.top = (r.bottom + 4) + 'px'; document.body.appendChild(p);
  const close = () => { p.remove(); document.removeEventListener('pointerdown', off, true); };
  const off = ev => { if (!p.contains(ev.target)) close(); }; setTimeout(() => document.addEventListener('pointerdown', off, true));
  p.onclick = ev => { const a = ev.target.closest('button'); if (!a || !a.dataset.a) return; W.murid.forEach(m => { const key = k2(m.id, bid); if (a.dataset.a === 'C') W.terima.delete(key); else { W.terima.set(key, a.dataset.a); if (a.dataset.a === 'T' && !m.tarikh_terima) m.tarikh_terima = W.kelas.tarikh_agih || today(); } }); close(); setDirty(true); renderTable(); renderWarn(); };
}
async function renameKelas() {
  const v = await modal('Tukar nama kelas', `<label class="f">Nama kelas<input type="text" id="nk" value="${esc(W.kelas.nama)}"></label>`, [{ label: 'Batal', value: null }, { label: 'Simpan', cls: 'pri', get: d => tc(d.querySelector('#nk').value) || false }]);
  if (v) { W.kelas.nama = v; setDirty(true); renderClass(); }
}
async function editMurid(id) {
  const m = id ? W.murid.find(x => x.id === id) : { id: uid(), nama: '', jantina: '', nota: '', tarikh_terima: null, tarikh_pulang: null };
  const r = await modal(id ? 'Sunting murid' : 'Tambah murid', `<label class="f">Nama penuh<input type="text" id="mn" value="${esc(m.nama)}" autocomplete="off"></label>
  <label class="f">Jantina<select id="mj"><option value="">—</option><option ${m.jantina === 'Lelaki' ? 'selected' : ''}>Lelaki</option><option ${m.jantina === 'Perempuan' ? 'selected' : ''}>Perempuan</option></select></label>
  <label class="f">Nota<input type="text" id="mt" value="${esc(m.nota)}" placeholder="cth. berpindah masuk"></label>
  <label class="f">Tarikh pemulangan (abaikan untuk pengagihan awal tahun)<input type="date" id="mr" value="${m.tarikh_pulang || ''}"></label>
  <div class="sub">Nama ditukar automatik: huruf besar di depan setiap perkataan, “bin” dan “binti” huruf kecil.</div>`,
    [{ label: 'Batal', value: null }, { label: 'Simpan', cls: 'pri', get: d => { const n = tc(d.querySelector('#mn').value); if (!n) { d.querySelector('#mn').focus(); return false; } return { nama: n, jantina: d.querySelector('#mj').value || genderOf(n), nota: d.querySelector('#mt').value.trim(), tarikh_pulang: d.querySelector('#mr').value || null }; } }]);
  if (!r) return;
  Object.assign(m, r); if (!id) W.murid.push(m);
  setDirty(true); renderTable(); renderWarn(); renderClass();
}
async function pickTitles() {
  const k = W.kelas; let allYears = false;
  const draw = () => S.buku.filter(b => allYears || b.tahun === k.tahun).map(b => `<label><input type="checkbox" value="${b.id}" ${(k.buku_ids || []).includes(b.id) ? 'checked' : ''}><span>${esc(b.judul)}<br><small>Tahun ${b.tahun}</small></span></label>`).join('');
  const sameYear = S.kelas.filter(x => x.tahun === k.tahun && x.id !== k.id).length;
  const r = await modal('Pilih judul buku kelas', `<div class="row"><button class="btn sm" id="pa">Pilih semua</button><button class="btn sm" id="pn">Kosongkan</button><label class="row" style="gap:6px"><input type="checkbox" id="py"> Tunjuk semua tahun</label></div><div class="bl" id="bl">${draw()}</div>
  ${sameYear ? `<label class="row" style="gap:8px"><input type="checkbox" id="ps"> Guna pilihan ini juga untuk ${sameYear} kelas Tahun ${k.tahun} yang lain</label>` : ''}<div class="sub">Lebih 15 judul akan dicetak pada set borang tambahan (setiap set 15 lajur).</div>`,
    [{ label: 'Batal', value: null }, { label: 'Guna', cls: 'pri', get: d => ({ ids: [...d.querySelectorAll('#bl input:checked')].map(i => i.value), same: !!(d.querySelector('#ps') || {}).checked }) }]);
  if (!r) return;
  const order = new Map(S.buku.map((b, i) => [b.id, i]));
  k.buku_ids = r.ids.sort((a, b) => order.get(a) - order.get(b));
  if (r.same) { const ids = k.buku_ids; for (const o of S.kelas.filter(x => x.tahun === k.tahun && x.id !== k.id)) { try { await api(`spbt_kelas?id=eq.${o.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { buku_ids: ids } }); o.buku_ids = ids.slice(); } catch (e) { toast('Gagal kemas kini ' + esc(o.nama), 'er'); } } }
  setDirty(true); renderTable(); renderWarn();
}
dlg.addEventListener('click', e => {
  if (e.target.id === 'pa' || e.target.id === 'pn') { dlg.querySelectorAll('#bl input').forEach(i => i.checked = e.target.id === 'pa'); }
  if (e.target.id === 'py') { /* tunjuk semua tahun */ const on = e.target.checked, k = W && W.kelas; if (!k) return; const keep = new Set([...dlg.querySelectorAll('#bl input:checked')].map(i => i.value)); (k.buku_ids || []).forEach(x => keep.add(x));
    $('#bl').innerHTML = S.buku.filter(b => on || b.tahun === k.tahun).map(b => `<label><input type="checkbox" value="${b.id}" ${keep.has(b.id) ? 'checked' : ''}><span>${esc(b.judul)}<br><small>Tahun ${b.tahun}</small></span></label>`).join(''); }
});
async function saveClass(auto) {
  if (!W) return; if (saving) { again = true; return; } saving = true; clearTimeout(asT); const btn = $('#btnSave'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  try {
    const ids = new Set((W.kelas.buku_ids || []).filter(i => bukuBy(i)));
    const terima = []; W.murid.forEach(m => ids.forEach(b => { const s = W.terima.get(k2(m.id, b)); if (s) terima.push({ m: m.id, b, s }); }));
    const names = [W.kelas.guru_kelas, W.kelas.penolong].filter(n => n && !S.guru.some(g => g.nama === n));
    if (names.length) { await upsert('spbt_guru', [...new Set(names)].map(nama => ({ nama })), 'nama'); [...new Set(names)].forEach(n => S.guru.push({ id: uid(), nama: n })); S.guru.sort((a, b) => a.nama.localeCompare(b.nama)); }
    W.murid.forEach((m, i) => m.susunan = i + 1);
    await api('rpc/spbt_simpan_kelas', { method: 'POST', body: { p: { kelas: { ...W.kelas, buku_ids: [...ids] }, murid: W.murid, terima } } });
    const kid = W.kelas.id, i = S.kelas.findIndex(k => k.id === kid); S.kelas[i] = JSON.parse(JSON.stringify({ ...W.kelas, buku_ids: [...ids] }));
    const old = S.murid.filter(m => m.kelas_id === kid); old.forEach(m => S.buku.forEach(b => S.terima.delete(k2(m.id, b.id))));
    S.murid = S.murid.filter(m => m.kelas_id !== kid).concat(W.murid.map(m => ({ ...m, kelas_id: kid })));
    terima.forEach(t => S.terima.set(k2(t.m, t.b), t.s));
    const st = stats(W.kelas, W.murid, W.terima);
    if (auto === true) { dirty = false; const c = $('#dirtyChip'); if (c) c.hidden = true; toast('Disimpan ✓', 'ok', 1500); }
    else { setDirty(false);
    if (st.miss.length) { toast(`Disimpan. ${BELL} <b>${st.miss.length} murid</b> masih belum menerima buku lengkap.`, 'wn', 6000); Snd.chime(); } else toast('Disimpan. Semua murid lengkap ✓', 'ok'); }
  } catch (e) { toast('Gagal menyimpan: ' + esc(e.message) + (auto === true ? ' – cuba lagi sebentar…' : ''), 'er', 8000); if (auto === true) { const c = $('#dirtyChip'); if (c) { c.textContent = '● Gagal simpan – cuba semula'; c.hidden = false; } asT = setTimeout(() => saveClass(true), 5000); } }
  saving = false; btn.disabled = false; btn.textContent = '💾 Simpan';
  if (again) { again = false; saveClass(true); }
}
function formCtx(k, murid, terima) {
  const ids = (k.buku_ids || []).filter(i => bukuBy(i));
  return {
    sekolah: (S.cfg.nama_sekolah || '').toUpperCase(), sekolahAsal: S.cfg.nama_sekolah || '', sesi: S.cfg.sesi || '', namaKelas: k.nama, guruKelas: k.guru_kelas, guruBesar: S.cfg.guru_besar,
    titles: ids.map(i => ({ id: i, judul: bukuBy(i).judul })),
    murid: murid.map(m => ({ nama: m.nama, tarikh: m.tarikh_terima, recv: new Set(ids.filter(b => terima.get(k2(m.id, b)) === 'T')), tak: new Set(ids.filter(b => terima.get(k2(m.id, b)) === 'X')) }))
  };
}
const xlsxName = k => `SPBTG_${S.cfg.sesi || ''}_${k.nama.replace(/[^A-Za-z0-9]+/g, '_')}.xlsx`;
function saveBlob(name, data, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
const XLSX_T = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function downloadXlsx() {
  try { toast('Menyediakan borang…', '', 1500); if (dirty) await saveClass(true); const b = await window.SPBT_XLSX.make(formCtx(W.kelas, W.murid, W.terima)); saveBlob(xlsxName(W.kelas), b, XLSX_T); toast('Borang xlsx dimuat turun ✓', 'ok'); }
  catch (e) { console.error(e); toast('Gagal jana borang: ' + esc(e.message), 'er', 8000); }
}
async function downloadAllXlsx() {
  try {
    toast('Menyediakan semua borang…', '', 2500); await loadAll();
    const z = new JSZip(); let n = 0;
    for (const k of S.kelas) { const ms = muridOf(k.id); if (!ms.length || !(k.buku_ids || []).length) continue; z.file(xlsxName(k), await window.SPBT_XLSX.make(formCtx(k, ms, S.terima))); n++; }
    if (!n) return toast('Tiada kelas yang ada murid dan judul buku', 'wn');
    const d = new Date(), p = x => String(x).padStart(2, '0');
    saveBlob(`SPBTG_${S.cfg.sesi || ''}_semua_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.zip`, await z.generateAsync({ type: 'uint8array' }), 'application/zip'); toast(`${n} borang dimuat turun (ZIP) ✓`, 'ok');
  } catch (e) { console.error(e); toast('Gagal jana borang: ' + esc(e.message), 'er', 8000); }
}
function printClass() {
  const ctx = formCtx(W.kelas, W.murid, W.terima);
  const pages = window.SPBT_PRINT.buildPages(ctx), root = $('#printRoot'); root.innerHTML = ''; pages.forEach(p => root.appendChild(p));
  document.body.classList.add('pf'); const end = () => { document.body.classList.remove('pf'); window.removeEventListener('afterprint', end); }; window.addEventListener('afterprint', end);
  setTimeout(() => window.print(), 80);
}

/* ---------- Rumusan ---------- */
let rumTahun = 'all';
function renderRumusan() {
  brand();
  const years = [1, 2, 3, 4, 5, 6].filter(t => rumTahun === 'all' || +rumTahun === t);
  let h = `<div class="row noprint" style="margin-bottom:14px"><div><h1>Rumusan buku kurang</h1><div class="sub">Bilangan murid yang belum menerima setiap judul, mengikut kelas (berdasarkan data yang telah disimpan).</div></div><div class="spacer"></div>
  <select id="rt" style="width:auto"><option value="all">Semua tahun</option>${[1, 2, 3, 4, 5, 6].map(t => `<option value="${t}" ${String(t) === String(rumTahun) ? 'selected' : ''}>Tahun ${t}</option>`).join('')}</select>
  <button class="btn" id="rcsv">⬇ CSV</button><button class="btn pri" id="rprint">🖨 Cetak rumusan</button></div>
  <div class="print-only" style="display:none"></div>`;
  let any = false;
  years.forEach(t => {
    const ks = S.kelas.filter(k => k.tahun === t); if (!ks.length) return;
    const st = ks.map(k => ({ k, n: muridOf(k.id).length, s: kelasStats(k) }));
    const bids = [...new Set(st.flatMap(x => x.s.ids))].sort((a, b) => S.buku.findIndex(x => x.id === a) - S.buku.findIndex(x => x.id === b));
    if (!bids.length) return; any = true;
    const hasOrder = bids.some(b => bukuBy(b).pesanan != null);
    h += `<div class="card sect"><h2>Tahun ${t}</h2><div style="overflow:auto"><table class="g"><thead><tr><th>Judul buku</th>${st.map(x => `<th class="n">${esc(x.k.nama)}<br><span style="font-weight:400">${x.n} murid</span></th>`).join('')}<th class="n">Jumlah kurang</th>${hasOrder ? '<th class="n">Pesanan BTB</th>' : ''}</tr></thead><tbody>`;
    const colTot = st.map(() => 0); let gt = 0;
    bids.forEach(b => {
      const bk = bukuBy(b); let rt = 0;
      h += `<tr><td>${esc(bk.judul)}</td>${st.map((x, i) => { const p = x.s.per.find(q => q.id === b); if (!p || !x.n) return `<td class="n" style="color:var(--mu)">–</td>`; rt += p.kurang; colTot[i] += p.kurang; return `<td class="n kr ${p.kurang ? 'pos' : 'zero'}">${p.kurang}</td>`; }).join('')}<td class="n kr ${rt ? 'pos' : 'zero'}">${rt}</td>${hasOrder ? `<td class="n">${bk.pesanan ?? ''}</td>` : ''}</tr>`; gt += rt;
    });
    h += `</tbody><tfoot><tr><th style="text-align:right">Jumlah kurang</th>${colTot.map(c => `<th class="n">${c}</th>`).join('')}<th class="n">${gt}</th>${hasOrder ? '<th></th>' : ''}</tr></tfoot></table></div></div>`;
  });
  if (!any) h += `<div class="card sect sub">Tiada data untuk dipaparkan.</div>`;
  $('#main').innerHTML = h;
  $('#rt').onchange = e => { rumTahun = e.target.value; renderRumusan(); };
  $('#rprint').onclick = () => { document.body.classList.add('ps'); const end = () => { document.body.classList.remove('ps'); window.removeEventListener('afterprint', end); }; window.addEventListener('afterprint', end); setTimeout(() => window.print(), 60); };
  $('#rcsv').onclick = () => {
    const rows = [['Tahun', 'Kelas', 'Bil. murid', 'Judul', 'Terima', 'Tak dapat', 'Kurang']];
    S.kelas.filter(k => rumTahun === 'all' || k.tahun === +rumTahun).forEach(k => { const n = muridOf(k.id).length; kelasStats(k).per.forEach(p => { const b = bukuBy(p.id); rows.push([k.tahun, k.nama, n, b.judul, p.terima, p.tak || 0, p.kurang]); }); });
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `rumusan-buku-kurang-${S.cfg.sesi || ''}.csv`; a.click();
  };
}

/* ---------- Tetapan ---------- */
let tBuku = 1;
function renderTetapan() {
  brand();
  const c = S.cfg;
  let h = `<h1>Tetapan</h1><div class="sub">Perubahan di sini terus disimpan dan dikongsi dengan semua guru.</div><div class="two" style="margin-top:16px">
  <div class="card sect"><h2>Maklumat sekolah</h2><div style="display:grid;gap:10px">
   <label class="f">Nama sekolah<input type="text" id="cs1" value="${esc(c.nama_sekolah)}"></label>
   <label class="f">Nama guru besar (dicetak pada borang)<input type="text" id="cs2" value="${esc(c.guru_besar)}"></label>
   <label class="f">Sesi / tahun pinjaman<input type="text" id="cs3" value="${esc(c.sesi)}"></label>
   <div><button class="btn pri" id="csv1">Simpan maklumat</button></div></div></div>
  <div class="card sect"><h2>Senarai guru</h2><div class="row" style="margin-bottom:10px"><input type="text" id="ng" placeholder="Nama guru baharu" style="flex:1"><button class="btn" id="ngb">Tambah</button></div>
   <div style="max-height:300px;overflow:auto"><table class="g"><tbody>${S.guru.map(g => `<tr><td>${esc(g.nama)}</td><td style="width:50px"><button class="ib" data-dg="${g.id}" title="Buang">🗑</button></td></tr>`).join('')}</tbody></table></div></div></div>
  <div class="card sect"><h2>Senarai buku</h2><div class="row" style="margin-bottom:12px"><select id="tb" style="width:auto">${[1, 2, 3, 4, 5, 6].map(t => `<option value="${t}" ${t === tBuku ? 'selected' : ''}>Tahun ${t}</option>`).join('')}</select><button class="btn" id="bad">+ Tambah judul</button><button class="btn" id="bim">Tampal senarai</button></div>
   <div style="overflow:auto"><table class="g"><thead><tr><th>Judul</th><th class="n">Pesanan BTB</th><th></th></tr></thead><tbody>${S.buku.filter(b => b.tahun === tBuku).map(b => `<tr><td>${esc(b.judul)}</td><td class="n">${b.pesanan ?? ''}</td><td style="white-space:nowrap"><button class="ib" data-eb="${b.id}">✎</button><button class="ib" data-db="${b.id}">🗑</button></td></tr>`).join('')}</tbody></table></div></div>
  <div class="card sect"><h2>Kelas</h2><div style="overflow:auto"><table class="g"><tbody>${S.kelas.map(k => `<tr><td>Tahun ${k.tahun}</td><td>${esc(k.nama)}</td><td class="n">${muridOf(k.id).length} murid</td><td style="width:60px"><button class="ib" data-dk="${k.id}" title="Buang kelas">🗑</button></td></tr>`).join('')}</tbody></table></div></div>`;
  $('#main').innerHTML = h;
  $('#tb').onchange = e => { tBuku = +e.target.value; renderTetapan(); };
  $('#csv1').onclick = async () => { try { await upsert('spbt_tetapan', [{ kunci: 'nama_sekolah', nilai: $('#cs1').value.trim() }, { kunci: 'guru_besar', nilai: tc($('#cs2').value) }, { kunci: 'sesi', nilai: $('#cs3').value.trim() }], 'kunci'); S.cfg.nama_sekolah = $('#cs1').value.trim(); S.cfg.guru_besar = tc($('#cs2').value); S.cfg.sesi = $('#cs3').value.trim(); brand(); toast('Disimpan', 'ok'); renderTetapan(); } catch (e) { toast('Gagal: ' + esc(e.message), 'er'); } };
  $('#ngb').onclick = async () => { const n = tc($('#ng').value); if (!n) return; if (S.guru.some(g => g.nama === n)) return toast('Nama sudah ada', 'wn'); try { await upsert('spbt_guru', [{ nama: n }], 'nama'); S.guru = await all('spbt_guru', 'select=*&order=nama'); renderTetapan(); } catch (e) { toast('Gagal: ' + esc(e.message), 'er'); } };
  $('#bad').onclick = () => editBuku(); $('#bim').onclick = importBuku;
}
$('#main').addEventListener('click', async e => {
  if (view !== 'tetapan') return;
  const dg = e.target.closest('[data-dg]'); if (dg) { if (await confirmBox('Buang guru', 'Buang nama guru ini daripada senarai pilihan?', 'Buang', true)) { await api(`spbt_guru?id=eq.${dg.dataset.dg}`, { method: 'DELETE' }); S.guru = S.guru.filter(g => g.id !== dg.dataset.dg); renderTetapan(); } return; }
  const eb = e.target.closest('[data-eb]'); if (eb) return editBuku(eb.dataset.eb);
  const db = e.target.closest('[data-db]'); if (db) { const b = bukuBy(db.dataset.db); if (await confirmBox('Buang judul buku', `Buang <b>${esc(b.judul)}</b>? Rekod penerimaan buku ini juga akan dipadam.`, 'Buang', true)) { try { await api(`spbt_buku?id=eq.${b.id}`, { method: 'DELETE' }); S.buku = S.buku.filter(x => x.id !== b.id); for (const k of S.kelas) if ((k.buku_ids || []).includes(b.id)) { k.buku_ids = k.buku_ids.filter(x => x !== b.id); await api(`spbt_kelas?id=eq.${k.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { buku_ids: k.buku_ids } }); } [...S.terima.keys()].filter(x => x.endsWith('|' + b.id)).forEach(x => S.terima.delete(x)); renderTetapan(); } catch (er) { toast('Gagal: ' + esc(er.message), 'er'); } } return; }
  const dk = e.target.closest('[data-dk]'); if (dk) { const k = S.kelas.find(x => x.id === dk.dataset.dk), n = muridOf(k.id).length; if (await confirmBox('Buang kelas', `Buang kelas <b>${esc(k.nama)}</b> beserta ${n} murid dan semua rekodnya? Tindakan ini tidak boleh dibatalkan.`, 'Buang kelas', true)) { try { await api(`spbt_kelas?id=eq.${k.id}`, { method: 'DELETE' }); const ms = muridOf(k.id); ms.forEach(m => S.buku.forEach(b => S.terima.delete(k2(m.id, b.id)))); S.murid = S.murid.filter(m => m.kelas_id !== k.id); S.kelas = S.kelas.filter(x => x.id !== k.id); renderTetapan(); } catch (er) { toast('Gagal: ' + esc(er.message), 'er'); } } }
});
async function editBuku(id) {
  const b = id ? bukuBy(id) : { tahun: tBuku, kod: '', judul: '', pesanan: null };
  const r = await modal(id ? 'Sunting judul buku' : 'Tambah judul buku', `<label class="f">Judul<input type="text" id="bj" value="${esc(b.judul)}"></label><label class="f">Jumlah pesanan BTB (jika ada)<input type="number" id="bp" value="${b.pesanan ?? ''}"></label>`,
    [{ label: 'Batal', value: null }, { label: 'Simpan', cls: 'pri', get: d => { const j = d.querySelector('#bj').value.trim().toUpperCase(); if (!j) return false; return { judul: j, pesanan: d.querySelector('#bp').value === '' ? null : +d.querySelector('#bp').value }; } }]);
  if (!r) return;
  try {
    if (id) { await api(`spbt_buku?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: r }); Object.assign(b, r); }
    else { const row = { id: uid(), tahun: tBuku, susunan: Math.max(0, ...S.buku.map(x => x.susunan)) + 1, ...r }; await api('spbt_buku', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: row }); S.buku.push(row); S.buku.sort((a, c) => a.tahun - c.tahun || a.susunan - c.susunan); }
    renderTetapan();
  } catch (e) { toast('Gagal: ' + esc(e.message), 'er'); }
}
async function importBuku() {
  const r = await modal(`Tampal senarai buku Tahun ${tBuku}`, `<div class="sub">Satu judul buku setiap baris. Boleh salin terus dari Excel.</div><textarea id="im" rows="10" placeholder="BAHASA MELAYU TAHUN 1 SK (BT)"></textarea>`,
    [{ label: 'Batal', value: null }, { label: 'Import', cls: 'pri', get: d => d.querySelector('#im').value }]);
  if (!r) return;
  let n = Math.max(0, ...S.buku.map(x => x.susunan)); const rows = [];
  r.split(/\r?\n/).forEach(l => { const j = l.trim().replace(/\s+/g, ' ').toUpperCase(); if (j && !S.buku.some(b => b.tahun === tBuku && b.judul === j) && !rows.some(x => x.judul === j)) { const id = uid(); rows.push({ id, tahun: tBuku, kod: id.slice(0, 8).toUpperCase(), judul: j, susunan: ++n }); } });
  if (!rows.length) return toast('Tiada baris sah / semua judul sudah wujud', 'wn');
  try { await api('spbt_buku', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: rows }); S.buku.push(...rows); S.buku.sort((a, c) => a.tahun - c.tahun || a.susunan - c.susunan); toast(`${rows.length} judul ditambah. Pilih judul ini pada kelas melalui “Pilih judul buku”.`, 'ok', 6000); renderTetapan(); } catch (e) { toast('Gagal: ' + esc(e.message), 'er'); }
}

/* ---------- Mula ---------- */
(async function init() {
  try { await loadAll(); renderHome(); }
  catch (e) { $('#main').innerHTML = `<div class="card sect"><h2>Tidak dapat memuatkan data</h2><p class="sub">${esc(e.message)}. Semak sambungan internet dan cuba muat semula.</p><button class="btn pri" onclick="location.reload()">Muat semula</button></div>`; }
})();
})();
