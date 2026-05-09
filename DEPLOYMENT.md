# Deployment Guide

## Recommended Hosting

Use GitHub Pages for the frontend and included static data bundles.

The dashboard currently loads:

- `data_compact_*.js` for parcel attributes split into GitHub-safe shards
- `data_geom.js` for lazy map geometry

This keeps each browser-uploaded GitHub file under 25 MiB and avoids loading the full combined `data.js`.

## Important Notes

- Do not commit `Api.txt` or any private API key.
- The dashboard assistant is local/no-token by default.
- Fuse.js is loaded from jsDelivr for free fuzzy search. If the CDN is unavailable, the assistant falls back to the built-in deterministic matcher.
- Keep `data.js`, `data_attrs.js`, and `data_compact.js` out of the GitHub Pages deployment.
- If GitHub Pages becomes slow due to data size, host `data_compact_*.js` and `data_geom.js` on object storage such as Cloudflare R2, S3, Supabase Storage, or GitHub Releases, then update the script paths in `index.html` / `app.js`.

## Local Test

Run from the repository folder:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8765/index.html
```

Login with:

- User name: `Living Cities`
- Password: `Newark`

## Publish Checklist

- [ ] Hard refresh locally and confirm login loads.
- [ ] Enter dashboard and confirm map appears.
- [ ] Ask assistant: `how many underutilized parcels`.
- [ ] Ask assistant: `show 0714_4230_50`.
- [ ] Ask assistant: `report for vacant parcels`.
- [ ] Test Export visible CSV.
- [ ] Test Print / Save PDF from generated report.
- [ ] Confirm GitHub Pages URL loads `data_compact_01.js`, `data_compact_02.js`, and `data_geom.js`.
- [ ] Confirm no required upload file is larger than 25 MiB.
