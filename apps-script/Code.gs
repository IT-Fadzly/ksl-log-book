/**
 * KSL Digital Log Book — Google Sheets backend
 * ---------------------------------------------------------------------
 * Paste this into  Extensions → Apps Script  ON THE SHEET ITSELF (that
 * makes the script "bound" to the sheet, which is what keeps the
 * permission request down to a single, narrow scope), then
 * Deploy → New deployment → Web app  (Execute as: Me, Access: Anyone).
 * Copy the /exec URL into the app's "Sheet" tab.
 *
 * Permissions: ONE scope — spreadsheets.currentonly, i.e. "this
 * spreadsheet, nothing else". No Drive access, no access to your other
 * files. You grant it once; people using the app never see a prompt.
 *
 * Actions accepted on POST (body is JSON sent as text/plain):
 *   {action:'ping'}                    → connection test
 *   {action:'append', entry:{...}}     → add a row (idempotent by entry.id)
 *   {action:'update', entry:{...}}     → update the row with that id
 *   {action:'list'}                    → return the most recent rows
 *   {action:'rev'}                     → a revision marker, for cheap polling
 *
 * Live updates: clients poll 'rev' every 15-30s and pull the full list only
 * when it moves. onEdit keeps that marker honest when a person types into the
 * sheet directly. onChange is optional — add it under Triggers to catch rows
 * inserted or deleted by hand.
 *   {action:'finish', id:'...'}        → stamp the finish time and duration
 *   {action:'delete', id:'...'}        → remove a row and its pictures
 *
 * 'update' and 'delete' are the admin actions. Set ADMIN_KEY below and they
 * require it; 'append' and 'list' stay open so the log book itself works.
 */

var TAB_NAME = 'Log Book';
var SECRET    = '';                        // set a string here + in the app to lock it down
var ADMIN_KEY = '';                        // set a passphrase to gate edit + delete
var MAX_LIST = 300;
var IMAGES   = true;                       // false = store "(signed)" text instead of the image

var HEADERS = [
  'Entry ID', 'Ticket', 'Date', 'Time', 'Name', 'Department', 'Category',
  'Priority', 'Request', 'Status', 'Signature', 'Photo', 'Device', 'Created',
  'Synced At', 'Signature Data', 'Photo Data', 'Time Out', 'Time Returned',
  'Duration', 'Started At', 'Finished At'
];
var COL_SIGNATURE = 11;
var COL_PHOTO     = 12;
var COL_SIG_DATA   = 16;     /* hidden: the signature as a data URL, so other
                                devices can read it back - an inserted picture
                                cannot be read by the API, only written */
var COL_PHOTO_DATA = 17;     /* hidden: same idea for the photo */
var CELL_LIMIT    = 45000;   /* a cell holds 50,000 chars; leave headroom */

/* The clock is kept by this script, not by the phone: a task starts when the
   row is appended and stops when 'finish' arrives, so every duration is
   measured on one clock no matter whose device filed it. */
var COL_STATUS    = 10;
var COL_TIME_OUT  = 18;
var COL_TIME_BACK = 19;
var COL_DURATION  = 20;
var COL_STARTED   = 21;
var COL_FINISHED  = 22;

/* New columns are appended, never inserted: the row layout is addressed by
   position, so moving a column would misread every existing row. */

/* ── entry points ──────────────────────────────────────────────────── */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (SECRET && body.secret !== SECRET) return reply({ ok: false, error: 'Bad secret' });

    var admin = ['update', 'delete'].indexOf(body.action) !== -1;
    if (admin && ADMIN_KEY && body.key !== ADMIN_KEY) {
      return reply({ ok: false, error: 'Admin key required' });
    }

    switch (body.action) {
      case 'ping':   return reply(ping_());
      case 'append': return reply(append_(body.entry));
      case 'update': return reply(update_(body.entry));
      case 'finish': return reply(finish_(body.id));
      case 'delete': return reply(delete_(body.id));
      case 'list':   return reply(list_());
      case 'rev':    return reply(rev_());
      default:       return reply({ ok: false, error: 'Unknown action: ' + body.action });
    }
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** Opening the /exec URL in a browser shows a health check. */
function doGet() {
  return reply(ping_());
}

/* ── actions ───────────────────────────────────────────────────────── */

/**
 * A marker that changes whenever a row does. Clients poll this instead of
 * re-downloading the whole log book: it touches script properties only, never
 * the spreadsheet, so it costs almost no execution time.
 */
function rev_() {
  var p = PropertiesService.getScriptProperties();
  return { ok: true, rev: p.getProperty('rev') || '0' };
}

