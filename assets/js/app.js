/* ══════════════════════════════════════════════════════════════════════
   KSL Digital Log Book
   - offline-first: every entry is written to localStorage immediately
   - then pushed to a Google Sheet through an Apps Script Web App
   - anything that fails to send stays queued and retries on reconnect
   ════════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const DB_KEY  = 'ksl_logbook_v1';
const CFG_KEY = 'ksl_config_v1';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1X9pxps07T4TDXeNxsS4wY8nPuZmhcxXdMp6VFptlLpE/edit';

/* Deployed Apps Script Web App. Baked in so a phone works straight away —
   no per-device setup. Replace this after any new deployment. */
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzA9VCYE6btfC8hlbblRBepxCfendnU-oi8olLrE3VSbNlfnTPuTeqgd2KrCTWCZRjJTg/exec';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ── persistence ───────────────────────────────────────────────────── */
const store = {
  read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch { toast('Storage full — export and clear old entries.', 'err'); return false; }
  }
};

let entries = store.read(DB_KEY, []);
let cfg = Object.assign({
  endpoint: DEFAULT_ENDPOINT, secret: '', lang: 'en', theme: 'light',
  device: 'dev-' + Math.random().toString(36).slice(2, 8)
}, store.read(CFG_KEY, {}));

if (!cfg.endpoint) cfg.endpoint = DEFAULT_ENDPOINT;   // older saved config had none

const saveEntries = () => store.write(DB_KEY, entries);
const saveCfg     = () => store.write(CFG_KEY, cfg);

/* ── i18n ──────────────────────────────────────────────────────────── */
const I18N = {
  en: {},
  ms: {
    'nav.new': 'Entri Baru', 'nav.log': 'Buku Log', 'nav.stats': 'Papan Data', 'nav.setup': 'Sheet',
    'form.kicker': 'Permohonan Servis', 'form.title': 'Rekod entri baharu',
    'form.sub': 'Isi, tandatangan, hantar. Disimpan dalam peranti dan dihantar ke Google Sheet anda.',
    'form.ticket': 'Tiket', 'form.auto': 'auto',
    'f.when': 'Bila', 'f.now': 'Sekarang', 'f.date': 'Tarikh', 'f.time': 'Masa',
    'f.who': 'Siapa', 'f.name': 'Nama pengguna', 'f.dept': 'Jabatan',
    'f.what': 'Apa', 'f.cat': 'Kategori', 'f.pri': 'Keutamaan', 'f.req': 'Permohonan pengguna',
    'f.reqhint': 'Terangkan isu atau aktiviti', 'f.photo': 'Bukti gambar (pilihan)',
    'f.capture': 'Ambil gambar', 'f.remove': 'Buang',
    'f.sig': 'Tandatangan anda', 'f.sighint': 'Tandatangan dengan jari atau tetikus',
    'f.signhere': '✍ tandatangan di sini', 'f.undo': 'Batal', 'f.clear': 'Padam',
    'f.submit': 'Hantar entri', 'f.reset': 'Set semula',
    'cat.hw': 'Perkakasan', 'cat.sw': 'Perisian', 'cat.net': 'Rangkaian', 'cat.acc': 'Akses',
    'cat.mt': 'Penyelenggaraan', 'cat.ot': 'Lain-lain',
    'pri.low': 'Rendah', 'pri.med': 'Sederhana', 'pri.high': 'Tinggi', 'pri.crit': 'Kritikal',
    'log.search': 'Cari nama, tiket, permohonan...', 'log.export': 'Eksport CSV', 'log.import': 'Import',
    'log.empty': 'Tiada entri lagi', 'log.emptysub': 'Entri yang dihantar akan muncul di sini.',
    's.total': 'Jumlah entri', 's.alltime': 'sepanjang masa', 's.open': 'Terbuka',
    's.await': 'menunggu tindakan', 's.res': 'Selesai', 's.today': 'Hari ini', 's.logged': 'direkod hari ini',
    'c.week': 'Entri · 7 hari lepas', 'c.weeksub': 'Bilangan entri setiap hari',
    'c.dept': 'Mengikut jabatan', 'c.deptsub': 'Entri bagi setiap jabatan',
    'c.status': 'Taburan status', 'c.statussub': 'Bahagian entri mengikut status semasa',
    'c.table': 'Jadual data', 'c.tablesub': 'Angka yang sama, dalam teks', 'c.wipe': 'Padam semua',
    'set.title': 'Penyegerakan Google Sheet',
    'set.sub': 'Setiap entri disimpan dalam peranti dahulu, kemudian dihantar ke sheet anda. Jika luar talian, ia beratur dan dihantar kemudian.',
    'set.url': 'URL Apps Script Web App', 'set.save': 'Simpan & uji', 'set.sync': 'Segerak sekarang',
    'set.open': 'Buka sheet ↗', 'set.notset': 'Belum disediakan — entri kekal dalam peranti ini sahaja.',
    'set.how': 'Cara sambung (sekali sahaja, ~3 minit)',
    'set.s1': 'Buka sheet anda, kemudian Extensions → Apps Script.',
    'set.s2': 'Padam kod contoh, tampal semua kandungan apps-script/Code.gs, dan Simpan.',
    'set.s3': 'Klik Deploy → New deployment → Web app. Execute as Me, access Anyone. Benarkan bila diminta.',
    'set.s4': 'Salin URL /exec, tampal di kotak atas, tekan Simpan & uji. Baris ujian akan muncul dalam sheet.',
    'set.note': 'Akses "Anyone" bermaksud sesiapa dengan URL boleh hantar baris. Rahsiakan URL, atau tetapkan SECRET.',
    'set.secret': 'Kata rahsia (pilihan)'
  }
};
function applyLang() {
  const d = I18N[cfg.lang] || {};
  $$('[data-i18n]').forEach(el => { const t = d[el.dataset.i18n]; if (t) el.textContent = t; });
  $$('[data-i18n-ph]').forEach(el => { const t = d[el.dataset.i18nPh]; if (t) el.placeholder = t; });
  $('#lang-label').textContent = cfg.lang.toUpperCase();
  document.documentElement.lang = cfg.lang;
}

