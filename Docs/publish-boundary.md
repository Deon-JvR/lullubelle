# Public/private publish boundary

Netlify publishes only the generated `dist/` directory. `tools/build-public-site.mjs` creates it from an explicit allowlist; never copy the repository root into `dist`.

Public root files are limited to website HTML, CSS, JavaScript, XML, text, icons and images. Public directory trees are limited to:

- `admin/`
- `assets/`
- `before-after/`
- `before-after-images/`
- `brand-logos/`
- `data/`
- `products/`
- `public/`

These trees are intentionally browser-facing: `admin/` contains the static authenticated-admin shell; `assets/`, `brand-logos/`, `before-after-images/` and `public/` contain site imagery; `before-after/` contains its public page; `products/` contains public product imagery and two approved browser catalogue JSON files; and `data/` contains eight approved browser-consumed brand, gallery, category, SEO, product, treatment and voucher catalogue JSON files. JSON publication uses an exact per-file allowlist. Operational exports, audits, orders, payments, customers, reports, spreadsheets and archives do not belong in any allowlisted tree.

Every nested file must have an approved web extension. Hidden files, hidden directories and symlinks are build errors at any nesting depth. Netlify runs `npm run build:verified`, which creates `dist/` and validates the final output, including required-file presence, before packaging a deploy.

Netlify Functions remain in `netlify/functions/` and are bundled separately. Their source files must not appear in `dist`.

Operational material—including `tools/`, `Docs/`, `reports/`, tests, migrations, dependencies, repository metadata, environment files, evidence, backups, source maps and temporary files—is private. The boundary test must pass before any preview or production deployment. Adding a new public directory or file type requires explicit code review of the build allowlist and generated manifest comparison.
