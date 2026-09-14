/* ══════════════════════════════════════════════════════════════════════
   KSL Digital Log Book — IT Desk
   The work queue. A task starts when the request is filed and stops when
   someone here presses Finish; the sheet keeps the clock, so the elapsed
   time is the same on every screen.
   ════════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzA9VCYE6btfC8hlbblRBepxCfendnU-oi8olLrE3VSbNlfnTPuTeqgd2KrCTWCZRjJTg/exec';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Drawn marks rather than emoji: they take the surrounding colour and stay
   crisp at any size, and every platform renders them identically. */
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" class="inline-block h-[14px] w-[14px] align-[-2px]"><path d="M4 13.5 9.8 19.5 20 5"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" class="inline-block h-[13px] w-[13px] align-[-2px]"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.4l3.3 2"/></svg>';
const PRI_COLOR = { Low: 'var(--c-aqua)', Medium: 'var(--c-blue)', High: 'var(--c-orange)', Critical: 'var(--c-red)' };
const PRI_RANK  = { Critical: 0, High: 1, Medium: 2, Low: 3 };

let rows = [], tab = 'open';

const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function humanDur(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return 'under a minute';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
const isDone = r => !!(r.finishedAt || r.duration || r.status === 'Resolved');

/* ── chrome ────────────────────────────────────────────────────────── */
function toast(msg, kind = 'ok', ms = 3400) {
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
  const colors = ['#16b98a', '#5b53e8', '#ff7a59', '#eda100'];
  const bits = [...Array(50)].map(() => ({
    x: innerWidth / 2 + (Math.random() - .5) * 140, y: innerHeight * .6,
    vx: (Math.random() - .5) * 10, vy: -Math.random() * 14 - 5,
    r: Math.random() * 5 + 3, spin: (Math.random() - .5) * .3,
    a: Math.random() * Math.PI, c: colors[(Math.random() * colors.length) | 0]
  }));
  let n = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    bits.forEach(b => {
      b.vy += .42; b.x += b.vx; b.y += b.vy; b.a += b.spin;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
      ctx.fillStyle = b.c; ctx.globalAlpha = Math.max(0, 1 - n / 80);
      ctx.fillRect(-b.r, -b.r * .6, b.r * 2, b.r * 1.2);
      ctx.restore();
    });
    if (++n < 80) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

/* ── the sheet ─────────────────────────────────────────────────────── */
async function call(payload) {
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
async function load(loud) {
  if (loading) return;
  loading = true;
  $('#state').textContent = 'Loading…';
  $('#btn-reload svg').classList.add('spin');
  try {
    const data = await call({ action: 'list' });
    rows = (data.rows || []).slice().reverse();
    const keep = $('#f-dept').value;
    const depts = [...new Set(rows.map(r => r.department).filter(Boolean))].sort();
    $('#f-dept').innerHTML = '<option value="">All departments</option>' +
      depts.map(d => `<option${d === keep ? ' selected' : ''}>${esc(d)}</option>`).join('');
    $('#state').textContent = `Loaded ${rows.length}`;
    render(); renderStats();
    if (loud) toast(`Loaded ${rows.length} entries.`);
  } catch (err) {
    $('#state').textContent = '';
    toast('Cannot reach the sheet: ' + err.message, 'err', 5000);
  } finally {
    loading = false; $('#btn-reload svg').classList.remove('spin');
  }
}
$('#btn-reload').addEventListener('click', () => load(true));

/* ── stats ─────────────────────────────────────────────────────────── */
function renderStats() {
  const open = rows.filter(r => !isDone(r));
  const today = isoOf(new Date());
  const doneToday = rows.filter(r => isDone(r) && r.finishedAt && r.finishedAt.slice(0, 10) === today);

  $('#s-open').textContent = open.length;
  $('#open-count').textContent = open.length;
  $('#s-done').textContent = doneToday.length;
  $('#s-open').style.color = 'var(--c-orange)';
  $('#s-done').style.color = 'var(--c-aqua)';

  const spans = doneToday
    .filter(r => r.startedAt && r.finishedAt)
    .map(r => Date.parse(r.finishedAt) - Date.parse(r.startedAt))
    .filter(n => n >= 0);
  $('#s-avg').textContent = spans.length ? humanDur(spans.reduce((a, b) => a + b, 0) / spans.length) : '—';
  $('#s-avg').style.fontSize = spans.length ? '1.5rem' : '2.35rem';
}

/* ── list ──────────────────────────────────────────────────────────── */
$('#tab-group').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  $$('#tab-group button').forEach(x => x.classList.toggle('is-on', x === b));
  tab = b.dataset.tab; render(); buzz();
});
[$('#search'), $('#f-dept')].forEach(el => el.addEventListener('input', render));

function visible() {
  const q = $('#search').value.trim().toLowerCase();
  const dp = $('#f-dept').value;
  return rows
    .filter(r => tab === 'all' || (tab === 'open' ? !isDone(r) : isDone(r)))
    .filter(r => !dp || r.department === dp)
    .filter(r => !q || [r.ticket, r.name, r.department, r.request, r.category].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (PRI_RANK[a.priority] ?? 9) - (PRI_RANK[b.priority] ?? 9));
}

function render() {
  const list = visible();
  $('#empty').classList.toggle('hidden', list.length > 0);
  $('#list').innerHTML = list.map((r, i) => {
    const done = isDone(r);
    return `
    <article class="entry !cursor-default" data-id="${esc(r.id)}" style="--pri-c:${PRI_COLOR[r.priority] || 'var(--accent)'};animation-delay:${Math.min(i * 25, 240)}ms">
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-[11px] font-semibold text-neon">${esc(r.ticket)}</span>
            <span class="text-[11px] font-semibold" style="color:${PRI_COLOR[r.priority]}">${esc(r.priority)}</span>
            <span class="text-[11px] text-muted">${esc(r.category)}</span>
          </div>
          <h4 class="mt-1 truncate font-display text-[15px] font-semibold">${esc(r.name)} <span class="text-muted">· ${esc(r.department)}</span></h4>
          <p class="mt-1 text-[13px] text-subink">${esc(r.request)}</p>
          <p class="mt-2 font-mono text-[11px] text-muted">filed ${esc(r.date)} ${esc(r.time)}${r.timeOut ? ` · started ${esc(r.timeOut)}` : ''}${r.timeReturned ? ` · finished ${esc(r.timeReturned)}` : ''}</p>
        </div>
        ${r.signature ? `<img src="${r.signature}" alt="signature" class="h-11 w-20 shrink-0 rounded-md border border-line bg-white object-contain" />` : ''}
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-3">
        ${done
          ? `<span class="pill st-resolved">${TICK} Done in ${esc(r.duration || (r.startedAt && r.finishedAt ? humanDur(Date.parse(r.finishedAt) - Date.parse(r.startedAt)) : '—'))}</span>`
          : `<span class="tick font-mono text-[13px] font-semibold" style="color:var(--c-orange)" data-started="${esc(r.startedAt || '')}">⏱ ${r.startedAt ? esc(humanDur(Date.now() - Date.parse(r.startedAt))) : 'no start time'}</span>
             <button class="btn-primary ml-auto !py-2 !px-4 !text-[14px]" data-act="finish" data-id="${esc(r.id)}">Finish ${TICK}</button>`}
      </div>
    </article>`;
  }).join('');
}

/* Tick the running jobs once a minute — the number is minute-resolution,
   so a faster timer would only burn battery. */
setInterval(() => {
  $$('.tick').forEach(el => {
    const t = el.dataset.started; if (!t) return;
    el.innerHTML = CLOCK + ' ' + humanDur(Date.now() - Date.parse(t));
  });
}, 30000);

/* ── finish a job ──────────────────────────────────────────────────── */
$('#list').addEventListener('click', async e => {
  const b = e.target.closest('[data-act="finish"]'); if (!b) return;
  const r = rows.find(x => x.id === b.dataset.id); if (!r) return;
  if (!confirm(`Finish ${r.ticket} — ${r.name}?\n\nThe time is stamped now and the job is marked Resolved.`)) return;

  b.disabled = true; b.textContent = 'Finishing…';
  try {
    const res = await call({ action: 'finish', id: r.id });
    Object.assign(r, {
      status: 'Resolved', timeReturned: res.timeReturned,
      duration: res.duration, finishedAt: res.finishedAt
    });
    buzz([18, 40, 18]); celebrate();
    toast(`${r.ticket} done in ${res.duration}`);
    render(); renderStats();
  } catch (err) {
    b.disabled = false; b.innerHTML = 'Finish ' + TICK;
    toast('Could not finish: ' + err.message, 'err', 5000);
  }
});


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
if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString(); }, 1000);
load();
})();