/* ── toast ─────────────────────────────────────────────────────────── */
function toast(msg, kind = 'ok', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `<span>${kind === 'ok' ? '✅' : kind === 'err' ? '⚠️' : 'ℹ️'}</span><span>${msg}</span>`;
  $('#toast-wrap').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 240); }, ms);
}
const buzz = (p = 12) => navigator.vibrate && navigator.vibrate(p);

/* A short confetti burst — the one moment in the app worth celebrating. */
function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ['#5b53e8', '#ff7a59', '#16b98a', '#eda100', '#2a78d6'];
  const bits = [...Array(70)].map(() => ({
    x: innerWidth / 2 + (Math.random() - .5) * 120,
    y: innerHeight * .62,
    vx: (Math.random() - .5) * 11,
    vy: -Math.random() * 15 - 6,
    r: Math.random() * 5 + 3,
    spin: (Math.random() - .5) * .3,
    a: Math.random() * Math.PI,
    c: colors[(Math.random() * colors.length) | 0]
  }));

  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    bits.forEach(b => {
      b.vy += .42; b.x += b.vx; b.y += b.vy; b.a += b.spin; b.vx *= .99;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
      ctx.fillStyle = b.c; ctx.globalAlpha = Math.max(0, 1 - frames / 90);
      ctx.fillRect(-b.r, -b.r * .6, b.r * 2, b.r * 1.2);
      ctx.restore();
    });
    if (++frames < 90) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

/* Numbers that roll up instead of snapping — cheap delight on the dashboard.
   A token per element cancels an in-flight roll, so two renders in the same
   tick can never fight over the same number. */
