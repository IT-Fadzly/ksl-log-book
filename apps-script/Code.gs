/**
 * KSL Digital Log Book — Google Sheets backend
 * ---------------------------------------------------------------------
 * Paste this into  Extensions → Apps Script  ON THE SHEET ITSELF (that
 * makes the script "bound" to the sheet, which is what keeps the
 * permission request down to a single, narrow scope), then
 * Deploy → New deployment → Web app  (Execute as: Me, Access: Anyone).
 * Copy the /exec URL into the app's "Sheet" tab.
 *
 * Permissions: spreadsheets.currentonly, i.e. "this spreadsheet, nothing
 * else" — no Drive access, no access to your other files — plus
 * script.external_request, used only to send new-request alerts through
 * Firebase Cloud Messaging. You grant them once; people using the app never
 * see a prompt.
 *
 * Actions accepted on POST (body is JSON sent as text/plain):
 *   {action:'ping'}                    → connection test
 *   {action:'append', entry:{...}}     → add a row (idempotent by entry.id)
 *   {action:'update', entry:{...}}     → update the row with that id
 *   {action:'list', lite:true}         → rows without the images (fast)
 *   {action:'media', ids:[...]}        → the images for those rows, on demand
 *   {action:'rev'}                     → a revision marker, for cheap polling
 *
 * Live updates: clients poll 'rev' every 15-30s and pull the full list only
 * when it moves. onEdit keeps that marker honest when a person types into the
 * sheet directly. onChange is optional — add it under Triggers to catch rows
 * inserted or deleted by hand.
 *   {action:'start', id:'...'}         → IT picks the job up; starts the clock
 *   {action:'finish', id:'...'}        → stamp the finish time and duration
 *   {action:'delete', id:'...'}        → remove a row and its pictures
 *   {action:'notify'} / {action:'saveToken', token, click} /
 *   {action:'dropToken', token} / {action:'testNotify'}
 *                                      → the admin phones new requests are pushed to
 *
 * 'update' and 'delete' are the admin actions. Set ADMIN_KEY below and they
 * require it; 'append' and 'list' stay open so the log book itself works.
 */

var TAB_NAME = 'Log Book';
var SETTINGS_TAB = 'Settings';             // the look of the app: logo, name, placement
var SECRET    = '';                        // set a string here + in the app to lock it down
var ADMIN_KEY = '';                        // set a passphrase to gate edit + delete
var MAX_LIST = 10000;
var IMAGES   = true;                       // false = store "(signed)" text instead of the image

