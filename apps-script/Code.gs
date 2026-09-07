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
 */

var TAB_NAME = 'Log Book';
var SECRET   = '';                         // set a string here + in the app to lock it down
var MAX_LIST = 300;
var IMAGES   = true;                       // false = store "(signed)" text instead of the image

var HEADERS = [
  'Entry ID', 'Ticket', 'Date', 'Time', 'Name', 'Department', 'Category',
  'Priority', 'Request', 'Status', 'Signature', 'Photo', 'Device', 'Created', 'Synced At'
];
var COL_SIGNATURE = 11;
var COL_PHOTO     = 12;

/* ── entry points ──────────────────────────────────────────────────── */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (SECRET && body.secret !== SECRET) return reply({ ok: false, error: 'Bad secret' });

    switch (body.action) {
      case 'ping':   return reply(ping_());
      case 'append': return reply(append_(body.entry));
      case 'update': return reply(update_(body.entry));
      case 'list':   return reply(list_());
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

function ping_() {
  var s = sheet_();
  return { ok: true, sheet: s.getParent().getName(), tab: s.getName(), rows: Math.max(0, s.getLastRow() - 1) };
}

function append_(entry) {
  if (!entry || !entry.id) return { ok: false, error: 'entry.id is required' };
  var s = sheet_();
  if (findRow_(s, entry.id)) return update_(entry);      // already there → treat as an update

  s.appendRow(toRow_(entry));
  var row = s.getLastRow();
  attach_(s, row, entry);
  return { ok: true, row: row, id: entry.id };
}

function update_(entry) {
  if (!entry || !entry.id) return { ok: false, error: 'entry.id is required' };
  var s = sheet_();
  var row = findRow_(s, entry.id);
  if (!row) return append_(entry);

  var existing = s.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  s.getRange(row, 1, 1, HEADERS.length).setValues([toRow_(entry, existing)]);
  attach_(s, row, entry);
  return { ok: true, row: row, id: entry.id };
}

function list_() {
  var s = sheet_();
  var last = s.getLastRow();
  if (last < 2) return { ok: true, rows: [] };

  var start = Math.max(2, last - MAX_LIST + 1);
  var values = s.getRange(start, 1, last - start + 1, HEADERS.length).getValues();

  var rows = values.map(function (r) {
    return {
      id: String(r[0]), ticket: String(r[1]),
      date: fmtDate_(r[2]), time: fmtTime_(r[3]),
      name: String(r[4]), department: String(r[5]), category: String(r[6]),
      priority: String(r[7]), request: String(r[8]), status: String(r[9]) || 'Open',
      signature: '', photo: '',                        // images live in the sheet, not pulled back
      device: String(r[12]), created: r[13] ? new Date(r[13]).toISOString() : ''
    };
  }).filter(function (r) { return r.id; });

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

  if (s.getLastRow() === 0) {
    s.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#0e1424').setFontColor('#e7eefc');
    s.setFrozenRows(1);
    s.setColumnWidth(9, 340);                          // Request
    s.setColumnWidth(COL_SIGNATURE, 190);
    s.setColumnWidth(COL_PHOTO, 190);
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
    entry.created ? new Date(entry.created) : new Date(),
    new Date()
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