const rolling = new WeakMap();
function countTo(el, target) {
  const token = (rolling.get(el) || 0) + 1;
  rolling.set(el, token);

  const from = parseInt(el.textContent, 10) || 0;
  if (from === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = target; return; }

  const lo = Math.min(from, target), hi = Math.max(from, target);
  const t0 = performance.now(), dur = 550;
  (function step(now) {
    if (rolling.get(el) !== token) return;                 // a newer roll took over
    const k = Math.min(1, Math.max(0, (now - t0) / dur));
    const v = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
    el.textContent = Math.min(hi, Math.max(lo, v));
    if (k < 1) requestAnimationFrame(step); else el.textContent = target;
  })(t0);
}

/* ── theme ─────────────────────────────────────────────────────────── */
function applyTheme() {
  document.documentElement.classList.toggle('dark', cfg.theme === 'dark');
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = cfg.theme === 'dark' ? '#17161c' : '#faf7f4';
  renderStats();
}

/* ── routing ───────────────────────────────────────────────────────── */
function show(view) {
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + view));
  $$('[data-view]').forEach(b => b.classList.toggle('is-on', b.dataset.view === view));
  if (view === 'log') renderLog();
  if (view === 'stats') renderStats();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-view]').forEach(b => b.addEventListener('click', () => { show(b.dataset.view); buzz(); }));

/* ── helpers ───────────────────────────────────────────────────────── */
const pad = n => String(n).padStart(2, '0');
const todayISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PRI_COLOR = { Low: 'var(--c-aqua)', Medium: 'var(--c-blue)', High: 'var(--c-orange)', Critical: 'var(--c-red)' };
const PRI_RANK  = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const STATUS = [
  { key: 'Open',        css: 'st-open',        color: 'var(--c-yellow)' },
  { key: 'In Progress', css: 'st-in-progress', color: 'var(--c-blue)' },
  { key: 'Resolved',    css: 'st-resolved',    color: 'var(--c-aqua)' }
];
const statusMeta = k => STATUS.find(s => s.key === k) || STATUS[0];

function nextTicket() {
  const d = new Date();
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const n = entries.filter(e => e.ticket && e.ticket.includes(day)).length + 1;
  return `LOG-${day}-${pad(n).padStart(3, '0')}`;
}

/* ══ FORM ═════════════════════════════════════════════════════════════ */
const form = $('#entry-form');
let category = '', priority = 'Medium', photoData = '';

