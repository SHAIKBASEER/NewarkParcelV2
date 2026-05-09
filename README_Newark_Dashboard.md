# Newark Parcel Opportunity Dashboard

Open the running local dashboard here:

`http://127.0.0.1:8765/index.html`

You can also open `index.html` directly, but localhost is more reliable for loading the large parcel bundle.

## Files

- `index.html` - reference-style dashboard shell with topbar, tabs, filter chips, map, analytics, and findings views.
- `styles.css` - compact Figma-like dashboard styling.
- `app.js` - filters, charts, map styling, clusters, export, findings, and popup behavior.
- `data_compact.js` - compact Regrid-first parcel attributes for faster initial UI loading.
- `data_geom.js` - lazy-loaded parcel polygon geometry for the map.
- `data.js` - full legacy combined parcel GeoJSON bundle, kept for reproducibility but not loaded by `index.html`.
- `build_dashboard_data.py` - repeatable data builder for `Newark_Essex_Regrid_Final.gpkg`.

## Dashboard Operations

- Login screen: branded entry for the Living Cities Newark City Parcel Project.
- Map: click parcels to open a parcel popup, then choose `Full record` to inspect every available field.
- Selection: select parcels from the high-opportunity list or popup. Selected parcels appear in the export dock.
- Export visible CSV: exports the current filtered parcel set.
- Export selected CSV: exports only selected parcels. If no parcels are selected, it falls back to visible parcels.
- Export single: exports the open parcel record as CSV.
- Export JSON: exports the open parcel record as JSON.
- Export report: creates an HTML report with KPIs, project credits, and selected/top visible parcels.
- Documentation tab: explains filters, classification logic, map use, selection, export operations, and ownership inference.
- Map layer switcher: Light, Dark, Satellite, Streets, Topographic, and a traffic-ready placeholder. Live traffic tiles require a traffic provider URL/API key.
- Parcel AI assistant: answers questions from the loaded dataset, changes filters/views, switches map layers, and triggers exports/reports. If `Api.txt` contains `key='...'`, the assistant will also try API-backed answers; otherwise it uses the local dataset assistant.

## Dataset Fields Used

The dashboard now uses Regrid fields as the primary source and hides rows missing `REGRID_path`, `REGRID_parcelnumb`, or `REGRID_owner`. The current visualization dataset has 41,636 parcel polygons. The page loads compact attributes first, then lazy-loads polygon geometry for the map so the sidebar and analytics can populate sooner.

The dashboard normalizes the GeoPackage into:

- parcel ID from `REGRID_parcelnumb`
- Regrid primary path from `REGRID_path`
- address from `REGRID_address`, then `PROP_LOC`
- owner from `REGRID_owner`
- ownership type inferred from `REGRID_owner`, property class, and `REGRID_lbcs_ownership_desc`
- owner subtype/confidence from `REGRID_owner` and `REGRID_lbcs_ownership_desc`
- LBCS function from `REGRID_lbcs_function_desc`
- LBCS ownership from `REGRID_lbcs_ownership_desc`
- land use from `PROP_CLASS`, `PROP_USE`, and LBCS function descriptors
- vacancy status from `REGRID_usps_vacancy` plus inferred vacant land or underutilization
- assessed value from `REGRID_parval`, then `NET_VALUE`
- land value from `REGRID_landval`, then `LAND_VAL`
- improvement value from `REGRID_improvval`, then `IMPRVT_VAL`
- lot size from `REGRID_gisacre`, then `CALC_ACRE`
- zoning from `REGRID_zoning` or `REGRID_zoning_type`
- latitude and longitude from `REGRID_lat` and `REGRID_lon`
- census tract, block, block group, ZCTA, income, density, growth, and affordability fields from Regrid census columns
- geography from inferred ward and neighborhood buckets using parcel centroids

## Notes

Ward and neighborhood values are not official boundary joins. They are inferred because the source layer did not include those fields.

Vacancy / utilization definitions:

- `Vacant` means county `IMPRVT_VAL` is 0 or missing.
- `Likely underutilized` means county `IMPRVT_VAL` is greater than 0 and `IMPRVT_VAL / LAND_VAL <= 0.20`.
- `Occupied / active` means county `IMPRVT_VAL / LAND_VAL > 0.20`.
- Regrid vacancy/building fields are kept as context but are not used for this classification.

Missing/fallback handling:

- assessed value uses `REGRID_parval`, then `NET_VALUE`, then 0 if both are missing.
- land value uses `REGRID_landval`, then `LAND_VAL`, then 0.
- improvement value uses `REGRID_improvval`, then `IMPRVT_VAL`, then 0.
- lot size uses `REGRID_gisacre`, then `CALC_ACRE`, then 0.
- zoning uses `REGRID_zoning`, then `REGRID_zoning_type`, then `Unknown`.

Each parcel keeps source fields such as `assessedSource`, `lotSizeSource`, `zoningSource`, `vacancyMethod`, `ownerSubtype`, and `ownerConfidence` so the UI can show which values are direct versus inferred/fallback.

The opportunity score is a planning heuristic that weights vacancy or likely underutilization, parcel size, low improvement value, lower assessed value, public/nonprofit ownership, and QOZ status. Clustering is recalculated in the browser from currently filtered parcels using nearby centroid grid cells and high opportunity scores.
