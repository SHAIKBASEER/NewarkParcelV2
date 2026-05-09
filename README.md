# Living Cities - Newark City Parcel Project

Static GitHub Pages dashboard for Newark parcel intelligence.

## What This Dashboard Does

- Map parcels with fast point rendering and zoom-in polygon detail.
- Filter by status, ownership, geography, zoning, and search text.
- Classify utilization from county fields:
  - Vacant: `IMPRVT_VAL = 0`
  - Underutilized: `IMPRVT_VAL > 0` and `IMPRVT_VAL / LAND_VAL <= 0.20`
  - Active: improvement ratio above `20%`
- Query the dataset with a no-token local assistant.
- Fuzzy-match messy parcel questions with Fuse.js, while keeping counts deterministic from the loaded dataset.
- Generate CSV, JSON, HTML, and print-to-PDF reports.

## No-Token Assistant

The assistant does not require an API key. It reads the loaded dataset in the browser and deterministically:

- finds exact parcel IDs, such as `0714_4230_50`
- filters by real values in owner, zoning, LBCS, status, ZCTA, census, ward, and neighborhood fields
- opens analytics, map, findings, and documentation views
- creates scoped reports from the matched data
- uses Fuse.js fuzzy matching for typos and partial owner/address/zoning/LBCS searches

This is safer for GitHub Pages because frontend API keys are visible to users.

## GitHub Pages Deployment

1. Create a new GitHub repository.
2. Upload these files to the repository root:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `data_compact_01.js`
   - `data_compact_02.js`
   - `data_geom.js`
   - `.nojekyll`
   - `README.md`
   - `DEPLOYMENT.md`
   - `AI_ASSISTANT_GUIDE.md`
3. In GitHub, go to `Settings > Pages`.
4. Set source to `Deploy from a branch`.
5. Choose branch `main` and folder `/root`.
6. Save and wait for the Pages URL.

## Dashboard Login

- User name: `Living Cities`
- Password: 

## Credits

Data Analyst Consultant: Abdul Baseer Shaik  
Director, Centre of Wealth: Dr. Ahmed Whitt