function stampNow() {
  const d = new Date();
  form.date.value = todayISO(d);
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

form.request.addEventListener('input', () => {
  $('#char-count').textContent = form.request.value.length;
  updateProgress();
});
form.addEventListener('input', updateProgress);

function updateProgress() {
  const checks = [
    !!form.date.value, !!form.time.value, !!form.name.value.trim(),
    !!form.department.value, !!category, form.request.value.trim().length > 3, hasInk()
  ];
  const pct = Math.round(checks.filter(Boolean).length / checks.length * 100);
  const ring = $('#ring');
  if (ring) { ring.style.setProperty('--p', pct); $('#ring-val').textContent = pct + '%'; }
}

/* ── photo (downscaled so a phone shot stays small) ────────────────── */
$('#photo-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const img = new Image();
  img.onload = () => {
    const max = 900, scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    photoData = c.toDataURL('image/jpeg', 0.72);
    $('#photo-preview').src = photoData;
    $('#photo-wrap').classList.replace('hidden', 'flex');
    URL.revokeObjectURL(img.src);
    toast('Photo attached.');
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
  const r = pad2.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
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
pad2.addEventListener('pointermove', e => {
  if (!drawing) return;
  e.preventDefault(); current.pts.push(posOf(e)); redrawPad();
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
  pad2.addEventListener(ev, () => { if (drawing) { drawing = false; current = null; updateProgress(); } }));

$('#ink-group').addEventListener('click', e => {
  const b = e.target.closest('[data-ink]'); if (!b) return;
  $$('#ink-group .ink').forEach(i => i.classList.toggle('is-on', i === b));
  inkColor = b.dataset.ink; buzz();
});
$('#sig-undo').addEventListener('click', () => { strokes.pop(); redrawPad(); updateProgress(); buzz(); });
$('#sig-clear').addEventListener('click', () => { strokes = []; redrawPad(); updateProgress(); buzz(); });
window.addEventListener('resize', fitPad);

/** Flatten the pad onto an opaque white 2x PNG so it reads in the sheet. */
function signaturePNG() {
  if (!strokes.length) return '';
  const r = pad2.getBoundingClientRect(), s = 2;
  const c = document.createElement('canvas');
  c.width = r.width * s; c.height = r.height * s;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  x.scale(s, s); x.lineCap = 'round'; x.lineJoin = 'round';
  for (const st of strokes) {
    x.strokeStyle = st.color;              // the pad is white too, so what you
                                           // signed is exactly what gets saved
    x.lineWidth = st.width; x.beginPath();
    st.pts.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y));
    x.stroke();
  }
  return c.toDataURL('image/png');
}

/* ── submit ────────────────────────────────────────────────────────── */
function markBad(el, bad) { el.classList.toggle('is-bad', bad); }

form.addEventListener('submit', e => {
  e.preventDefault();
  const fields = [form.date, form.time, form.name, form.department, form.request];
  let bad = null;
  fields.forEach(f => { const empty = !f.value.trim(); markBad(f, empty); if (empty && !bad) bad = f; });
  if (bad) { bad.focus(); bad.scrollIntoView({ block: 'center', behavior: 'smooth' }); return toast('Please complete the required fields.', 'err'); }
  if (!category) { show('new'); return toast('Pick a category.', 'err'); }
  if (!hasInk()) { $('.sig-wrap').scrollIntoView({ block: 'center', behavior: 'smooth' }); return toast('Signature is required.', 'err'); }

  const entry = {
    id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ticket: $('#ticket-id').textContent,
    date: form.date.value, time: form.time.value,
    name: form.name.value.trim(), department: form.department.value,
    category, priority, request: form.request.value.trim(),
    status: 'Open',
    signature: signaturePNG(), photo: photoData,
    device: cfg.device, created: new Date().toISOString(),
    synced: false
  };

  entries.unshift(entry);
  saveEntries();
  buzz([18, 40, 18]);
  celebrate();
  toast(`Nice one! Saved · ${entry.ticket}`);
  resetForm();
  refreshCounts();
  pushEntry(entry, false);
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

/* ══ GOOGLE SHEET SYNC ════════════════════════════════════════════════
   Apps Script web apps do not answer CORS preflight, so the body goes as
   text/plain — that keeps it a "simple request" and no preflight is sent. */
const pendingCount = () => entries.filter(e => !e.synced).length;

function refreshCounts() {
  $('#tab-count').textContent = entries.length;
  const n = pendingCount(), badge = $('#sync-badge');
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
  renderLog(); renderStats();
}

async function callSheet(payload) {
  if (!cfg.endpoint) throw new Error('No endpoint configured');
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ secret: cfg.secret || '' }, payload)),
    redirect: 'follow'
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error('Unexpected reply from Apps Script'); }
  if (!data.ok) throw new Error(data.error || 'Rejected by Apps Script');
  return data;
}

async function pushEntry(entry, quiet = true) {
  if (!cfg.endpoint) { if (!quiet) toast('Saved on device — no sheet connected yet.', 'err'); return false; }
  if (!navigator.onLine) { if (!quiet) toast('Saved on device — offline, queued for the sheet.', 'err'); return false; }
  try {
    await callSheet({ action: 'append', entry });
    entry.synced = true; saveEntries(); refreshCounts();
    if (!quiet) toast('Row written to the Google Sheet.');
    return true;
  } catch (err) {
    if (!quiet) toast('Sheet: ' + err.message, 'err', 5000);
    return false;
  }
}

