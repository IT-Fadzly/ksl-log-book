# KSL · Digital Log Book

A futuristic, phone-first replacement for the paper/Forms service-request sheet.
Plain HTML + CSS + JavaScript with Tailwind — no build step, no framework, no npm.

```
index.html                 the whole app (4 views)
assets/css/style.css       theme tokens, ambient FX, components, charts
assets/js/app.js           form, signature pad, storage, sync, dashboard
apps-script/Code.gs        the Google Sheets backend — paste into Apps Script
apps-script/appsscript.json  optional manifest that pins the single OAuth scope
manifest.webmanifest       installable-app metadata
sw.js                      offline cache (service worker)
```

## What it does

| | |
|---|---|
| **New Entry** | Auto ticket ID, one-tap "Now" timestamp, name + department, category chips, priority segments, request text with counter, optional camera photo (auto-downscaled), and a real signature pad (finger/pen/mouse, 4 ink colours, undo, hi-DPI). A progress ring shows how complete the form is. |
| **Log Book** | Every entry as a card colour-coded by priority, with live search, status/department/sort filters, a detail sheet (change status, share, print, delete) and CSV + JSON export/import. |
| **Dashboard** | Stat tiles, a 7-day bar chart, entries per department, a status-mix bar with legend, and the same numbers as a data table. |
| **Sheet** | Connect the app to your Google Sheet and sync. |

Also: dark/light theme, English/Bahasa Melayu toggle, haptics, install-to-home-screen (PWA), works fully offline, `Esc` closes dialogs, and a print stylesheet.

## Running it

Open `index.html` directly and it works, but for the service worker and Google Sheet sync to work you should serve it over http(s):

```bash
# from this folder
python -m http.server 8777
# then open http://localhost:8777
```

To use it on phones, host the folder anywhere static — GitHub Pages, Netlify drop, Cloudflare Pages, or any office web server — and open the URL on the phone, then **Add to Home Screen**.

## Connecting the Google Sheet

Data is saved to the device first (so a bad signal never loses an entry), then pushed to your sheet. Anything that fails to send stays **queued** — the badge on the sync button shows how many — and goes up automatically when the connection returns.

Target sheet: `1X9pxps07T4TDXeNxsS4wY8nPuZmhcxXdMp6VFptlLpE`

1. Open the sheet → **Extensions → Apps Script**. Do it from the sheet — that binds the script to it, which is what keeps the permission request to one narrow scope.
2. Delete the sample code, paste all of `apps-script/Code.gs`, and save.
3. Run the `setup` function once and approve it. It asks for **one** permission — `spreadsheets.currentonly`, "this spreadsheet only". No Drive, no access to your other files. You do this once; people using the app on their phones never see a prompt.
4. **Deploy → New deployment → Web app** — *Execute as:* **Me**, *Who has access:* **Anyone**. Copy the `.../exec` URL.
5. In the app, open the **Sheet** tab, paste that URL, press **Save & test**. It should report `Connected to "…" · N rows`, and queued entries upload immediately.

The script creates a **Log Book** tab with these columns:

```
Entry ID | Ticket | Date | Time | Name | Department | Category | Priority |
Request | Status | Signature | Photo | Device | Created | Synced At
```

Signatures and photos are embedded straight into the row as pictures (`Sheet.insertImage` takes the raw bytes, so no Drive permission is involved) and the cell text reads `signed` / `photo`. Set `IMAGES = false` in `Code.gs` to skip the pictures and keep just the text. If a picture ever fails to embed, the row is still written and the cell gets a note explaining why — an attachment problem never costs you an entry.

Writes are **idempotent**: rows are keyed by Entry ID, so re-sending an entry updates its row instead of duplicating it. Changing a status in the app updates that same row.

### A note on access

"Anyone" is what makes a browser able to POST without a Google login — it means anyone who has the `/exec` URL can add rows. Two ways to tighten it:

* keep the URL internal (it is not guessable), and/or
* set `SECRET` in `Code.gs` to a phrase, and enter the same phrase in the app's **Shared secret** field. Requests without it are rejected.

## Notes

* Tailwind comes from the CDN (`cdn.tailwindcss.com`), which is ideal for a drop-in file like this. For a production deployment you can swap it for a built `tailwind.css` to cut the runtime compile and work without internet on first load.
* Chart colours are not decorative: the categorical set (`--c-blue`, `--c-orange`, `--c-aqua`, `--c-yellow`, `--c-red` in `style.css`) was validated for colour-vision separation and contrast against both the dark `#0e1424` and light `#f4f6fb` surfaces. Light mode's yellow/aqua sit below 3:1, which is why every bar carries a visible value label and the dashboard also has a text table. Re-validate if you change them.
* Storage is `localStorage`, ~5 MB per browser. Photos are downscaled to 900 px JPEG and signatures to a 2× PNG to stay well inside that; export a JSON backup before clearing.
