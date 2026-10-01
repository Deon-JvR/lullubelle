import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync('data/kalahari-image-manifest.json','utf8'));
const approvedIds=new Set(['kalahari-soothing-lips-wild-honey','kalahari-soothing-lips-desert-rose','kalahari-soothing-lips-kalahari-sunset','kalahari-soothing-lips-african-flowers']);
export const genuineProductImage = image => Boolean(image) && !/catalogue-product\.svg|product-image-coming-soon|placeholder|lullubelle-logo/i.test(image);
export const reconcileProductImage = product => {
  if (!approvedIds.has(product.id) || genuineProductImage(product.image)) return product;
  const approved=manifest.find(m=>m.sku===product.sku && m.matchStatus==='verified' && m.productName.toLowerCase()===product.name.toLowerCase());
  // Asset existence is verified by build/regression checks. Static images are
  // published in dist, not duplicated into the Lambda filesystem.
  if (!approved) return product;
  return {...product,image:approved.localImagePath};
};
export const reconcileContentImages = content => ({...content,products:(content.products || []).map(reconcileProductImage)});