async function syncAll(loud = true) {
  if (!cfg.endpoint) { show('setup'); return toast('Add your Apps Script URL first.', 'err'); }
  if (!navigator.onLine) return toast('Offline — will sync when back online.', 'err');
  const queue = entries.filter(e => !e.synced);
  const icon = $('#btn-sync svg'); icon.classList.add('spin');
  let ok = 0, fail = 0;
  for (const e of queue) { (await pushEntry(e)) ? ok++ : fail++; }
  try {
    const { rows } = await callSheet({ action: 'list' });
    let added = 0;
    (rows || []).forEach(r => {
      if (r.id && !entries.some(e => e.id === r.id)) { entries.push(Object.assign(r, { synced: true })); added++; }
    });
    if (added) { entries.sort((a, b) => (b.created || '').localeCompare(a.created || '')); saveEntries(); }
    if (loud) toast(`Synced · ${ok} sent, ${added} pulled${fail ? `, ${fail} failed` : ''}`, fail ? 'err' : 'ok');
  } catch (err) {
    if (loud) toast('Sync: ' + err.message, 'err', 5000);
  }
  icon.classList.remove('spin');
  refreshCounts();
}

$('#btn-sync').addEventListener('click', () => syncAll(true));
$('#btn-sync-now').addEventListener('click', () => syncAll(true));

$('#btn-save-endpoint').addEventListener('click', async () => {
  const url = $('#endpoint').value.trim();
  if (url && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(url))
    return toast('That should be the Apps Script /exec URL.', 'err', 5000);
  cfg.endpoint = url; cfg.secret = $('#secret').value.trim(); saveCfg();
  if (!url) { paintEndpointState('Not configured — entries stay on this device only.', 'muted'); return; }
  paintEndpointState('Testing…', 'muted');
  try {
    const r = await callSheet({ action: 'ping' });
    paintEndpointState(`Connected to "${esc(r.sheet || 'sheet')}" · ${r.rows ?? 0} rows`, 'ok');
    toast('Connected. Syncing queued entries…');
    syncAll(true);
  } catch (err) {
    paintEndpointState('Failed: ' + esc(err.message), 'err');
    toast('Could not reach the web app.', 'err', 5000);
  }
});

function paintEndpointState(msg, kind) {
  const box = $('#endpoint-state');
  const color = kind === 'ok' ? 'var(--c-aqua)' : kind === 'err' ? 'var(--c-red)' : '';
  box.innerHTML = `<span style="color:${color}">${msg}</span>`;
}

window.addEventListener('online',  () => { $('#net-state').textContent = 'online';  if (pendingCount()) syncAll(false); });
window.addEventListener('offline', () => { $('#net-state').textContent = 'offline'; });

/* ══ LOG BOOK ═════════════════════════════════════════════════════════ */
const search = $('#search');
[search, $('#f-status'), $('#f-dept'), $('#f-sort')].forEach(el => el.addEventListener('input', renderLog));

function visibleEntries() {
  const q = search.value.trim().toLowerCase();
  const st = $('#f-status').value, dp = $('#f-dept').value, sort = $('#f-sort').value;
  let list = entries.filter(e =>
    (!st || e.status === st) && (!dp || e.department === dp) &&
    (!q || [e.name, e.ticket, e.request, e.department, e.category].join(' ').toLowerCase().includes(q))
  );
  if (sort === 'old') list = [...list].reverse();
  if (sort === 'pri') list = [...list].sort((a, b) => PRI_RANK[a.priority] - PRI_RANK[b.priority]);
  return list;
}

