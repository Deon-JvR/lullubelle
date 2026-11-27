import "../../public/catalogue-card.js";
import { sanitiseDeliverySettings, DOOR_TO_DOOR_FEE } from "./_delivery.mjs";
export const SITE_URL = "https://www.lullubelle.co.za";
export const publicProduct = (p) => Boolean(p?.id) && p.hidden !== true && p.active !== false && p.published !== false && !/^(draft|inactive|archived)$/i.test(String(p.status || ""));
export const saleProduct = (p) => publicProduct(p) && !/out|coming|pre.?order/i.test(String(p.stockStatus || "")) && Number(p.price) > 0;
export const escapeHtml = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
export const safeJson = (v) => JSON.stringify(v).replace(/</g,"\\u003c");
export const moneyLabel = (v) => `R${Number(v).toFixed(2)}`;
export const productPath = (p) => `/products/${encodeURIComponent(p.slug || p.id)}`;
export const brandSlug = (b) => b.id === "new-brand" ? "launch-bundles" : String(b.id || b.brandId || b.brand || b.name).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
export const brandsFor = (content) => (content.brands || []).filter(b => b.active !== false && (content.products || []).some(p => publicProduct(p) && (p.brandId === b.id || p.brand === b.name)));
export const publicContent = (content) => ({ ...content, publicCatalogue: true, products: (content.products || []).filter(publicProduct) });
const cardKeys = ["id","slug","brand","brandId","name","price","image","imageAlt","size","stockStatus","categories","sku","benefit","description","searchKeywords","featured","bestSeller","order"];
export const bootstrap = (content, { mode = "shop", ids = [] } = {}) => {
  const products = (content.products || []).filter(publicProduct);
  const data = { publicCatalogue:true, needsCatalogueRefresh:mode === "shop", completeCatalogue:["cart","legacy"].includes(mode), productCategories:content.productCategories || [], deliverySettings:content.deliverySettings, brands:content.brands || [], products:[], treatments:[], gallery:[], vouchers:[] };
  if (mode === "product") data.products=products.filter(p=>ids.includes(p.id));
  else if (["home","cart","legacy"].includes(mode)) data.products=products.map(p=>{
    const keys=mode==="home" && !ids.includes(p.id) ? ["id","brand","brandId"] : ["cart","legacy"].includes(mode) ? ["id","slug","brand","brandId","name","price","image","stockStatus","sku"] : mode === "shop" ? cardKeys.filter(k=>!["description","searchKeywords"].includes(k)) : cardKeys;
    return Object.fromEntries(keys.filter(k=>p[k] !== undefined).map(k=>[k,p[k]]));
  });
  if (["gallery","home"].includes(mode)) data.gallery=content.gallery || [];
  if (mode === "pricelist") data.treatments=content.treatments || [];
  if (mode === "cart") data.vouchers=content.vouchers || [];
  if (mode === "product") data.productShippingDetails=Object.fromEntries(data.products.map(p=>[p.id,shippingDetails(content.deliverySettings,p.price)]));
  return `<script data-public-catalogue>window.LULLUBELLE_INITIAL_CONTENT=${safeJson(data)};</script>`;
};
// Google's supported global-policy reference avoids inventing transit times or
// flattening the basket-based free-PUDO threshold into a per-product rate.
export const shippingDetails = () => ["pudo","door"].map(method=>({"@type":"OfferShippingDetails",hasShippingService:{"@id":`${SITE_URL}/shipping-policy#${method}`}}));
export const shippingServices = settings => {
  const s=sanitiseDeliverySettings(settings);
  const condition=(rate,range)=>({"@type":"ShippingConditions",shippingDestination:{"@type":"DefinedRegion",addressCountry:"ZA"},...(range?{orderValue:{"@type":"MonetaryAmount",currency:"ZAR",...range}}:{}),shippingRate:{"@type":"MonetaryAmount",value:rate,currency:"ZAR"}});
  const pudoConditions = s.freeDeliveryThreshold > 0
    ? [condition(s.standardPudoFee, { minValue: 0, maxValue: s.freeDeliveryThreshold - 0.01 }), condition(0, { minValue: s.freeDeliveryThreshold })]
    : [condition(s.standardPudoFee)];
  return [
    {"@type":"ShippingService","@id":`${SITE_URL}/shipping-policy#pudo`,name:"PUDO locker delivery",fulfillmentType:"https://schema.org/FulfillmentTypeCollectionPoint",shippingConditions:pudoConditions},
    {"@type":"ShippingService","@id":`${SITE_URL}/shipping-policy#door`,name:"Door-to-door delivery",fulfillmentType:"https://schema.org/FulfillmentTypeDelivery",shippingConditions:[condition(DOOR_TO_DOOR_FEE)]},
  ];
};
export const productCard = globalThis.LullubelleCatalogueCard;
export const featuredCard = globalThis.LullubelleFeaturedCard;
