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

Netlify Functions remain in `netlify/functions/` and are bundled separately. Their source files must not appear in `dist`.

Operational material—including `tools/`, `Docs/`, `reports/`, tests, migrations, dependencies, repository metadata, environment files, evidence, backups, source maps and temporary files—is private. The boundary test must pass before any preview or production deployment. Adding a new public directory or file type requires explicit code review of the build allowlist and generated manifest comparison.
