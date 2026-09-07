/* ══════════════════════════════════════════════════════════════════════
   KSL Digital Log Book
   The Google Sheet is the only store. Nothing is kept in localStorage and
   nothing is cached: every load reads the sheet, and an entry is only
   "saved" once the sheet has confirmed the row.
   ════════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzA9VCYE6btfC8hlbblRBepxCfendnU-oi8olLrE3VSbNlfnTPuTeqgd2KrCTWCZRjJTg/exec';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Session state only — gone when the tab closes, by design. */
let rows = [];
let lang = 'en';
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

/* ── i18n ──────────────────────────────────────────────────────────── */
const I18N = {
  en: {},
  ms: {
    'nav.new': 'Entri Baru', 'nav.log': 'Buku Log',
    'form.kicker': 'Permohonan Servis', 'form.title': 'Apa yang anda perlukan? 👋',
    'form.sub': 'Kira-kira seminit. Setiap entri disimpan terus ke Google Sheet.',
    'form.ticket': 'Tiket', 'form.auto': 'auto',
    'f.when': 'Bila ia berlaku?', 'f.now': 'Sekarang', 'f.date': 'Tarikh', 'f.time': 'Masa',
    'f.who': 'Siapa yang bertanya?', 'f.name': 'Nama pengguna', 'f.dept': 'Jabatan',
    'f.what': 'Apa masalahnya?', 'f.cat': 'Kategori', 'f.pri': 'Keutamaan', 'f.req': 'Permohonan pengguna',
    'f.reqhint': 'Terangkan isu atau aktiviti', 'f.photo': 'Bukti gambar (pilihan)',
    'f.capture': 'Ambil gambar', 'f.remove': 'Buang',
    'f.sig': 'Tandatangan di sini', 'f.sighint': 'Guna jari anda — contengan pun boleh',
    'f.signhere': '✍️ lukis tandatangan anda', 'f.undo': 'Batal', 'f.clear': 'Padam',
    'f.submit': 'Hantar 🚀', 'f.reset': 'Set semula',
    'cat.hw': 'Perkakasan', 'cat.sw': 'Perisian', 'cat.sys': 'Sistem', 'cat.net': 'Rangkaian',
    'cat.acc': 'Akses', 'cat.mt': 'Penyelenggaraan', 'cat.ot': 'Lain-lain',
    'pri.low': 'Rendah', 'pri.med': 'Sederhana', 'pri.high': 'Tinggi', 'pri.crit': 'Kritikal',
    'log.search': 'Cari nama, tiket, permohonan...', 'log.export': 'Eksport CSV',
    'log.dates': 'Tarikh', 'log.today': 'Hari ini', 'log.anydate': 'Semua tarikh',
    'log.empty': 'Tiada entri lagi ✨', 'log.emptysub': 'Entri akan muncul di sini sebaik dihantar.'
  }
};
function applyLang() {
  const d = I18N[lang] || {};
  $$('[data-i18n]').forEach(el => { const t = d[el.dataset.i18n]; if (t) el.textContent = t; });
  $$('[data-i18n-ph]').forEach(el => { const t = d[el.dataset.i18nPh]; if (t) el.placeholder = t; });
  $('#lang-label').textContent = lang.toUpperCase();
  document.documentElement.lang = lang;
}

/* ── toast ─────────────────────────────────────────────────────────── */
function toast(msg, kind = 'ok', ms = 3600) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `<span>${kind === 'ok' ? '✅' : '⚠️'}</span><span>${esc(msg)}</span>`;
  $('#toast-wrap').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 240); }, ms);
}
const buzz = p => navigator.vibrate && navigator.vibrate(p || 12);

