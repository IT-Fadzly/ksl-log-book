/* ══════════════════════════════════════════════════════════════════════
   KSL Digital Log Book — admin console
   Edits and deletes go straight to the Google Sheet. The log book app
   itself is read-only; this page is the only place rows can change.
   ════════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzA9VCYE6btfC8hlbblRBepxCfendnU-oi8olLrE3VSbNlfnTPuTeqgd2KrCTWCZRjJTg/exec';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DEPARTMENTS = ['IT', 'Finance', 'F&B', 'Sales', 'Kitchen', 'Marketing', 'Reservation',
                     'Front Office', 'Housekeeping', 'Security', 'Onsen Spa', 'HR', 'Maintenance', 'Receiving'];
const CATEGORIES  = ['Hardware', 'Software', 'System', 'Network', 'Access', 'Maintenance', 'Other'];
const PRIORITIES  = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES    = ['Open', 'In Progress', 'On Hold', 'Resolved'];
const PRI_COLOR   = { Low: 'var(--c-aqua)', Medium: 'var(--c-blue)', High: 'var(--c-orange)', Critical: 'var(--c-red)' };
const ST_CLASS    = { 'Open': 'st-open', 'In Progress': 'st-in-progress', 'On Hold': 'st-hold', 'Resolved': 'st-resolved' };

let rows = [], adminKey = '';

/* Drawn marks rather than emoji: they take the surrounding colour and stay
   crisp at any size, and every platform renders them identically. */
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" class="inline-block h-[14px] w-[14px] align-[-2px]"><path d="M4 13.5 9.8 19.5 20 5"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" class="inline-block h-[13px] w-[13px] align-[-2px]"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.4l3.3 2"/></svg>';

/** The sheet keeps the clock; this only formats what it sends back. */
function humanDur(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return 'under a minute';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
/* ── two different clocks ──────────────────────────────────────────────
   A job left overnight for a part was not being worked on all night, so the
   time IT held it is taken out of the worked total. How long the job stayed
   open is a separate question — a part that takes three days to arrive is
   worth seeing — so the calendar days are counted on their own. */
function workedMs(r) {
  if (!r.startedAt) return 0;
  const start = Date.parse(r.startedAt);
  const end = r.finishedAt ? Date.parse(r.finishedAt) : Date.now();
  const hold = r.pausedAt ? (end - Date.parse(r.pausedAt)) : 0;
  return Math.max(0, end - start - Number(r.heldMs || 0) - hold);
}

/** Calendar days spanned, counting both ends: finished the same day is 1. */
function daysSpan(r) {
  if (!r.startedAt) return 1;
  const a = new Date(r.startedAt), b = r.finishedAt ? new Date(r.finishedAt) : new Date();
  const d0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const d1 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.max(1, Math.round((d1 - d0) / 86400000) + 1);
}

/** " · 3 days" — said only when it is more than the one day it usually is. */
const daysLabel = r => { const d = daysSpan(r); return d > 1 ? ` · ${d} days` : ''; };

function timing(r) {
  if (r.finishedAt || r.duration) {
    const took = r.duration || humanDur(workedMs(r));
    const span = `${esc(r.timeOut || '—')} → <b>${esc(r.timeReturned || '—')}</b>`;
    return `<span class="inline-flex items-center gap-1 text-[11px]" style="color:var(--c-aqua)">${TICK} ${span}${took ? ` · took <b>${esc(took)}</b>` : ''}${esc(daysLabel(r))}</span>`;
  }
  if (r.pausedAt) {
    return `<span class="inline-flex items-center gap-1 text-[11px]" style="color:var(--c-orange)">${CLOCK} on hold after <b>${esc(humanDur(workedMs(r)))}</b>${esc(daysLabel(r))}</span>`;
  }
  if (r.startedAt || r.timeOut) {
    const run = r.startedAt ? ` · running <b>${esc(humanDur(workedMs(r)))}</b>` : '';
    return `<span class="inline-flex items-center gap-1 text-[11px]" style="color:var(--c-orange)">${CLOCK} started ${esc(r.timeOut || '—')}${run}${esc(daysLabel(r))}</span>`;
  }
  return `<span class="inline-flex items-center gap-1 text-[11px]" style="color:var(--c-yellow)">${CLOCK} waiting for IT to start</span>`;
}

/* ── toast ─────────────────────────────────────────────────────────── */
function toast(msg, kind = 'ok', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `<span>${kind === 'ok' ? '✅' : '⚠️'}</span><span>${esc(msg)}</span>`;
  $('#toast-wrap').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 240); }, ms);
}

