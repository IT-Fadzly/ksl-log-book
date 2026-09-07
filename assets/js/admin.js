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
async function call(payload) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ key: adminKey }, payload)),
    redirect: 'follow'
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error('Unexpected reply from Apps Script'); }
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

/* ── gate ──────────────────────────────────────────────────────────── */
$('#btn-unlock').addEventListener('click', unlock);
$('#admin-key').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });

async function unlock() {
  adminKey = $('#admin-key').value.trim();
  try {
    await call({ action: 'ping' });
    localStorage.setItem(KEY_STORE, adminKey);
    $('#gate').classList.add('hidden');
    $('#work').classList.remove('hidden');
    load();
  } catch (err) {
    toast('Could not reach the sheet: ' + err.message, 'err', 5000);
  }
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
  } catch (err) {
    $('#state').textContent = '';
    toast('Load failed: ' + err.message, 'err', 5000);
  }
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
const saved = localStorage.getItem(KEY_STORE);
if (saved !== null) { $('#admin-key').value = saved; unlock(); }
})();