var HEADERS = [
  'Entry ID', 'Ticket', 'Date', 'Time', 'Name', 'Department', 'Category',
  'Priority', 'Request', 'Status', 'Signature', 'Photo', 'Device', 'Created',
  'Synced At', 'Signature Data', 'Photo Data', 'Time Out', 'Time Returned',
  'Duration', 'Started At', 'Finished At', 'Resolution', 'Paused At', 'Held Ms'
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
var COL_RESOLUTION = 23;   /* what IT wrote as the job was closed: what the
                              problem turned out to be, or how it was fixed */

/* A job that waits overnight for a part is not a job being worked on, so the
   clock can be held. 'Paused At' is the moment it went on hold and is empty
   whenever the clock is running; 'Held Ms' is the time already spent on hold
   across every earlier pause. The worked time is therefore
       (finish or now) − start − held − (now − pausedAt, if on hold)
   and the calendar days it spanned are counted separately: the two answer
   different questions, and a job held over a weekend needs both. */
var COL_PAUSED = 24;
var COL_HELD   = 25;

/* New columns are appended, never inserted: the row layout is addressed by
   position, so moving a column would misread every existing row. */

/* ── entry points ──────────────────────────────────────────────────── */

/* Only writes queue for the lock. Reads never change a row, and the polling
   from every open screen would otherwise stand in line behind a slow append
   (inserting a picture takes seconds) until it timed out. */
var WRITES = ['append', 'update', 'start', 'pause', 'resume', 'finish', 'delete', 'saveSettings', 'saveToken', 'dropToken'];

function doPost(e) {
  var lock = null;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (WRITES.indexOf(body.action) !== -1) {
      lock = LockService.getScriptLock();
      lock.waitLock(28000);
    }

    if (SECRET && body.secret !== SECRET) return reply({ ok: false, error: 'Bad secret' });

    var admin = ['update', 'delete', 'saveSettings', 'notify', 'saveToken', 'dropToken', 'testNotify'].indexOf(body.action) !== -1;
    if (admin && ADMIN_KEY && body.key !== ADMIN_KEY) {
      return reply({ ok: false, error: 'Admin key required' });
    }

    switch (body.action) {
      case 'ping':   return reply(ping_());
      case 'append':
        var added = append_(body.entry);
        /* The row is safely in; let the next writer in before calling out to
           Firebase, so a slow push never holds up anyone else's entry. */
        if (added.ok && added.created) {
          if (lock) { try { lock.releaseLock(); } catch (ignore) {} lock = null; }
          notifyNew_(body.entry);
        }
        return reply(added);
      case 'notify':     return reply(notifySettings_());
      case 'saveToken':  return reply(saveToken_(body.token, body.click));
      case 'dropToken':  return reply(dropToken_(body.token));
      case 'testNotify': return reply(push_({ title: 'KSL Log Book', body: '✅ Test alert — this phone will be told about new requests.', tag: 'test' }));
      case 'update': return reply(update_(body.entry));
      case 'start':  return reply(start_(body.id));
      case 'pause':  return reply(pause_(body.id));
      case 'resume': return reply(resume_(body.id));
      case 'finish': return reply(finish_(body.id, body.note));
      case 'delete': return reply(delete_(body.id));
      case 'list':   return reply(list_(body.lite));
      case 'media':  return reply(media_(body.ids));
      case 'rev':    return reply(rev_());
      case 'settings':     return reply(settings_());
      case 'saveSettings': return reply(saveSettings_(body.settings));
      default:       return reply({ ok: false, error: 'Unknown action: ' + body.action });
    }
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  } finally {
    if (lock) try { lock.releaseLock(); } catch (ignore) {}
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

  // Filing a request does not start the clock: the job is waiting until
  // someone at the IT Desk picks it up.
  s.appendRow(toRow_(entry));
  var row = s.getLastRow();
  attach_(s, row, entry);
  bump_();
  return { ok: true, row: row, id: entry.id, created: true };
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

/** Start the clock: IT has picked the job up. */
function start_(id) {
  if (!id) return { ok: false, error: 'id is required' };
  var s = sheet_();
  var row = findRow_(s, id);
  if (!row) return { ok: false, error: 'Not found: ' + id };

  var vals = s.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  if (vals[COL_STARTED - 1]) return { ok: false, error: 'This job is already started' };
  if (vals[COL_FINISHED - 1]) return { ok: false, error: 'This job is already finished' };

  var now = new Date();
  s.getRange(row, COL_TIME_OUT).setValue(fmtTime_(now));
  s.getRange(row, COL_STARTED).setValue(now);
  s.getRange(row, COL_STATUS).setValue('In Progress');

  bump_();
  return { ok: true, id: id, row: row, timeOut: fmtTime_(now), startedAt: now.toISOString(), status: 'In Progress' };
}

/** Hold the clock: the job is still open, but nobody is working on it. */
function pause_(id) {
  if (!id) return { ok: false, error: 'id is required' };
  var s = sheet_();
  var row = findRow_(s, id);
  if (!row) return { ok: false, error: 'Not found: ' + id };

  var vals = s.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  if (vals[COL_FINISHED - 1]) return { ok: false, error: 'This job is already finished' };
  if (!vals[COL_STARTED - 1]) return { ok: false, error: 'Press Start before holding this job' };
  if (vals[COL_PAUSED - 1]) return { ok: false, error: 'This job is already on hold' };

  var now = new Date();
  s.getRange(row, COL_PAUSED).setValue(now);
  s.getRange(row, COL_STATUS).setValue('On Hold');

  bump_();
  return {
    ok: true, id: id, row: row, status: 'On Hold',
    pausedAt: now.toISOString(), heldMs: Number(vals[COL_HELD - 1] || 0)
  };
}

/** Start the clock again, and keep the time spent waiting out of the total. */
function resume_(id) {
  if (!id) return { ok: false, error: 'id is required' };
  var s = sheet_();
  var row = findRow_(s, id);
  if (!row) return { ok: false, error: 'Not found: ' + id };

  var vals = s.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  if (vals[COL_FINISHED - 1]) return { ok: false, error: 'This job is already finished' };
  if (!vals[COL_PAUSED - 1]) return { ok: false, error: 'This job is not on hold' };

  var now = new Date();
  var held = Number(vals[COL_HELD - 1] || 0) + (now.getTime() - new Date(vals[COL_PAUSED - 1]).getTime());

  s.getRange(row, COL_HELD).setValue(held);
  s.getRange(row, COL_PAUSED).setValue('');
  s.getRange(row, COL_STATUS).setValue('In Progress');

  bump_();
  return { ok: true, id: id, row: row, status: 'In Progress', pausedAt: '', heldMs: held };
}

/** Stop the clock on a task: finish time, duration, and status Resolved. */
function finish_(id, note) {
  if (!id) return { ok: false, error: 'id is required' };
  var s = sheet_();
  var row = findRow_(s, id);
  if (!row) return { ok: false, error: 'Not found: ' + id };

  var vals = s.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  if (vals[COL_FINISHED - 1]) return { ok: false, error: 'This task is already finished' };
  if (!vals[COL_STARTED - 1]) return { ok: false, error: 'Press Start before finishing this job' };

  var started = new Date(vals[COL_STARTED - 1]);
  var now = new Date();

  /* Finishing a job that is still on hold closes that hold first, so the
     waiting never lands in the worked time. */
  var held = Number(vals[COL_HELD - 1] || 0);
  if (vals[COL_PAUSED - 1]) held += now.getTime() - new Date(vals[COL_PAUSED - 1]).getTime();

  var worked = Math.max(0, now.getTime() - started.getTime() - held);
  var dur = humanDur_(worked);
  var days = daysBetween_(started, now);

  /* The closing note is optional — a job that is simply done should not be
     held up for want of something to say about it. */
  var resolution = String(note == null ? '' : note).trim().slice(0, 2000);

  s.getRange(row, COL_TIME_BACK).setValue(fmtTime_(now));
  s.getRange(row, COL_DURATION).setValue(dur);
  s.getRange(row, COL_FINISHED).setValue(now);
  s.getRange(row, COL_STATUS).setValue('Resolved');
  s.getRange(row, COL_PAUSED).setValue('');
  s.getRange(row, COL_HELD).setValue(held);
  if (resolution) s.getRange(row, COL_RESOLUTION).setValue(resolution);

  bump_();
  return {
    ok: true, id: id, row: row, resolution: resolution, days: days,
    timeReturned: fmtTime_(now), duration: dur, finishedAt: now.toISOString(),
    pausedAt: '', heldMs: held, status: 'Resolved'
  };
}

/** Calendar days a job spanned, counting both ends: same day is 1. */
function daysBetween_(a, b) {
  var d0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  var d1 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.max(1, Math.round((d1 - d0) / 86400000) + 1);
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

/**
 * The listing. In lite mode the signature and photo are left out and only a
 * flag says they exist — a row with images is 20-45 KB, so sending them on
 * every refresh is what makes the app feel slow. The pictures are fetched
 * separately, for the handful of rows actually on screen.
 */
function list_(lite) {
  var s = sheet_();
  var last = s.getLastRow();
  if (last < 2) return { ok: true, rows: [] };

  var start = Math.max(2, last - MAX_LIST + 1);
  var n = last - start + 1;

  /* Two narrow reads rather than one wide one. Columns 16 and 17 hold the
     pictures as data URLs — up to CELL_LIMIT characters each — and a listing
     never sends them, so reading them cost every refresh its speed and bought
     nothing. Columns 11 and 12 carry the cheap 'signed' / 'photo' markers,
     which is all the app needs in order to know a picture exists. */
  var head = s.getRange(start, 1, n, 14).getValues();             // Entry ID → Created
  var tail = s.getRange(start, COL_TIME_OUT, n, 8).getValues();   // Time Out → Held Ms
  var pics = lite ? null : s.getRange(start, COL_SIG_DATA, n, 2).getValues();

  // One malformed cell must not cost the whole listing, so each row is
  // mapped defensively and a row that still fails is skipped.
  var rows = [];
  for (var i = 0; i < n; i++) {
    try {
      var r = head[i], t = tail[i];
      if (!r[0]) continue;
      rows.push({
        id: String(r[0]), ticket: String(r[1]),
        date: fmtDate_(r[2]), time: fmtTime_(r[3]),
        name: String(r[4]), department: String(r[5]), category: String(r[6]),
        priority: String(r[7]), request: String(r[8]), status: String(r[9]) || 'Open',
        signature: pics ? String(pics[i][0] || '') : '',   // readable copies - the pictures
        photo:     pics ? String(pics[i][1] || '') : '',   // in the cells cannot be read back
        hasSignature: !!r[10], hasPhoto: !!r[11],
        timeOut: fmtTime_(t[0]), timeReturned: fmtTime_(t[1]),
        duration: String(t[2] || ''),
        startedAt: iso_(t[3]), finishedAt: iso_(t[4]),
        resolution: String(t[5] || ''),
        pausedAt: iso_(t[6]), heldMs: Number(t[7] || 0),
        device: String(r[12]), created: iso_(r[13])
      });
    } catch (ignore) {}
  }

  return { ok: true, rows: rows };
}

/** The images for a handful of rows, by id. Capped so one call stays small. */
function media_(ids) {
  if (!ids || !ids.length) return { ok: true, media: {} };
  var s = sheet_();
  var last = s.getLastRow();
  if (last < 2) return { ok: true, media: {} };

  var wanted = {};
  for (var i = 0; i < Math.min(ids.length, 20); i++) wanted[String(ids[i])] = true;

  /* Find the rows by reading the id column alone. Reading the whole sheet to
     answer for twenty entries is what made this call slower with every row
     added — and it dragged every stored picture along to do it. */
  var idCol = s.getRange(2, 1, last - 1, 1).getValues();
  var hits = [];
  for (var j = 0; j < idCol.length; j++) {
    var id = String(idCol[j][0]);
    if (id && wanted[id]) hits.push({ row: j + 2, id: id });
  }

  /* Now the pictures, in runs of neighbouring rows. A page of entries is
     usually one such run, so this is usually a single read; rows scattered by
     a filter cost one read each, and never more than one per entry. Only rows
     that were actually asked for are read — these cells are large enough that
     reaching over a gap to save a call would cost more than the call. */
  var out = {};
  for (var k = 0; k < hits.length; k++) {
    var first = k;
    while (k + 1 < hits.length && hits[k + 1].row - hits[k].row <= 1) k++;
    var from = hits[first].row, span = hits[k].row - from + 1;
    var block = s.getRange(from, COL_SIG_DATA, span, 2).getValues();
    for (var m = first; m <= k; m++) {
      var cells = block[hits[m].row - from];
      out[hits[m].id] = { signature: String(cells[0] || ''), photo: String(cells[1] || '') };
    }
  }
  return { ok: true, media: out };
}

/* ── how the app looks ─────────────────────────────────────────────────
   The logo and the name live in the sheet beside the entries, so the app
   can be rebranded without touching the code or redeploying anything. It is
   a second tab rather than more columns on the first: it holds one of each
   thing, not one per entry, and the Log Book tab is addressed by position.
   The tab is hidden — it is written through the admin page, not by hand. */
function settingsSheet_() {
  var ss = SpreadsheetApp.getActive();
  var s = ss.getSheetByName(SETTINGS_TAB);
  if (!s) {
    s = ss.insertSheet(SETTINGS_TAB);
    s.getRange(1, 1, 1, 2).setValues([['Key', 'Value']])
      .setFontWeight('bold').setBackground('#0e1424').setFontColor('#e7eefc');
    s.setFrozenRows(1);
    s.setColumnWidth(1, 150);
    try { s.hideSheet(); } catch (ignore) {}
  }
  return s;
}

function settings_() {
  var s = settingsSheet_();
  var last = s.getLastRow();
  var out = {};
  if (last >= 2) {
    var v = s.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < v.length; i++) {
      if (v[i][0]) out[String(v[i][0])] = String(v[i][1] == null ? '' : v[i][1]);
    }
  }
  return { ok: true, settings: out };
}

/** Merge a patch into the stored settings. A key set to '' is cleared. */
function saveSettings_(patch) {
  if (!patch) return { ok: false, error: 'settings are required' };
  var s = settingsSheet_();
  var cur = settings_().settings;

  for (var k in patch) {
    if (!patch.hasOwnProperty(k)) continue;
    var v = String(patch[k] == null ? '' : patch[k]);
    if (v.length > CELL_LIMIT) return { ok: false, error: 'That picture is too large to store' };
    cur[k] = v;
  }

  var keys = [];
  for (var key in cur) if (cur.hasOwnProperty(key) && cur[key] !== '') keys.push(key);

  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 2).clearContent();
  if (keys.length) {
    s.getRange(2, 1, keys.length, 2).setValues(keys.map(function (key) { return [key, cur[key]]; }));
  }
  bump_();
  return { ok: true, settings: settings_().settings };
}

/* ── push to the admin's phone ─────────────────────────────────────────
   Firebase Cloud Messaging. Each admin phone that turns alerts on registers
   with Firebase and hands this script its token; a new request is then sent
   to every token through the FCM HTTP v1 API.

   Sending needs the Firebase project's service account. Its JSON key goes
   under Project Settings → Script properties as FCM_SERVICE_ACCOUNT — typed
   in there by hand, so the private key never travels through the app and no
   action ever returns it. The script signs its own short-lived access token
   with that key, which is why no Google sign-in or extra scope is needed. */
var FCM_KEY_PROP = 'FCM_SERVICE_ACCOUNT';
var FCM_TOKENS   = 'fcmTokens';
var FCM_MAX      = 20;                     // phones; one property holds them all

function serviceAccount_() {
  var raw = PropertiesService.getScriptProperties().getProperty(FCM_KEY_PROP);
  if (!raw) return null;
  try {
    var sa = JSON.parse(raw);
    return (sa.client_email && sa.private_key && sa.project_id) ? sa : null;
  } catch (err) { return null; }
}

function tokens_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(FCM_TOKENS) || '[]'); }
  catch (err) { return []; }
}