function renderLog() {
  const dpSel = $('#f-dept'), keep = dpSel.value;
  const depts = [...new Set(entries.map(e => e.department).filter(Boolean))].sort();
  dpSel.innerHTML = '<option value="">All departments</option>' + depts.map(d => `<option${d === keep ? ' selected' : ''}>${esc(d)}</option>`).join('');

  const list = visibleEntries();
  $('#log-empty').classList.toggle('hidden', list.length > 0);
  $('#log-list').innerHTML = list.map((e, i) => {
    const sm = statusMeta(e.status);
    return `
    <article class="entry" data-id="${e.id}" style="--pri-c:${PRI_COLOR[e.priority] || 'var(--c-blue)'};animation-delay:${Math.min(i * 35, 280)}ms">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-[11px] font-semibold text-neon">${esc(e.ticket)}</span>
            <span class="pill ${sm.css}"><span class="pill-dot"></span>${esc(e.status)}</span>
            <span class="text-[11px] text-muted">${esc(e.priority)}</span>
            ${e.synced
              ? '<span class="text-[11px] text-muted" title="In Google Sheet">☁ synced</span>'
              : '<span class="text-[11px] text-amber-400" title="Not yet in the sheet">⏳ queued</span>'}
          </div>
          <h4 class="mt-1 truncate font-display text-[15px] font-semibold">${esc(e.name)} <span class="text-muted">· ${esc(e.department)}</span></h4>
          <p class="mt-1 line-clamp-2 text-[13px] text-subink">${esc(e.request)}</p>
          <p class="mt-2 font-mono text-[11px] text-muted">${esc(e.date)} · ${esc(e.time)} · ${esc(e.category)}</p>
        </div>
        ${e.signature ? `<img src="${e.signature}" alt="signature" class="h-12 w-20 shrink-0 rounded-md border border-line bg-white object-contain" />` : ''}
      </div>
    </article>`;
  }).join('');
}

$('#log-list').addEventListener('click', e => {
  const card = e.target.closest('.entry'); if (!card) return;
  openDetail(card.dataset.id);
});

/* ── detail modal ──────────────────────────────────────────────────── */
const modal = $('#modal');
function openDetail(id) {
  const e = entries.find(x => x.id === id); if (!e) return;
  const sm = statusMeta(e.status);
  $('#modal-card').innerHTML = `
    <div class="mb-4 flex items-start justify-between gap-3">
      <div>
        <p class="font-mono text-[11px] font-semibold text-neon">${esc(e.ticket)}</p>
        <h3 class="mt-1 font-display text-xl font-bold">${esc(e.name)}</h3>
        <p class="text-[12px] text-muted">${esc(e.department)} · ${esc(e.date)} ${esc(e.time)}</p>
      </div>
      <button data-act="close" class="icon-btn">✕</button>
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <span class="pill ${sm.css}"><span class="pill-dot"></span>${esc(e.status)}</span>
      <span class="chip">${esc(e.category)}</span>
      <span class="chip" style="border-color:${PRI_COLOR[e.priority]};color:${PRI_COLOR[e.priority]}">${esc(e.priority)}</span>
      <span class="chip">${e.synced ? '☁ in sheet' : '⏳ queued'}</span>
    </div>

    <p class="whitespace-pre-wrap rounded-xl border border-line bg-panel/60 p-3 text-[13px] leading-relaxed">${esc(e.request)}</p>

    ${e.photo ? `<img src="${e.photo}" alt="attached photo" class="mt-3 w-full rounded-xl border border-line object-cover" />` : ''}
    ${e.signature ? `<div class="mt-3"><p class="mb-1 text-[11px] uppercase tracking-wider text-muted">Signature</p><img src="${e.signature}" alt="signature" class="w-full rounded-xl border border-line bg-white" /></div>` : ''}

    <p class="mt-4 mb-2 text-[11px] uppercase tracking-wider text-muted">Set status</p>
    <div class="grid grid-cols-3 gap-2">
      ${STATUS.map(s => `<button data-act="status" data-val="${s.key}" class="chip justify-center ${e.status === s.key ? 'is-on' : ''}">${s.key}</button>`).join('')}
    </div>

    <div class="mt-5 flex flex-wrap gap-2">
      <button data-act="share" class="chip chip-ghost">Share</button>
      <button data-act="print" class="chip chip-ghost">Print</button>
      ${e.synced ? '' : '<button data-act="push" class="chip chip-ghost">Send to sheet</button>'}
      <button data-act="delete" class="chip chip-danger ml-auto">Delete</button>
    </div>`;
  modal.classList.add('is-open');
  modal.dataset.id = id;
}
function closeModal() { modal.classList.remove('is-open'); }

