# Product card and image audit (pre-implementation)

Date: 2026-07-14

## Rendering map

- Shop/search/filter cards: `renderManagedProductCard()` in `script.js`, inserted into `[data-shop-product-grid]`.
- Homepage best sellers: `setupFeaturedProducts()` in `script.js`, inserted into `[data-featured-products]`.
- Related products and product detail: `setupProductDetail()` in `script.js`.
- Cart thumbnails: `renderCart()` in `script.js`.
- Admin thumbnails: `renderProductRows()` in `admin/admin.js`.

## Existing selectors

- Product grid: `.kalahari-grid`.
- Shop card: `.kalahari-item`; homepage card: `.featured-product-card` / `.home-product-card`.
- Image stage: `.product-image-wrap`; homepage stage: `.featured-product-image`.
- Product image: descendant selectors `.kalahari-item img` and `.featured-product-image img`.
- Title: `.kalahari-item h3` and `.featured-product-card h3`.
- Description: `.kalahari-item p`, `.product-description`.
- Price: `.kalahari-item strong`, `.featured-product-card strong`.
- Quantity controls: `.quantity-control` (cart only; grid cards add one unit at a time).
- Add-to-cart/actions: `.product-card-actions`, `.featured-product-actions`, and `.button`.
- Brand/category: `.product-brand-badge`, `.product-category-link`, `.supplier-tabs`, `.supplier-panel`, `.shop-brand-grid`.
- Detail/cart/admin images: `.product-detail-media`, `.cart-item img`, `.product-list-thumb`.

## Root causes found before editing

1. The same card and image selectors are declared repeatedly across `styles.css`. Earlier grid-based card rules, later fixed-height image rules, and still later breakpoint overrides conflict. The final cascade uses four explicit columns rather than the requested intrinsic responsive grid.
2. Product stages use several unrelated fixed heights (`150px`, `168–210px`, `218px`, and `245px`) instead of one aspect-ratio stage. Original image proportions therefore influence perceived scale even where `object-fit: contain` prevents cropping.
3. Shop cards are CSS Grid while homepage cards are Flex. Their internal fields and row alignment are not shared, so titles, prices, descriptions, and actions do not align consistently across surfaces.
4. Mobile rules force two narrow columns down to 320px and reduce controls below the requested 44px touch height. Long titles and actions are consequently cramped.
5. The current Kalahari catalogue contains 77 records, but 69 point to the same `products/kalahari/catalogue-product.svg`; only eight point to SKU-specific photography. This is the primary wrong/generic-image cause and cannot be corrected with CSS.
6. The local image corpus mixes 600×600 WebP, 650×650 PNG/WebP, 1000×1000 JPEG, 1224×1224 JPEG, transparent and opaque backgrounds, and differing amounts of baked-in whitespace. No image-specific inline styles were found; shared descendant selectors and repeated media-query rules are the overriding mechanisms.
7. Shop and homepage cards mark every image lazy, including the first visible row. Cart images have empty alt text and no explicit dimensions. Admin thumbnails have no explicit dimensions or async decoding.
8. The page sections already constrain their content globally, but card grids have no dedicated `1200–1280px` cap and can produce over-wide cards or stretched orphan rows at large widths.

## Image-processing constraint

Automated trimming must distinguish transparent/near-white outer canvas from white packaging. The repository has no installed image-trimming utility, so the corrective script must use conservative edge-connected border detection, preserve a breathing-space margin, refuse ambiguous crops, and emit a review report. Outputs must be visually checked before replacing catalogue assets.
