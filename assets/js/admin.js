/* ══════════════════════════════════════════════════════════════════════
   KSL Digital Log Book — admin console
   Edits and deletes go straight to the Google Sheet. The log book app
   itself is read-only; this page is the only place rows can change.
   ════════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzA9VCYE6btfC8hlbblRBepxCfendnU-oi8olLrE3VSbNlfnTPuTeqgd2KrCTWCZRjJTg/exec';
const KEY_STORE = 'ksl_admin_key';
const DB_KEY = 'ksl_logbook_v1';           // the app's local copy, kept in step

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DEPARTMENTS = ['Finance', 'F&B', 'Sales', 'Kitchen', 'Marketing', 'Reservation',
                     'Front Office', 'Security', 'Onsen Spa', 'HR', 'Maintenance', 'Receiving'];
const CATEGORIES  = ['Hardware', 'Software', 'System', 'Network', 'Access', 'Maintenance', 'Other'];
const PRIORITIES  = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES    = ['Open', 'In Progress', 'Resolved'];
const PRI_COLOR   = { Low: 'var(--c-aqua)', Medium: 'var(--c-blue)', High: 'var(--c-orange)', Critical: 'var(--c-red)' };
const ST_CLASS    = { 'Open': 'st-open', 'In Progress': 'st-in-progress', 'Resolved': 'st-resolved' };

let rows = [], adminKey = '';

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
    adminKey = entered.trim();
    localStorage.setItem(KEY_STORE, adminKey);
    return call(payload, true);
  }

  if (!data.ok) throw new Error(data.error || 'Rejected');
  return data;
}

/* Keep the browser's own copy of the log book in step with an admin change,
   so this device does not show a stale row after an edit or delete. */
function patchLocal(id, updated) {
  try {
    const local = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
    const next = updated
      ? local.map(e => e.id === id ? Object.assign({}, e, updated) : e)
      : local.filter(e => e.id !== id);
    localStorage.setItem(DB_KEY, JSON.stringify(next));
  } catch {}
}

/* ── load + render ─────────────────────────────────────────────────── */
async function load() {
  $('#state').textContent = 'Loading…';
  try {
    const data = await call({ action: 'list' });
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

/* ── dashboard ─────────────────────────────────────────────────────────
   One series per chart, so no legend is needed except on the status stack,
   where the segments are value-labelled as well. Numbers come from the
   sheet, so every admin sees the same figures. */
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ST_COLOR = { 'Open': 'var(--c-yellow)', 'In Progress': 'var(--c-blue)', 'Resolved': 'var(--c-aqua)' };

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

function visible() {
  const q = $('#search').value.trim().toLowerCase();
  const st = $('#f-status').value, dp = $('#f-dept').value;
  return rows.filter(r =>
    (!st || r.status === st) && (!dp || r.department === dp) &&
    (!q || [r.ticket, r.name, r.department, r.request, r.category].join(' ').toLowerCase().includes(q))
  );
}

function render() {
  const list = visible();
  $('#empty').classList.toggle('hidden', list.length > 0);
  $('#list').innerHTML = list.map((r, i) => `
    <article class="entry !cursor-default" style="--pri-c:${PRI_COLOR[r.priority] || 'var(--accent)'};animation-delay:${Math.min(i * 25, 250)}ms">
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-[11px] font-semibold text-neon">${esc(r.ticket)}</span>
            <span class="pill ${ST_CLASS[r.status] || 'st-open'}"><span class="pill-dot"></span>${esc(r.status)}</span>
            <span class="text-[11px] text-muted">${esc(r.priority)} · ${esc(r.category)}</span>
          </div>
          <h4 class="mt-1 truncate font-display text-[15px] font-semibold">${esc(r.name)} <span class="text-muted">· ${esc(r.department)}</span></h4>
          <p class="mt-1 line-clamp-2 text-[13px] text-subink">${esc(r.request)}</p>
          <p class="mt-2 font-mono text-[11px] text-muted">${esc(r.date)} · ${esc(r.time)}</p>
        </div>
        ${r.signature ? `<img src="${r.signature}" alt="signature" class="h-12 w-20 shrink-0 rounded-md border border-line bg-white object-contain" />` : ''}
      </div>
      <div class="mt-3 flex gap-2">
        <button class="chip chip-ghost" data-act="edit" data-id="${esc(r.id)}">✏️ Edit</button>
        <button class="chip chip-danger" data-act="delete" data-id="${esc(r.id)}">🗑 Delete</button>
      </div>
    </article>`).join('');
}

[$('#search'), $('#f-status'), $('#f-dept')].forEach(el => el.addEventListener('input', render));
$('#btn-reload').addEventListener('click', load);

/* ── edit + delete ─────────────────────────────────────────────────── */
$('#list').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const row = rows.find(r => r.id === b.dataset.id); if (!row) return;
  if (b.dataset.act === 'edit') return openEdit(row);

  if (!confirm(`Delete ${row.ticket} — ${row.name}?\n\nThis removes the row from the Google Sheet for everyone. It cannot be undone.`)) return;
  b.disabled = true;
  try {
    await call({ action: 'delete', id: row.id });
    patchLocal(row.id, null);
    rows = rows.filter(r => r.id !== row.id);
    $('#count').textContent = rows.length;
    render();
    toast(`Deleted ${row.ticket}`);
  } catch (err) {
    b.disabled = false;
    toast('Delete failed: ' + err.message, 'err', 5000);
  }
});

const opts = (arr, val) => arr.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('');

function openEdit(r) {
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

      ${r.photo ? `<div><p class="mb-1 text-[11px] uppercase tracking-wider text-muted">Photo</p><img src="${r.photo}" alt="" class="w-full rounded-xl border border-line" /></div>` : ''}
      ${r.signature ? `<div><p class="mb-1 text-[11px] uppercase tracking-wider text-muted">Signature</p><img src="${r.signature}" alt="" class="w-full rounded-xl border border-line bg-white" /></div>` : ''}
      <p class="text-[11px] text-muted">The signature and photo are kept as they are — an edit never rewrites them.</p>

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
      date: f.date.value, time: f.time.value, name: f.name.value.trim(),
      department: f.department.value, category: f.category.value,
      priority: f.priority.value, status: f.status.value, request: f.request.value.trim()
    };
    if (!patch.name || !patch.request) return toast('Name and request cannot be empty.', 'err');

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      // send the whole row back, minus the images: the script keeps those
      await call({ action: 'update', entry: Object.assign({}, r, patch, { signature: '', photo: '' }) });
      Object.assign(r, patch);
      patchLocal(r.id, patch);
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

/* ── boot ──────────────────────────────────────────────────────────── */
adminKey = localStorage.getItem(KEY_STORE) || '';
load();
})();