/* ── sheet calls ───────────────────────────────────────────────────── */
async function call(payload, retried) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ key: adminKey }, payload)),
    redirect: 'follow'
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error('Unexpected reply from Apps Script'); }

  // No key is configured by default. If one ever is, ask for it at the
  // moment it is needed rather than gating the whole page up front.
  if (!data.ok && /admin key/i.test(data.error || '') && !retried) {
    const entered = prompt('This sheet is protected. Enter the admin key:', adminKey || '');
    if (entered === null) throw new Error('Cancelled');
    adminKey = entered.trim();               // kept in memory only, never stored
    return call(payload, true);
  }

  if (!data.ok) throw new Error(data.error || 'Rejected');
  return data;
}

/* ── load + render ─────────────────────────────────────────────────── */
async function load() {
  $('#state').textContent = 'Loading…';
  try {
    const data = await call({ action: 'list', lite: true });
    rows = (data.rows || []).slice().reverse();          // newest first
    $('#count').textContent = rows.length;
    $('#state').textContent = `Loaded ${rows.length} rows`;
    const keep = $('#f-dept').value;
    const depts = [...new Set(rows.map(r => r.department).filter(Boolean))].sort();
    $('#f-dept').innerHTML = '<option value="">All departments</option>' +
      depts.map(d => `<option${d === keep ? ' selected' : ''}>${esc(d)}</option>`).join('');
    render();
    renderStats();
  } catch (err) {
    $('#state').textContent = '';
    toast('Load failed: ' + err.message, 'err', 5000);
  }
}


/* ── images on demand ──────────────────────────────────────────────────
   The listing arrives without pictures so a refresh stays small, and the
   pictures are fetched separately. They are kept in a cache keyed by entry id
   rather than written onto the row objects: every refresh replaces those
   objects, so anything held on them alone would disappear on the next poll. */
const mediaCache = new Map();
const inFlight = new Set();

/** Put any pictures we already hold back onto the freshly loaded rows. */
function applyMedia(list) {
  let any = false;
  list.forEach(r => {
    const m = mediaCache.get(r.id);
    if (m && (m.signature || m.photo) && !r.signature && !r.photo) { Object.assign(r, m); any = true; }
  });
  return any;
}

async function fetchMedia(ids) {
  const want = ids.filter(id => id && !mediaCache.has(id) && !inFlight.has(id)).slice(0, 20);
  if (!want.length) return false;
  want.forEach(id => inFlight.add(id));
  try {
    const { media } = await call({ action: 'media', ids: want });
    // Cache the misses too, so a row without pictures is never asked for twice.
    want.forEach(id => mediaCache.set(id, (media && media[id]) || { signature: '', photo: '' }));
    return applyMedia(rows);
  } catch {
    return false;
  } finally {
    want.forEach(id => inFlight.delete(id));
  }
}

/** Fill in the pictures for the rows on screen, then repaint once. */
function hydrateVisible(list) {
  applyMedia(list);
  const ids = list
    .filter(r => (r.hasSignature || r.hasPhoto) && !r.signature && !r.photo)
    .map(r => r.id);
  if (ids.length) fetchMedia(ids).then(got => { if (got) render(); });
}

