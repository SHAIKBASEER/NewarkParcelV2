# No-Token Parcel Assistant Guide

The dashboard assistant is not a general chatbot. It is a deterministic dataset assistant designed for accuracy.

## It Can Answer

- `how many vacant parcels`
- `how many underutilized parcels`
- `ownership breakdown`
- `zoning breakdown`
- `LBCS function breakdown`
- `show 0714_4230_50`
- `show R-3 parcels`
- `visualize nonprofit parcels`
- `report for vacant parcels`
- `report for cemetery`
- `show 07104`

## It Can Change the Dashboard

- `show vacant parcels`
- `show active parcels visualization`
- `open analytics`
- `open map`
- `open key findings`
- `show satellite map`
- `reset dashboard`

## It Can Export

- `export visible data`
- `report for nonprofit`
- `pdf report for underutilized parcels`
- `report for 0714_4230_50`

## Accuracy Design

The assistant uses exact local functions:

- text normalization
- parcel ID extraction
- field-value matching
- exact counts over the loaded rows
- current dashboard filters
- selected parcel scope

It does not invent results. If a question cannot be answered from the loaded dataset, the assistant should ask for a narrower filter or suggest exporting data.

## Why No API Key

GitHub Pages is static hosting. Any API key in frontend JavaScript can be seen by users. For team access, the safest approach is the no-token assistant.

If a hosted LLM is needed later, add a private backend service and keep the key server-side.