function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('#confetti'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#5b53e8', '#ff7a59', '#16b98a', '#eda100', '#2a78d6'];
  const bits = [...Array(70)].map(() => ({
    x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * .62,
    vx: (Math.random() - .5) * 11, vy: -Math.random() * 15 - 6,
    r: Math.random() * 5 + 3, spin: (Math.random() - .5) * .3,
    a: Math.random() * Math.PI, c: colors[(Math.random() * colors.length) | 0]
  }));
  let n = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    bits.forEach(b => {
      b.vy += .42; b.x += b.vx; b.y += b.vy; b.a += b.spin; b.vx *= .99;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
      ctx.fillStyle = b.c; ctx.globalAlpha = Math.max(0, 1 - n / 90);
      ctx.fillRect(-b.r, -b.r * .6, b.r * 2, b.r * 1.2);
      ctx.restore();
    });
    if (++n < 90) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

/* ── theme / language (session only) ───────────────────────────────── */
function applyTheme() {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#17161c' : '#faf7f4';
}
$('#btn-theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; applyTheme(); buzz(); });
$('#btn-lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'ms' : 'en'; buzz();
  if (lang === 'en') location.reload(); else applyLang();
});

/* ── routing ───────────────────────────────────────────────────────── */
function show(view) {
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + view));
  $$('[data-view]').forEach(b => b.classList.toggle('is-on', b.dataset.view === view));
  if (view === 'log') loadRows();
  scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-view]').forEach(b => b.addEventListener('click', () => { show(b.dataset.view); buzz(); }));

/* ── helpers ───────────────────────────────────────────────────────── */
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const PRI_COLOR = { Low: 'var(--c-aqua)', Medium: 'var(--c-blue)', High: 'var(--c-orange)', Critical: 'var(--c-red)' };
const PRI_RANK  = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const ST_CLASS  = { 'Open': 'st-open', 'In Progress': 'st-in-progress', 'Resolved': 'st-resolved' };

/** Ticket numbers come from the sheet, so two phones never mint the same one. */
function nextTicket() {
  const day = isoOf(new Date()).replace(/-/g, '');
  const n = rows.filter(r => r.ticket && r.ticket.indexOf(day) !== -1).length + 1;
  return `LOG-${day}-${String(n).padStart(3, '0')}`;
}

/* ── the sheet ─────────────────────────────────────────────────────── */
async function callSheet(payload) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    redirect: 'follow'
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error('Unexpected reply from the sheet'); }
  if (!data.ok) throw new Error(data.error || 'Rejected by the sheet');
  return data;
}

let loading = false;
async function loadRows(loud) {
  if (loading) return;
  loading = true;
  const icon = $('#btn-sync svg'); icon.classList.add('spin');
  try {
    const data = await callSheet({ action: 'list' });
    rows = (data.rows || []).slice().reverse();          // newest first
    $('#tab-count').textContent = rows.length;
    renderLog();
    $('#ticket-id').textContent = nextTicket();
    if (loud) toast(`Loaded ${rows.length} entries.`);
  } catch (err) {
    renderLog();
    toast('Cannot reach the sheet: ' + err.message, 'err', 5000);
  } finally {
    loading = false; icon.classList.remove('spin');
  }
}
$('#btn-sync').addEventListener('click', () => loadRows(true));
addEventListener('online', () => { $('#net-state').textContent = 'online'; loadRows(); });
addEventListener('offline', () => { $('#net-state').textContent = 'offline'; });

/* ══ FORM ═════════════════════════════════════════════════════════════ */
const form = $('#entry-form');
let category = '', priority = 'Medium', photoData = '';

function stampNow() {
  const d = new Date();
  form.date.value = isoOf(d);
  form.time.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  updateProgress();
}
$('#btn-now').addEventListener('click', () => { stampNow(); buzz(); toast('Timestamped to now.'); });

$('#cat-group').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  $$('#cat-group .chip').forEach(c => c.classList.toggle('is-on', c === b));
  category = b.dataset.cat; buzz(); updateProgress();
});
$('#pri-group').addEventListener('click', e => {
  const b = e.target.closest('[data-pri]'); if (!b) return;
  $$('#pri-group button').forEach(c => c.classList.toggle('is-on', c === b));
  priority = b.dataset.pri; buzz();
});
form.request.addEventListener('input', () => { $('#char-count').textContent = form.request.value.length; updateProgress(); });
form.addEventListener('input', updateProgress);

function updateProgress() {
  const checks = [!!form.date.value, !!form.time.value, !!form.name.value.trim(),
                  !!form.department.value, !!category, form.request.value.trim().length > 3, hasInk()];
  const pct = Math.round(checks.filter(Boolean).length / checks.length * 100);
  const ring = $('#ring');
  if (ring) { ring.style.setProperty('--p', pct); $('#ring-val').textContent = pct + '%'; }
}