function setTokens_(list) {
  PropertiesService.getScriptProperties().setProperty(FCM_TOKENS, JSON.stringify(list.slice(-FCM_MAX)));
}

function notifySettings_() {
  var sa = serviceAccount_();
  return { ok: true, configured: !!sa, project: sa ? sa.project_id : '', devices: tokens_().length };
}

/** A phone turning alerts on. The newest copy of a token goes to the end,
    so when the list is full it is the longest-silent phone that drops off. */
function saveToken_(token, click) {
  token = String(token || '');
  if (!/^[\w:-]{20,4096}$/.test(token)) return { ok: false, error: 'That is not a Firebase token' };
  var list = tokens_().filter(function (x) { return x.t !== token; });
  list.push({ t: token, at: new Date().toISOString() });
  setTokens_(list);
  if (click && /^https:\/\//.test(click)) {
    PropertiesService.getScriptProperties().setProperty('fcmClick', String(click).slice(0, 500));
  }
  return notifySettings_();
}

function dropToken_(token) {
  setTokens_(tokens_().filter(function (x) { return x.t !== String(token || ''); }));
  return notifySettings_();
}

/** An OAuth token for FCM, signed with the service account and kept for 50
    minutes — every push after the first skips the round trip. */
function fcmAccess_(sa) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('fcmAccess');
  if (hit) return hit;

  var now = Math.floor(Date.now() / 1000);
  var b64 = function (o) { return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, ''); };
  var unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    iat: now, exp: now + 3600
  });
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, sa.private_key)).replace(/=+$/, '');

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }
  });
  var d = {};
  try { d = JSON.parse(res.getContentText()); } catch (ignore) {}
  if (!d.access_token) throw new Error('Firebase sign-in failed: ' + (d.error_description || d.error || res.getResponseCode()));
  cache.put('fcmAccess', d.access_token, 3000);
  return d.access_token;
}

