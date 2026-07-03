# VitaDerm Catalogue Extractor for Codex

This package is designed for Codex to run inside the website repository. It visits official VitaDerm product pages, extracts product data, downloads product images locally, optimizes images to WebP, and outputs CSV/JSON/XLSX files.

## Run
npm install
npm run extract

## Output
./vitaderm-output/vitaderm_complete_catalogue_for_codex.csv
./vitaderm-output/vitaderm_complete_catalogue_for_codex.json
./vitaderm-output/vitaderm_complete_catalogue_for_codex.xlsx
./vitaderm-output/images/vitaderm/*.webp

Review any rows with manual_review_notes before publishing.