/**
 * Typing straight into the sheet has to count as a change too, otherwise the
 * app would only notice edits it made itself. This is a simple trigger: it
 * runs on every manual edit, with no installation step.
 */
function onEdit(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() !== TAB_NAME) return;
    bump_();
  } catch (ignore) {}
}

/** Fires on structural changes — rows inserted or removed by hand. */
function onChange(e) {
  bump_();
}

/** Called after anything that changes a row. */
function bump_() {
  try {
    PropertiesService.getScriptProperties().setProperty('rev', String(Date.now()));
  } catch (ignore) {}
}

function ping_() {
  var s = sheet_();
  return { ok: true, sheet: s.getParent().getName(), tab: s.getName(), rows: Math.max(0, s.getLastRow() - 1) };
}

function append_(entry) {
  if (!entry || !entry.id) return { ok: false, error: 'entry.id is required' };
  var s = sheet_();
  if (findRow_(s, entry.id)) return update_(entry);      // already there → treat as an update

  var now = new Date();
  entry.startedAt = now;                                 // server clock, not the phone's
  entry.timeOut = fmtTime_(now);

  s.appendRow(toRow_(entry));
  var row = s.getLastRow();
  attach_(s, row, entry);
  bump_();
  return { ok: true, row: row, id: entry.id, timeOut: entry.timeOut, startedAt: now.toISOString() };
}

function update_(entry) {
  if (!entry || !entry.id) return { ok: false, error: 'entry.id is required' };
  var s = sheet_();
  var row = findRow_(s, entry.id);
  if (!row) return append_(entry);

  var existing = s.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  s.getRange(row, 1, 1, HEADERS.length).setValues([toRow_(entry, existing)]);
  attach_(s, row, entry);
  bump_();
  return { ok: true, row: row, id: entry.id };
}

/** Stop the clock on a task: finish time, duration, and status Resolved. */
function finish_(id) {
  if (!id) return { ok: false, error: 'id is required' };
  var s = sheet_();
  var row = findRow_(s, id);
  if (!row) return { ok: false, error: 'Not found: ' + id };

  var vals = s.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  if (vals[COL_FINISHED - 1]) return { ok: false, error: 'This task is already finished' };

  var started = vals[COL_STARTED - 1] ? new Date(vals[COL_STARTED - 1]) : null;
  var now = new Date();
  var dur = started ? humanDur_(now.getTime() - started.getTime()) : '';

  s.getRange(row, COL_TIME_BACK).setValue(fmtTime_(now));
  s.getRange(row, COL_DURATION).setValue(dur);
  s.getRange(row, COL_FINISHED).setValue(now);
  s.getRange(row, COL_STATUS).setValue('Resolved');

  bump_();
  return {
    ok: true, id: id, row: row,
    timeReturned: fmtTime_(now), duration: dur, finishedAt: now.toISOString(), status: 'Resolved'
  };
}

/** 5_700_000 ms -> "1h 35m". Anything under a minute reads as "just now". */
function humanDur_(ms) {
  var mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return 'under a minute';
  var d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d) return d + 'd ' + h + 'h';
  if (h) return h + 'h ' + m + 'm';
  return m + 'm';
}

/** Remove a row and any pictures anchored to it. */
function delete_(id) {
  if (!id) return { ok: false, error: 'id is required' };
  var s = sheet_();
  var row = findRow_(s, id);
  if (!row) return { ok: false, error: 'Not found: ' + id };

  try {
    var imgs = s.getImages();
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].getAnchorCell().getRow() === row) imgs[i].remove();
    }
  } catch (ignore) {}                       // a stuck picture must not block the delete

  s.deleteRow(row);
  bump_();
  return { ok: true, deleted: id, row: row };
}

function list_() {
  var s = sheet_();
  var last = s.getLastRow();
  if (last < 2) return { ok: true, rows: [] };

  var start = Math.max(2, last - MAX_LIST + 1);
  var values = s.getRange(start, 1, last - start + 1, HEADERS.length).getValues();

  // One malformed cell must not cost the whole listing, so each row is
  // mapped defensively and a row that still fails is skipped.
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    try {
      var r = values[i];
      if (!r[0]) continue;
      rows.push({
        id: String(r[0]), ticket: String(r[1]),
        date: fmtDate_(r[2]), time: fmtTime_(r[3]),
        name: String(r[4]), department: String(r[5]), category: String(r[6]),
        priority: String(r[7]), request: String(r[8]), status: String(r[9]) || 'Open',
        signature: String(r[15] || ''),                // readable copies - the pictures
        photo: String(r[16] || ''),                    // in the cells cannot be read back
        timeOut: fmtTime_(r[17]), timeReturned: fmtTime_(r[18]),
        duration: String(r[19] || ''),
        startedAt: iso_(r[20]), finishedAt: iso_(r[21]),
        device: String(r[12]), created: iso_(r[13])
      });
    } catch (ignore) {}
  }

  return { ok: true, rows: rows };
}