/**
 * Send one alert to every registered phone. A token Firebase no longer
 * knows — the app was uninstalled, or alerts were switched off in the
 * browser — is dropped, so the list cleans itself.
 */
function push_(note) {
  var sa = serviceAccount_();
  if (!sa) return { ok: false, error: 'Firebase is not set up — add ' + FCM_KEY_PROP + ' under Script properties' };
  var list = tokens_();
  if (!list.length) return { ok: false, error: 'No phone has turned alerts on yet' };

  var access = fcmAccess_(sa);
  var click = PropertiesService.getScriptProperties().getProperty('fcmClick') || '';
  var icon = click ? click.replace(/[^\/]*$/, 'assets/icons/icon-192.png') : '';
  var url = 'https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send';

  var reqs = list.map(function (x) {
    var webpush = {
      headers: { Urgency: note.urgent ? 'high' : 'normal' },
      notification: { tag: note.tag || 'ksl', renotify: true, requireInteraction: !!note.urgent }
    };
    if (icon) webpush.notification.icon = icon;
    if (click) webpush.fcm_options = { link: click };
    return {
      url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + access },
      payload: JSON.stringify({ message: {
        token: x.t,
        notification: { title: note.title, body: note.body },
        data: note.data || {},
        webpush: webpush
      } })
    };
  });

  var res = UrlFetchApp.fetchAll(reqs);
  var sent = 0, dead = {}, why = '';
  for (var i = 0; i < res.length; i++) {
    var code = res[i].getResponseCode(), text = res[i].getContentText();
    if (code < 300) { sent++; continue; }
    if (code === 404 || /UNREGISTERED|not a valid FCM registration token/i.test(text)) dead[list[i].t] = true;
    else why = 'FCM replied ' + code + ': ' + text.slice(0, 200);
  }
  if (Object.keys(dead).length) {
    // re-read: a phone may have registered while these were in flight
    setTokens_(tokens_().filter(function (x) { return !dead[x.t]; }));
  }
  if (!sent) return { ok: false, error: why || 'No phone could be reached — turn alerts on again' };
  return { ok: true, sent: sent, failed: list.length - sent };
}