/* ── dashboard ─────────────────────────────────────────────────────────
   One series per chart, so no legend is needed except on the status stack,
   where the segments are value-labelled as well. Numbers come from the
   sheet, so every admin sees the same figures. */
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ST_COLOR = { 'Open': 'var(--c-yellow)', 'In Progress': 'var(--c-blue)', 'On Hold': 'var(--c-orange)', 'Resolved': 'var(--c-aqua)' };

function renderStats() {
  const total = rows.length;
  const res = rows.filter(r => r.status === 'Resolved').length;
  const today = isoOf(new Date());

  $('#s-total').textContent = total;
  $('#s-open').textContent = total - res;
  $('#s-res').textContent = res;
  $('#s-today').textContent = rows.filter(r => r.date === today).length;
  $('#s-open').style.color = 'var(--c-yellow)';
  $('#s-res').style.color = 'var(--c-aqua)';
  $('#s-today').style.color = 'var(--c-blue)';
  $('#s-rate').textContent = total ? `${Math.round(res / total * 100)}% closed` : '0% closed';

  const days = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const iso = isoOf(d);
    return { iso, label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3), n: rows.filter(r => r.date === iso).length };
  });
  const peak = Math.max(1, ...days.map(d => d.n));
  $('#chart-week').innerHTML = days.map((d, i) => `
    <div class="wk-col" title="${d.label} ${d.iso} · ${d.n} ${d.n === 1 ? 'entry' : 'entries'}">
      <span class="wk-val">${d.n || ''}</span>
      <div class="wk-bar" style="height:${(d.n / peak) * 100}%;animation-delay:${i * 45}ms;${d.iso === today ? 'background:var(--accent)' : ''}"></div>
      <div class="wk-axis w-full"></div>
      <span class="wk-lab">${d.label}</span>
    </div>`).join('');

  const byDept = {};
  rows.forEach(r => { byDept[r.department] = (byDept[r.department] || 0) + 1; });
  const dRows = Object.entries(byDept).sort((a, b) => b[1] - a[1]);
  const dMax = Math.max(1, ...dRows.map(r => r[1]));
  $('#chart-dept').innerHTML = dRows.length ? dRows.map(([d, n], i) => `
    <div class="bar-row" title="${esc(d)} · ${n}">
      <span class="text-[12.5px] text-subink">${esc(d)}</span>
      <span class="font-mono text-[12.5px] font-semibold">${n}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / dMax) * 100}%;animation-delay:${i * 60}ms"></div></div>
    </div>`).join('') : '<p class="text-[13px] text-muted">No data yet.</p>';

  const counts = STATUSES.map(k => ({ k, n: rows.filter(r => r.status === k).length }));
  const sum = counts.reduce((a, c) => a + c.n, 0);
  $('#chart-status').innerHTML = sum
    ? `<div class="stack">${counts.filter(c => c.n).map(c =>
        `<span style="flex:${c.n};background:${ST_COLOR[c.k]}" title="${c.k} · ${c.n} (${Math.round(c.n / sum * 100)}%)"></span>`).join('')}</div>`
    : '<p class="text-[13px] text-muted">No data yet.</p>';
  $('#legend-status').innerHTML = counts.map(c =>
    `<span class="lg-item"><span class="lg-swatch" style="background:${ST_COLOR[c.k]}"></span>${c.k} <b class="font-mono text-ink">${c.n}</b></span>`).join('');

  $('#stat-table').innerHTML = dRows.length ? dRows.map(([d, n]) => {
    const o = rows.filter(r => r.department === d && r.status !== 'Resolved').length;
    return `<tr class="border-b border-line/60">
      <td class="py-2 pr-4">${esc(d)}</td><td class="py-2 pr-4 font-mono">${n}</td>
      <td class="py-2 pr-4 font-mono">${o}</td><td class="py-2 font-mono">${n - o}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="py-3 text-muted">No data yet.</td></tr>';
}

/* ── pages ─────────────────────────────────────────────────────────────
   The sheet only grows, so the list is drawn one page at a time — the
   browser is never asked to lay out hundreds of cards, and only the cards
   on screen ask the sheet for their pictures. The page is a slice of
   whatever the filters already narrowed down, so changing a filter returns
   to page one: page seven of the old result means nothing against the new. */
let perPage = 10, page = 1;

/** Cut the filtered list down to the page on screen, and redraw the bar. */
function paginate(list) {
  const total = list.length;
  const size = perPage || total || 1;          // "All" puts everything on one page
  const pages = Math.max(1, Math.ceil(total / size));
  page = Math.min(Math.max(1, page), pages);   // a refresh or a delete can shrink the list
  const start = (page - 1) * size, end = Math.min(start + size, total);

  $('#pager').hidden = total === 0;
  $('#pager-range').textContent = total ? `${start + 1}–${end} of ${total}` : '';
  $$('#pager [data-pg]').forEach(b => {
    b.disabled = /first|prev/.test(b.dataset.pg) ? page === 1 : page === pages;
  });
  return list.slice(start, end);
}

$('#per-page').addEventListener('change', e => { perPage = +e.target.value; page = 1; render(); });
$('#pager').addEventListener('click', e => {
  const b = e.target.closest('[data-pg]'); if (!b) return;
  const to = b.dataset.pg;
  page = to === 'first' ? 1 : to === 'prev' ? page - 1 : to === 'next' ? page + 1 : 1e9;
  render();                                    // paginate() clamps it back into range
  scrollTo({ top: Math.max(0, $('#work').offsetTop - 80), behavior: 'smooth' });
});

function visible() {
  const q = $('#search').value.trim().toLowerCase();
  const st = $('#f-status').value, dp = $('#f-dept').value;
  const from = $('#f-from').value, to = $('#f-to').value;   // yyyy-mm-dd sorts as text
  return rows.filter(r =>
    (!st || r.status === st) && (!dp || r.department === dp) &&
    (!from || (r.date && r.date >= from)) && (!to || (r.date && r.date <= to)) &&
    (!q || [r.ticket, r.name, r.department, r.request, r.category].join(' ').toLowerCase().includes(q))
  );
}

function render() {
  const list = visible();
  const shown = paginate(list);
  hydrateVisible(shown);
  $('#empty').classList.toggle('hidden', list.length > 0);
  $('#list').innerHTML = shown.map((r, i) => `
    <article class="entry compact !cursor-default" style="--pri-c:${PRI_COLOR[r.priority] || 'var(--accent)'};animation-delay:${Math.min(i * 14, 160)}ms">
      <div class="ent-top">
        <span class="font-mono text-[11px] font-semibold text-neon">${esc(r.ticket)}</span>
        <span class="pill ${ST_CLASS[r.status] || 'st-open'}"><span class="pill-dot"></span>${esc(r.status)}</span>
        <span class="truncate font-display text-[13.5px] font-semibold">${esc(r.name)}</span>
        <span class="truncate text-[12px] text-muted">· ${esc(r.department)}</span>
        <span class="ml-auto shrink-0 font-mono text-[11px] text-muted">${esc(r.date)} ${esc(r.time)}</span>
      </div>
      <div class="ent-sub">
        <span class="ent-req">${esc(r.request)}${r.resolution ? ` <span style="color:var(--c-aqua)">· ${esc(r.resolution)}</span>` : ''}</span>
        <span class="shrink-0 text-[11px]" style="color:${PRI_COLOR[r.priority]}">${esc(r.priority)}</span>
        <button class="chip chip-ghost shrink-0 !py-0.5 !px-2 !text-[11px]" data-act="edit" data-id="${esc(r.id)}">Edit</button>
        <button class="chip chip-danger shrink-0 !py-0.5 !px-2 !text-[11px]" data-act="delete" data-id="${esc(r.id)}">Delete</button>
      </div>
    </article>`).join('');
}

[$('#search'), $('#f-status'), $('#f-dept'), $('#f-from'), $('#f-to')]
  .forEach(el => el.addEventListener('input', () => { page = 1; render(); }));
$('#btn-today').addEventListener('click', () => {
  const t = isoOf(new Date());
  $('#f-from').value = t; $('#f-to').value = t; page = 1; render();
});
$('#btn-dates-clear').addEventListener('click', () => {
  $('#f-from').value = ''; $('#f-to').value = ''; page = 1; render();
});
$('#btn-reload').addEventListener('click', load);

/* ── how the app looks ─────────────────────────────────────────────────
   The logo and the name are kept in the sheet, not in the code, so the app
   can be rebranded from this page without a redeploy. This is the only page
   that writes them; every other page just reads. */
const LOGO_LIMIT = 44000;                  // the cell holds 45,000; leave room
let brand = { logo: '', appName: '', logoPos: 'left' };

/** A logo small enough for a cell. PNG first, so a cut-out stays cut out. */
function encodeLogo(img) {
  const steps = [[256, 'image/png', 1], [192, 'image/png', 1], [256, 'image/jpeg', .85], [160, 'image/jpeg', .7]];
  let out = '';
  for (const [max, type, q] of steps) {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL(type, q);
    if (out.length <= LOGO_LIMIT) return out;
  }
  return out;
}

function paintBrand(s) {
  const badge = $('#brand-badge'), name = $('#brand-name');
  const row = $('#brand') && $('#brand').parentElement;
  if (badge) badge.innerHTML = s.logo ? `<img src="${s.logo}" alt="" />` : 'K';
  if (name && s.appName) name.textContent = s.appName;
  if (row) row.classList.toggle('brand-center', s.logoPos === 'center');
}

/** The panel's own controls, which are not the header. */
function paintPanel() {
  $('#logo-preview').innerHTML = brand.logo ? `<img src="${brand.logo}" alt="" class="h-full w-full object-contain" />` : 'none';
  $('#set-name').value = brand.appName || '';
  $$('#pos-group button').forEach(b => b.classList.toggle('is-on', b.dataset.pos === (brand.logoPos || 'left')));
}

async function loadBrand() {
  try {
    const { settings } = await call({ action: 'settings' });
    brand = Object.assign({ logo: '', appName: '', logoPos: 'left' }, settings || {});
    paintBrand(brand); paintPanel();
  } catch (ignore) {
    /* the app has its own badge to fall back on */
  }
}

$('#logo-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const img = new Image();
  img.onload = () => {
    brand.logo = encodeLogo(img);
    URL.revokeObjectURL(img.src);
    e.target.value = '';                   // so the same file can be picked again
    if (brand.logo.length > LOGO_LIMIT) {
      brand.logo = '';
      return toast('That picture will not shrink enough — try a smaller one.', 'err', 5000);
    }
    paintPanel();
    toast('Logo ready. Press Save appearance to keep it.');
  };
  img.onerror = () => toast('That file could not be read as a picture.', 'err');
  img.src = URL.createObjectURL(file);
});

$('#logo-clear').addEventListener('click', () => { brand.logo = ''; paintPanel(); });
$('#pos-group').addEventListener('click', e => {
  const b = e.target.closest('[data-pos]'); if (!b) return;
  brand.logoPos = b.dataset.pos; paintPanel();
});

$('#brand-save').addEventListener('click', async () => {
  const btn = $('#brand-save');
  btn.disabled = true; $('#brand-state').textContent = 'Saving…';
  try {
    const { settings } = await call({
      action: 'saveSettings',
      settings: { logo: brand.logo, appName: $('#set-name').value.trim(), logoPos: brand.logoPos || 'left' }
    });
    brand = Object.assign({ logo: '', appName: '', logoPos: 'left' }, settings || {});
    paintBrand(brand); paintPanel();
    $('#brand-state').textContent = 'Saved';
    toast('Appearance saved.');
  } catch (err) {
    $('#brand-state').textContent = '';
    toast('Could not save: ' + err.message, 'err', 5000);
  } finally {
    btn.disabled = false;
    setTimeout(() => { $('#brand-state').textContent = ''; }, 2500);
  }
});

/* ── notifications ─────────────────────────────────────────────────────
   Firebase Cloud Messaging. Each phone turns alerts on for itself: it asks
   permission, registers the push worker, gets a token from Firebase and
   hands it to the script, which sends every new request to all such tokens.
   An already-on phone re-sends its token on each visit, because Firebase
   rotates them now and then and a stale one would quietly stop ringing. */
const PUSH_SW = 'firebase-messaging-sw.js';
let push = { configured: false, devices: 0 };       // what the script knows
let myToken = '', messaging = null;

const fbReady = () => !!(window.firebase && self.FIREBASE_CONFIG && self.FIREBASE_CONFIG.apiKey && self.FIREBASE_VAPID_KEY);
const pageUrl = () => location.href.split(/[?#]/)[0];

function fbMessaging() {
  if (!messaging) {
    if (!firebase.apps.length) firebase.initializeApp(self.FIREBASE_CONFIG);
    messaging = firebase.messaging();
    // with the app open the worker stays quiet, so say it here instead
    messaging.onMessage(p => {
      toast((p.notification && p.notification.title) || 'New request', 'ok', 5000);
      load();
    });
  }
  return messaging;
}

/** Why this phone cannot take pushes, or '' when it can. */
async function pushBlocker() {
  if (!fbReady()) return 'Firebase is not set up in firebase-config.js yet.';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ios && !standalone) return 'On iPhone, add this page to the Home Screen and open it from there.';
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !(await firebase.messaging.isSupported())) {
    return 'This browser cannot receive push alerts.';
  }
  if (Notification.permission === 'denied') return 'Alerts are blocked for this site — allow them in the browser settings, then reload.';
  return '';
}

async function pushReg() {
  const reg = await navigator.serviceWorker.getRegistration();
  const w = reg && (reg.active || reg.waiting || reg.installing);
  return w && w.scriptURL.indexOf(PUSH_SW) !== -1 ? reg : null;
}

async function tokenFor(reg) {
  await navigator.serviceWorker.ready;
  return fbMessaging().getToken({ vapidKey: self.FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg });
}

function paintPush(blocker) {
  const n = push.devices || 0;
  const many = `${n} phone${n === 1 ? '' : 's'} receive alerts.`;
  let text;
  if (blocker) text = blocker;
  else if (!push.configured) text = 'Firebase is not set up in Apps Script yet — FCM_SERVICE_ACCOUNT is missing.';
  else if (myToken) text = `✅ On for this phone. ${many}`;
  else text = `Off for this phone. ${many}`;
  $('#push-status').textContent = text;
  $('#push-on').hidden = !!(blocker || myToken || !push.configured);
  $('#push-off').hidden = !myToken;
  $('#push-test').hidden = !push.configured || !n;
}

async function loadPush() {
  try { push = await call({ action: 'notify' }); } catch (ignore) { /* an older script: shown as not set up */ }
  let blocker;
  try { blocker = await pushBlocker(); } catch (err) { blocker = 'This browser cannot receive push alerts.'; }
  if (!blocker && push.configured && Notification.permission === 'granted') {
    try {
      const reg = await pushReg();
      if (reg) {
        myToken = await tokenFor(reg);
        push = await call({ action: 'saveToken', token: myToken, click: pageUrl() });
      }
    } catch (ignore) { /* shown as off; turning it on again will say why */ }
  }
  paintPush(blocker);
}

$('#push-on').addEventListener('click', async () => {
  const btn = $('#push-on');
  btn.disabled = true; $('#push-state').textContent = 'Turning on…';
  try {
    // ask first, straight from the tap: iPhone refuses a prompt that is not
    if (await Notification.requestPermission() !== 'granted') throw new Error('Alerts were not allowed');
    const reg = await navigator.serviceWorker.register(PUSH_SW);
    myToken = await tokenFor(reg);
    push = await call({ action: 'saveToken', token: myToken, click: pageUrl() });
    toast('Alerts on for this phone. Press Send test to try it.');
  } catch (err) {
    myToken = '';
    toast('Could not turn on: ' + err.message, 'err', 6000);
  } finally {
    btn.disabled = false; $('#push-state').textContent = '';
    paintPush(await pushBlocker().catch(() => ''));
  }
});

$('#push-off').addEventListener('click', async () => {
  const btn = $('#push-off');
  btn.disabled = true; $('#push-state').textContent = 'Turning off…';
  try {
    push = await call({ action: 'dropToken', token: myToken });
    try { await fbMessaging().deleteToken(); } catch (ignore) {}
    const reg = await pushReg();
    if (reg) await reg.unregister();
    myToken = '';
    toast('Alerts off for this phone.');
  } catch (err) {
    toast('Could not turn off: ' + err.message, 'err', 5000);
  } finally {
    btn.disabled = false; $('#push-state').textContent = '';
    paintPush('');
  }
});

$('#push-test').addEventListener('click', async () => {
  const btn = $('#push-test');
  btn.disabled = true; $('#push-state').textContent = 'Sending…';
  try {
    const d = await call({ action: 'testNotify' });
    $('#push-state').textContent = `Sent to ${d.sent}` + (d.failed ? `, ${d.failed} unreachable` : '');
    toast('Test sent — check the phone.');
  } catch (err) {
    $('#push-state').textContent = '';
    toast('Test failed: ' + err.message, 'err', 6000);
  } finally { btn.disabled = false; }
});

/* ── install to home screen ────────────────────────────────────────────
   Chrome on Android offers this itself; the button only shows when it has.
   iPhone has no such event — there it is Share → Add to Home Screen. */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installEvt = e;
  $('#btn-install').hidden = false; $('#install-hint').hidden = true;
});
$('#btn-install').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => {});
  installEvt = null; $('#btn-install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#btn-install').hidden = true; });
// already opened from the home screen: nothing left to offer
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
  $('#btn-install').closest('div').style.display = 'none';   // .flex would beat [hidden]
}

/* ── edit + delete ─────────────────────────────────────────────────── */
$('#list').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const row = rows.find(r => r.id === b.dataset.id); if (!row) return;
  if (b.dataset.act === 'edit') return openEdit(row);

  if (!confirm(`Delete ${row.ticket} — ${row.name}?\n\nThis removes the row from the Google Sheet for everyone. It cannot be undone.`)) return;
  b.disabled = true;
  try {
    await call({ action: 'delete', id: row.id });
    rows = rows.filter(r => r.id !== row.id);
    $('#count').textContent = rows.length;
    render();
    toast(`Deleted ${row.ticket}`);
  } catch (err) {
    b.disabled = false;
    toast('Delete failed: ' + err.message, 'err', 5000);
  }
});

/* A row may carry a department typed in by hand, so the current value is
   always offered even when it is not one of the standard ones. */
const opts = (arr, val) => {
  const list = val && arr.indexOf(val) === -1 ? [val].concat(arr) : arr;
  return list.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('');
};

async function openEdit(r) {
  if ((r.hasSignature || r.hasPhoto) && !r.signature && !r.photo) {
    await fetchMedia([r.id]);
    applyMedia([r]);
  }
  $('#modal-card').innerHTML = `
    <div class="mb-4 flex items-start justify-between gap-3">
      <div>
        <p class="font-mono text-[11px] font-semibold text-neon">${esc(r.ticket)}</p>
        <h3 class="mt-1 font-display text-xl font-bold">Edit entry</h3>
      </div>
      <button data-act="close" class="icon-btn">✕</button>
    </div>

    <form id="edit-form" class="space-y-3">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="fl"><input name="date" type="date" value="${esc(r.date)}" class="input" /><span class="fl-label fl-static">Date</span></label>
        <label class="fl"><input name="time" type="time" value="${esc(r.time)}" class="input" /><span class="fl-label fl-static">Time</span></label>
      </div>
      <label class="fl block"><input name="name" value="${esc(r.name)}" placeholder=" " class="input peer" /><span class="fl-label">Name</span></label>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="fl"><select name="department" class="input">${opts(DEPARTMENTS, r.department)}</select><span class="fl-label fl-static">Department</span></label>
        <label class="fl"><select name="category" class="input">${opts(CATEGORIES, r.category)}</select><span class="fl-label fl-static">Category</span></label>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="fl"><select name="priority" class="input">${opts(PRIORITIES, r.priority)}</select><span class="fl-label fl-static">Priority</span></label>
        <label class="fl"><select name="status" class="input">${opts(STATUSES, r.status)}</select><span class="fl-label fl-static">Status</span></label>
      </div>
      <label class="fl block"><textarea name="request" rows="4" placeholder=" " class="input peer">${esc(r.request)}</textarea><span class="fl-label">Request</span></label>
      <label class="fl block"><textarea name="resolution" rows="3" maxlength="2000" placeholder=" " class="input peer">${esc(r.resolution || '')}</textarea><span class="fl-label">Resolution — what IT did</span></label>

      ${r.photo ? `<div><p class="mb-1 text-[11px] uppercase tracking-wider text-muted">Photo</p><img src="${r.photo}" alt="" class="w-full rounded-xl border border-line" /></div>` : ''}
      ${r.signature ? `<div><p class="mb-1 text-[11px] uppercase tracking-wider text-muted">Signature</p><img src="${r.signature}" alt="" class="w-full rounded-xl border border-line bg-white" /></div>` : ''}
      <p class="text-[11px] text-muted">Signature, photo and the job clock are kept as they are — an edit never rewrites them. Times are stamped on the <a href="it.html" class="text-neon underline">IT Desk</a>.</p>

      <div class="flex gap-2 pt-1">
        <button type="submit" class="btn-primary flex-1 !py-2.5">Save to sheet</button>
        <button type="button" data-act="close" class="btn-ghost !py-2.5">Cancel</button>
      </div>
    </form>`;
  $('#modal').classList.add('is-open');
  $('#modal').dataset.id = r.id;

  $('#edit-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target, btn = f.querySelector('button[type=submit]');
    const patch = {
      date: f.date.value, time: f.time.value,
      name: f.name.value.trim(),
      department: f.department.value, category: f.category.value,
      priority: f.priority.value, status: f.status.value, request: f.request.value.trim(),
      resolution: f.resolution.value.trim()
    };
    if (!patch.name || !patch.request) return toast('Name and request cannot be empty.', 'err');

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      // send the whole row back, minus the images: the script keeps those
      await call({ action: 'update', entry: Object.assign({}, r, patch, { signature: '', photo: '' }) });
      Object.assign(r, patch);
      render(); closeModal();
      toast(`Saved ${r.ticket}`);
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Save to sheet';
      toast('Save failed: ' + err.message, 'err', 5000);
    }
  });
}

function closeModal() { $('#modal').classList.remove('is-open'); }
$('#modal').addEventListener('click', e => {
  if (e.target === $('#modal') || e.target.closest('[data-act="close"]')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });


/* ── live updates ──────────────────────────────────────────────────────
   Apps Script cannot push, so this polls — but only a tiny revision marker,
   and only while the tab is on screen. The full list is fetched just when
   that marker moves, which keeps the script's daily quota intact. A slower
   full refresh also runs, to catch edits typed straight into the sheet. */
let rev = null, polling = false;

async function pollRev() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    const d = await call({ action: 'rev' });
    if (rev === null) rev = d.rev;
    else if (d.rev !== rev) { rev = d.rev; await load(); }
  } catch (ignore) {
    /* a failed poll is not worth telling anyone about */
  } finally { polling = false; }
}

setInterval(pollRev, 15000);
setInterval(() => { if (!document.hidden) load(); }, 300000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollRev(); });

/* ── boot ──────────────────────────────────────────────────────────── */
loadBrand();
loadPush();
load();
})();