/* ── helpers ───────────────────────────────────────────────────────── */

/**
 * The bound spreadsheet. Using getActive() (rather than openById) is what
 * limits this script to the spreadsheets.currentonly scope — so it can
 * never touch any other file of yours.
 */
function sheet_() {
  var ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Open this script from the sheet: Extensions → Apps Script');

  var s = ss.getSheetByName(TAB_NAME) || ss.insertSheet(TAB_NAME);

  // Make sure the grid is wide enough before writing to the last column.
  if (s.getMaxColumns() < HEADERS.length) {
    s.insertColumnsAfter(s.getMaxColumns(), HEADERS.length - s.getMaxColumns());
  }

  // Write the header row on a new sheet, and extend it on an existing one
  // when a column has been added since it was created.
  var head = s.getLastRow() ? s.getRange(1, 1, 1, HEADERS.length).getValues()[0] : [];
  if (head[0] !== HEADERS[0] || head[HEADERS.length - 1] !== HEADERS[HEADERS.length - 1]) {
    s.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#0e1424').setFontColor('#e7eefc');
    s.setFrozenRows(1);
    s.setColumnWidth(9, 340);                          // Request
    s.setColumnWidth(COL_SIGNATURE, 190);
    s.setColumnWidth(COL_PHOTO, 190);
    s.hideColumns(COL_SIG_DATA, 2);                    // machine-readable, not for humans
    s.hideColumns(COL_STARTED, 2);                     // exact stamps; the sheet shows HH:mm
  }
  return s;
}

function findRow_(s, id) {
  var last = s.getLastRow();
  if (last < 2) return 0;
  var ids = s.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function toRow_(entry, existing) {
  existing = existing || [];
  return [
    entry.id,
    entry.ticket || '',
    entry.date || '',
    entry.time || '',
    entry.name || '',
    entry.department || '',
    entry.category || '',
    entry.priority || '',
    entry.request || '',
    entry.status || 'Open',
    entry.signature ? 'signed' : (existing[10] || ''),
    entry.photo     ? 'photo'  : (existing[11] || ''),
    entry.device || '',
    safeDate_(entry.created),
    new Date(),
    entry.signature && entry.signature.length <= CELL_LIMIT ? entry.signature : (existing[15] || ''),
    entry.photo     && entry.photo.length     <= CELL_LIMIT ? entry.photo     : (existing[16] || ''),
    entry.timeOut      || existing[17] || '',
    entry.timeReturned || existing[18] || '',
    entry.duration     || existing[19] || '',
    entry.startedAt    || existing[20] || '',
    entry.finishedAt   || existing[21] || ''
  ];
}

/**
 * Drop the signature (and photo) into the row as pictures.
 * insertImage takes the bytes directly, so no Drive permission is needed.
 * Any failure here is swallowed: a missing picture must never cost you the row.
 */
function attach_(s, row, entry) {
  if (!IMAGES) return;
  placeImage_(s, row, COL_SIGNATURE, entry.signature, 150, 56);
  placeImage_(s, row, COL_PHOTO,     entry.photo,     150, 110);
}

function placeImage_(s, row, col, dataUrl, w, h) {
  if (!dataUrl) return;
  try {
    var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) return;
    var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'attachment');
    s.setRowHeight(row, Math.max(s.getRowHeight(row), h + 10));
    s.insertImage(blob, col, row, 4, 4).setWidth(w).setHeight(h);
  } catch (err) {
    s.getRange(row, col).setNote('Image could not be embedded: ' + err);
  }
}

/** A usable Date: the value if it parses, otherwise now. */
function safeDate_(v) {
  var d = v ? new Date(v) : null;
  return (d && !isNaN(d.getTime())) ? d : new Date();
}

/** An ISO string, or '' for anything that is not a real date. */
function iso_(v) {
  if (!v) return '';
  var d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '');
}

function fmtTime_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  return String(v || '');
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Run this once from the editor to approve the single scope, then deploy. */
function setup() {
  var s = sheet_();
  Logger.log('Ready: %s / %s', s.getParent().getName(), s.getName());
}
