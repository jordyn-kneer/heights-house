# Heights House website

Public site for Heights House, 1314 E Marietta Ave, Peoria Heights, IL.

- `public/` is the site visitors see: index.html, photos and the icon.
- `api/hh.js` is the one server function. It handles room requests, help requests, event pitches, the calendar and the staff sign-in. Records are stored as private files in Vercel Blob.
- Staff sign-in is at `/#staff`. The passcode is the `ADMIN_KEY` environment variable in Vercel (Project → Settings → Environment Variables).
- Optional email alerts: add `RESEND_API_KEY` and `NOTIFY_EMAIL` (comma-separated) in Vercel to get an email for each new request.

To edit the page, change `public/index.html` (or `src/app.js` and run `python3 build.py`), then push. Vercel redeploys automatically.