modal.addEventListener('click', async ev => {
  if (ev.target === modal) return closeModal();
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const id = modal.dataset.id, e = entries.find(x => x.id === id);
  const act = b.dataset.act;

  if (act === 'close') closeModal();
  if (act === 'status') {
    e.status = b.dataset.val; e.synced = false; saveEntries(); openDetail(id); refreshCounts(); buzz();
    if (cfg.endpoint && navigator.onLine) {
      try { await callSheet({ action: 'update', entry: e }); e.synced = true; saveEntries(); refreshCounts(); openDetail(id); toast('Status updated in the sheet.'); }
      catch (err) { toast('Saved locally, sheet update failed.', 'err'); }
    }
  }
  if (act === 'push') { (await pushEntry(e, false)) && openDetail(id); }
  if (act === 'share') {
    const text = `${e.ticket}\n${e.date} ${e.time}\n${e.name} · ${e.department}\n${e.priority} · ${e.category} · ${e.status}\n\n${e.request}`;
    if (navigator.share) { try { await navigator.share({ title: e.ticket, text }); } catch {} }
    else { await navigator.clipboard.writeText(text); toast('Entry copied to clipboard.'); }
  }
  if (act === 'print') window.print();
  if (act === 'delete') {
    if (!confirm('Delete this entry from this device?')) return;
    entries = entries.filter(x => x.id !== id); saveEntries(); closeModal(); refreshCounts(); toast('Entry deleted.');
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ── export / import ───────────────────────────────────────────────── */
$('#btn-export').addEventListener('click', () => {
  if (!entries.length) return toast('Nothing to export.', 'err');
  const cols = ['ticket', 'date', 'time', 'name', 'department', 'category', 'priority', 'status', 'request', 'created'];
  const csv = [cols.join(',')].concat(
    entries.map(e => cols.map(c => `"${String(e[c] ?? '').replace(/"/g, '""')}"`).join(','))
  ).join('\r\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `ksl-logbook-${todayISO(new Date())}.csv`);
  setTimeout(() => download(new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' }), `ksl-logbook-${todayISO(new Date())}.json`), 600);
  toast('Exported CSV + JSON backup.');
});

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#import-input').addEventListener('change', ev => {
  const f = ev.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const rows = JSON.parse(r.result);
      if (!Array.isArray(rows)) throw new Error('bad file');
      let added = 0;
      rows.forEach(x => { if (x.id && !entries.some(e => e.id === x.id)) { entries.push(x); added++; } });
      entries.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
      saveEntries(); refreshCounts(); toast(`Imported ${added} entries.`);
    } catch { toast('That file could not be read.', 'err'); }
    ev.target.value = '';
  };
  r.readAsText(f);
});

$('#btn-clear-all').addEventListener('click', () => {
  if (!confirm('Delete every entry stored on this device? Rows already in the Google Sheet stay there.')) return;
  entries = []; saveEntries(); refreshCounts(); toast('Local log book cleared.');
});

/* ══ DASHBOARD ════════════════════════════════════════════════════════
   Plain-HTML marks: one series per chart, so no legend is needed except
   on the status stack, where segments are also value-labelled. */
function renderStats() {
  const total = entries.length;
  const open = entries.filter(e => e.status !== 'Resolved').length;
  const res  = entries.filter(e => e.status === 'Resolved').length;
  const today = todayISO(new Date());
  countTo($('#s-total'), total);
  countTo($('#s-open'), open);
  countTo($('#s-res'), res);
  countTo($('#s-today'), entries.filter(e => e.date === today).length);
  $('#s-open').style.color = 'var(--c-yellow)';
  $('#s-res').style.color  = 'var(--c-aqua)';
  $('#s-today').style.color = 'var(--c-blue)';
  $('#s-rate').textContent = total ? `${Math.round(res / total * 100)}% closed` : '0% closed';

  /* last 7 days — vertical bars, 4px rounded top anchored to the axis */
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const iso = todayISO(d);
    return { iso, label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3), n: entries.filter(e => e.date === iso).length };
  });
  const peak = Math.max(1, ...days.map(d => d.n));
  $('#chart-week').innerHTML = days.map((d, i) => `
    <div class="wk-col" title="${d.label} ${d.iso} · ${d.n} ${d.n === 1 ? 'entry' : 'entries'}">
      <span class="wk-val">${d.n || ''}</span>
      <div class="wk-bar" style="height:${(d.n / peak) * 100}%;animation-delay:${i * 45}ms;${d.iso === todayISO(new Date()) ? 'background:var(--accent)' : ''}"></div>
      <div class="wk-axis w-full"></div>
      <span class="wk-lab">${d.label}</span>
    </div>`).join('');

  /* by department — horizontal bars, every bar directly labelled */
  const byDept = {};
  entries.forEach(e => { byDept[e.department] = (byDept[e.department] || 0) + 1; });
  const dRows = Object.entries(byDept).sort((a, b) => b[1] - a[1]);
  const dMax = Math.max(1, ...dRows.map(r => r[1]));
  $('#chart-dept').innerHTML = dRows.length ? dRows.map(([d, n], i) => `
    <div class="bar-row" title="${esc(d)} · ${n}">
      <span class="text-[12.5px] text-subink">${esc(d)}</span>
      <span class="font-mono text-[12.5px] font-semibold">${n}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / dMax) * 100}%;animation-delay:${i * 60}ms"></div></div>
    </div>`).join('') : '<p class="text-[13px] text-muted">No data yet.</p>';

  /* status mix — a single stacked bar, 2px gaps, legend with counts */
  const counts = STATUS.map(s => ({ ...s, n: entries.filter(e => e.status === s.key).length }));
  const sum = counts.reduce((a, c) => a + c.n, 0);
  $('#chart-status').innerHTML = sum ? `<div class="stack">${counts.filter(c => c.n).map(c =>
    `<span style="flex:${c.n};background:${c.color}" title="${c.key} · ${c.n} (${Math.round(c.n / sum * 100)}%)"></span>`).join('')}</div>`
    : '<p class="text-[13px] text-muted">No data yet.</p>';
  $('#legend-status').innerHTML = counts.map(c =>
    `<span class="lg-item"><span class="lg-swatch" style="background:${c.color}"></span>${c.key} <b class="font-mono text-ink">${c.n}</b></span>`).join('');

  /* table view — the relief for low-contrast marks in light mode */
  $('#stat-table').innerHTML = dRows.length ? dRows.map(([d, n]) => {
    const o = entries.filter(e => e.department === d && e.status !== 'Resolved').length;
    return `<tr class="border-b border-line/60">
      <td class="py-2 pr-4">${esc(d)}</td><td class="py-2 pr-4 font-mono">${n}</td>
      <td class="py-2 pr-4 font-mono">${o}</td><td class="py-2 font-mono">${n - o}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="py-3 text-muted">No data yet.</td></tr>';
}

/* ══ CHROME ═══════════════════════════════════════════════════════════ */
$('#btn-theme').addEventListener('click', () => { cfg.theme = cfg.theme === 'dark' ? 'light' : 'dark'; saveCfg(); applyTheme(); buzz(); });
$('#btn-lang').addEventListener('click', () => {
  cfg.lang = cfg.lang === 'en' ? 'ms' : 'en'; saveCfg();
  if (cfg.lang === 'en') location.reload(); else applyLang();
});

setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString(); }, 1000);

let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; $('#btn-install').classList.remove('hidden'); });
$('#btn-install').addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); installEvent = null; $('#btn-install').classList.add('hidden'); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
  navigator.serviceWorker.register('sw.js').catch(() => {});

/* ── boot ──────────────────────────────────────────────────────────── */
applyTheme();
applyLang();
fitPad();
stampNow();
$('#ticket-id').textContent = nextTicket();
$('#endpoint').value = cfg.endpoint;
$('#secret').value = cfg.secret;
$('#sheet-link').href = SHEET_URL;
$('#net-state').textContent = navigator.onLine ? 'online' : 'offline';
if (cfg.endpoint) paintEndpointState('Endpoint ready — press Sync now to check the connection.', 'muted');
show('new');
refreshCounts();
updateProgress();
if (cfg.endpoint && navigator.onLine && pendingCount()) syncAll(false);
})();