function notifyNew_(e) {
  try {
    var req = String(e.request || '');
    push_({
      title: (e.priority === 'Critical' ? '🚨 ' : '') + 'New request · ' + (e.ticket || ''),
      body: (e.name || '?') + ' · ' + (e.department || '?') + ' · ' + (e.priority || '') + '\n' +
            (req.length > 200 ? req.slice(0, 200) + '…' : req),
      urgent: e.priority === 'Critical' || e.priority === 'High',
      tag: 'req-' + (e.id || ''),
      data: { id: String(e.id || ''), ticket: String(e.ticket || '') }
    });
  } catch (ignore) {}                       // a missed push must never cost the entry
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
    entry.finishedAt   || existing[21] || '',
    entry.resolution != null ? entry.resolution : (existing[22] || ''),
    entry.pausedAt != null ? entry.pausedAt : (existing[23] || ''),
    entry.heldMs    != null ? entry.heldMs    : (existing[24] || 0)
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

/* Run this once from the editor to approve both scopes, then deploy. Once
   FCM_SERVICE_ACCOUNT is in Script properties, run it again: it signs in to
   Firebase, so a bad key shows up here rather than on the admin's phone. */
function setup() {
  var s = sheet_();
  Logger.log('Ready: %s / %s', s.getParent().getName(), s.getName());
  var sa = serviceAccount_();
  if (!sa) {
    Logger.log('Firebase: not set up yet — add %s under Project Settings → Script properties', FCM_KEY_PROP);
    UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { muteHttpExceptions: true });   // asks for the permission now
    return;
  }
  CacheService.getScriptCache().remove('fcmAccess');
  fcmAccess_(sa);
  Logger.log('Firebase ready: project %s · %s phone(s) registered', sa.project_id, tokens_().length);
}