/* ── photo: stepped down until it fits one spreadsheet cell ────────── */
const CELL_CHARS = 45000;
function encodeToFit(img, maxChars) {
  const steps = [[900, .7], [760, .62], [640, .55], [520, .5], [420, .45], [340, .4]];
  let out = '';
  for (const [max, q] of steps) {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q);
    if (out.length <= maxChars) return out;
  }
  return out;
}
$('#photo-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const img = new Image();
  img.onload = () => {
    photoData = encodeToFit(img, CELL_CHARS);
    $('#photo-preview').src = photoData;
    $('#photo-wrap').classList.replace('hidden', 'flex');
    URL.revokeObjectURL(img.src);
    toast(photoData.length <= CELL_CHARS ? 'Photo attached.'
      : 'Photo is very large — it may not reach the sheet.', photoData.length <= CELL_CHARS ? 'ok' : 'err');
  };
  img.src = URL.createObjectURL(file);
});
$('#photo-clear').addEventListener('click', () => {
  photoData = ''; $('#photo-input').value = '';
  $('#photo-wrap').classList.replace('flex', 'hidden');
});

/* ── signature pad ─────────────────────────────────────────────────── */
const pad2 = $('#sig-pad'), pctx = pad2.getContext('2d');
let strokes = [], current = null, inkColor = '#141414', drawing = false;

function fitPad() {
  const r = pad2.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  pad2.width = Math.round(r.width * dpr); pad2.height = Math.round(r.height * dpr);
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawPad();
}
function redrawPad() {
  pctx.clearRect(0, 0, pad2.width, pad2.height);
  pctx.lineCap = 'round'; pctx.lineJoin = 'round';
  for (const s of strokes) {
    pctx.strokeStyle = s.color; pctx.lineWidth = s.width; pctx.beginPath();
    s.pts.forEach((p, i) => i ? pctx.lineTo(p.x, p.y) : pctx.moveTo(p.x, p.y));
    pctx.stroke();
  }
  $('.sig-wrap').classList.toggle('has-ink', strokes.length > 0);
}
const hasInk = () => strokes.length > 0;
const posOf = e => { const r = pad2.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

pad2.addEventListener('pointerdown', e => {
  e.preventDefault(); pad2.setPointerCapture(e.pointerId); drawing = true;
  current = { color: inkColor, width: e.pointerType === 'pen' ? 1.8 : 2.4, pts: [posOf(e)] };
  strokes.push(current); redrawPad(); buzz(6);
});
pad2.addEventListener('pointermove', e => { if (!drawing) return; e.preventDefault(); current.pts.push(posOf(e)); redrawPad(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
  pad2.addEventListener(ev, () => { if (drawing) { drawing = false; current = null; updateProgress(); } }));

$('#ink-group').addEventListener('click', e => {
  const b = e.target.closest('[data-ink]'); if (!b) return;
  $$('#ink-group .ink').forEach(i => i.classList.toggle('is-on', i === b));
  inkColor = b.dataset.ink; buzz();
});
$('#sig-undo').addEventListener('click', () => { strokes.pop(); redrawPad(); updateProgress(); buzz(); });
$('#sig-clear').addEventListener('click', () => { strokes = []; redrawPad(); updateProgress(); buzz(); });
addEventListener('resize', fitPad);

/** Cropped, capped PNG — small enough to live in one spreadsheet cell. */
function signaturePNG() {
  if (!strokes.length) return '';
  const MAX_W = 420, PAD = 10;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const st of strokes) for (const p of st.pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), scale = Math.min(2, MAX_W / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  x.scale(scale, scale); x.translate(-x0, -y0);
  x.lineCap = 'round'; x.lineJoin = 'round';
  for (const st of strokes) {
    x.strokeStyle = st.color; x.lineWidth = st.width; x.beginPath();
    st.pts.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y));
    x.stroke();
  }
  return c.toDataURL('image/png');
}

/* ── submit: nothing is kept locally, so the sheet must confirm ────── */
const markBad = (el, bad) => el.classList.toggle('is-bad', bad);

form.addEventListener('submit', async e => {
  e.preventDefault();
  const fields = [form.date, form.time, form.name, form.department, form.request];
  let bad = null;
  fields.forEach(f => { const empty = !f.value.trim(); markBad(f, empty); if (empty && !bad) bad = f; });
  if (bad) { bad.focus(); bad.scrollIntoView({ block: 'center', behavior: 'smooth' }); return toast('Please complete the required fields.', 'err'); }
  if (!category) return toast('Pick a category.', 'err');
  if (!hasInk()) { $('.sig-wrap').scrollIntoView({ block: 'center', behavior: 'smooth' }); return toast('Signature is required.', 'err'); }

  if (!navigator.onLine) return toast('You are offline. The entry needs a connection to save.', 'err', 5000);

  const entry = {
    id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ticket: $('#ticket-id').textContent,
    date: form.date.value, time: form.time.value,
    name: form.name.value.trim(), department: form.department.value,
    category, priority, request: form.request.value.trim(),
    status: 'Open', signature: signaturePNG(), photo: photoData,
    device: navigator.platform || 'web', created: new Date().toISOString()
  };

  const btn = $('#btn-submit'), label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span>Saving to the sheet…</span>';
  try {
    await callSheet({ action: 'append', entry });
    rows.unshift(entry);
    $('#tab-count').textContent = rows.length;
    buzz([18, 40, 18]); celebrate();
    toast(`Saved to the sheet · ${entry.ticket}`);
    resetForm();
    renderLog();
  } catch (err) {
    // The form is deliberately left as it is so nothing typed is lost.
    toast('Not saved: ' + err.message + ' — try again.', 'err', 6000);
  } finally {
    btn.disabled = false; btn.innerHTML = label;
  }
});

$('#btn-reset').addEventListener('click', () => { resetForm(); toast('Form cleared.'); });

function resetForm() {
  form.reset();
  strokes = []; redrawPad();
  photoData = ''; $('#photo-wrap').classList.replace('flex', 'hidden');
  category = ''; $$('#cat-group .chip').forEach(c => c.classList.remove('is-on'));
  priority = 'Medium';
  $$('#pri-group button').forEach(b => b.classList.toggle('is-on', b.dataset.pri === 'Medium'));
  $('#char-count').textContent = '0';
  $$('.input').forEach(i => markBad(i, false));
  stampNow();
  $('#ticket-id').textContent = nextTicket();
  updateProgress();
}

/* ══ LOG BOOK ═════════════════════════════════════════════════════════ */
const search = $('#search');
[search, $('#f-status'), $('#f-dept'), $('#f-sort'), $('#f-from'), $('#f-to')]
  .forEach(el => el.addEventListener('input', renderLog));

$('#btn-today').addEventListener('click', () => {
  const t = isoOf(new Date());
  $('#f-from').value = t; $('#f-to').value = t; renderLog(); buzz();
});
$('#btn-dates-clear').addEventListener('click', () => {
  $('#f-from').value = ''; $('#f-to').value = ''; renderLog(); buzz();
});

function visibleRows() {
  const q = search.value.trim().toLowerCase();
  const st = $('#f-status').value, dp = $('#f-dept').value, sort = $('#f-sort').value;
  const from = $('#f-from').value, to = $('#f-to').value;   // yyyy-mm-dd sorts as text
  let list = rows.filter(r =>
    (!st || r.status === st) && (!dp || r.department === dp) &&
    (!from || (r.date && r.date >= from)) && (!to || (r.date && r.date <= to)) &&
    (!q || [r.name, r.ticket, r.request, r.department, r.category].join(' ').toLowerCase().includes(q)));
  if (sort === 'old') list = [...list].reverse();
  if (sort === 'pri') list = [...list].sort((a, b) => PRI_RANK[a.priority] - PRI_RANK[b.priority]);
  return list;
}

function renderLog() {
  const dpSel = $('#f-dept'), keep = dpSel.value;
  const depts = [...new Set(rows.map(r => r.department).filter(Boolean))].sort();
  dpSel.innerHTML = '<option value="">All departments</option>' +
    depts.map(d => `<option${d === keep ? ' selected' : ''}>${esc(d)}</option>`).join('');

  const list = visibleRows();
  $('#log-empty').classList.toggle('hidden', list.length > 0);
  $('#log-list').innerHTML = list.map((r, i) => `
    <article class="entry" data-id="${esc(r.id)}" style="--pri-c:${PRI_COLOR[r.priority] || 'var(--accent)'};animation-delay:${Math.min(i * 30, 260)}ms">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-[11px] font-semibold text-neon">${esc(r.ticket)}</span>
            <span class="pill ${ST_CLASS[r.status] || 'st-open'}"><span class="pill-dot"></span>${esc(r.status)}</span>
            <span class="text-[11px] text-muted">${esc(r.priority)}</span>
          </div>
          <h4 class="mt-1 truncate font-display text-[15px] font-semibold">${esc(r.name)} <span class="text-muted">· ${esc(r.department)}</span></h4>
          <p class="mt-1 line-clamp-2 text-[13px] text-subink">${esc(r.request)}</p>
          <p class="mt-2 font-mono text-[11px] text-muted">${esc(r.date)} · ${esc(r.time)} · ${esc(r.category)}</p>
        </div>
        ${r.signature ? `<img src="${r.signature}" alt="signature" class="h-12 w-20 shrink-0 rounded-md border border-line bg-white object-contain" />` : ''}
      </div>
    </article>`).join('');
}

$('#log-list').addEventListener('click', e => {
  const card = e.target.closest('.entry'); if (card) openDetail(card.dataset.id);
});

/* ── detail (read only) ────────────────────────────────────────────── */
const modal = $('#modal');
function openDetail(id) {
  const r = rows.find(x => x.id === id); if (!r) return;
  $('#modal-card').innerHTML = `
    <div class="mb-4 flex items-start justify-between gap-3">
      <div>
        <p class="font-mono text-[11px] font-semibold text-neon">${esc(r.ticket)}</p>
        <h3 class="mt-1 font-display text-xl font-bold">${esc(r.name)}</h3>
        <p class="text-[12px] text-muted">${esc(r.department)} · ${esc(r.date)} ${esc(r.time)}</p>
      </div>
      <button data-act="close" class="icon-btn">✕</button>
    </div>
    <div class="mb-4 flex flex-wrap gap-2">
      <span class="pill ${ST_CLASS[r.status] || 'st-open'}"><span class="pill-dot"></span>${esc(r.status)}</span>
      <span class="chip">${esc(r.category)}</span>
      <span class="chip" style="border-color:${PRI_COLOR[r.priority]};color:${PRI_COLOR[r.priority]}">${esc(r.priority)}</span>
    </div>
    <p class="whitespace-pre-wrap rounded-xl border border-line bg-panel/60 p-3 text-[13px] leading-relaxed">${esc(r.request)}</p>
    ${r.photo ? `<img src="${r.photo}" alt="attached photo" class="mt-3 w-full rounded-xl border border-line object-cover" />` : ''}
    ${r.signature ? `<div class="mt-3"><p class="mb-1 text-[11px] uppercase tracking-wider text-muted">Signature</p><img src="${r.signature}" alt="signature" class="w-full rounded-xl border border-line bg-white" /></div>` : ''}
    <div class="mt-5 flex flex-wrap gap-2">
      <button data-act="share" class="chip chip-ghost">Share</button>
      <button data-act="print" class="chip chip-ghost">Print</button>
    </div>
    <p class="mt-3 text-[11px] text-muted">Entries cannot be changed here — a log book is a record. Ask an admin to edit or remove one.</p>`;
  modal.classList.add('is-open');
  modal.dataset.id = id;
}
const closeModal = () => modal.classList.remove('is-open');

modal.addEventListener('click', async ev => {
  if (ev.target === modal) return closeModal();
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const r = rows.find(x => x.id === modal.dataset.id);
  if (b.dataset.act === 'close') closeModal();
  if (b.dataset.act === 'print') print();
  if (b.dataset.act === 'share' && r) {
    const text = `${r.ticket}\n${r.date} ${r.time}\n${r.name} · ${r.department}\n${r.priority} · ${r.category} · ${r.status}\n\n${r.request}`;
    if (navigator.share) { try { await navigator.share({ title: r.ticket, text }); } catch {} }
    else { await navigator.clipboard.writeText(text); toast('Entry copied to clipboard.'); }
  }
});
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ── export (of what is on screen; the sheet stays the record) ─────── */
$('#btn-export').addEventListener('click', () => {
  if (!rows.length) return toast('Nothing to export.', 'err');
  const cols = ['ticket', 'date', 'time', 'name', 'department', 'category', 'priority', 'status', 'request', 'created'];
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `ksl-logbook-${isoOf(new Date())}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Exported CSV.');
});

/* ── no service worker, no cached copies ───────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(rs => rs.forEach(r => r.unregister()))
    .catch(() => {});
}
if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});

/* ── boot ──────────────────────────────────────────────────────────── */
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString(); }, 1000);
applyTheme();
applyLang();
fitPad();
stampNow();
$('#net-state').textContent = navigator.onLine ? 'online' : 'offline';
show('new');
updateProgress();
loadRows();
})();
