import { contentStore, newId, readList } from "./_admin-shared.mjs";

export const DISCOUNTS_KEY = "discounts";
const RESERVATION_PREFIX = "discount-redemption/";
const money = (value) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
export const normalisePromoCode = (value) => String(value || "").trim().toUpperCase();

const strings = (value) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
const optionalNumber = (value) => value === "" || value == null ? null : Number(value);

export const sanitiseDiscount = (input, existing = {}) => ({
  ...existing,
  id: existing.id || input.id || newId("discount"),
  code: normalisePromoCode(input.code),
  name: String(input.name || "").trim(),
  description: String(input.description || "").trim(),
  type: input.type === "fixed" ? "fixed" : "percentage",
  value: money(input.value),
  active: input.active !== false,
  archived: Boolean(input.archived),
  startsAt: input.startsAt || "",
  expiresAt: input.expiresAt || "",
  minimumOrderAmount: money(input.minimumOrderAmount),
  maximumDiscountAmount: optionalNumber(input.maximumDiscountAmount) == null ? null : money(input.maximumDiscountAmount),
  usageLimit: optionalNumber(input.usageLimit),
  usageLimitPerCustomer: optionalNumber(input.usageLimitPerCustomer),
  customerEmail: String(input.customerEmail || "").trim().toLowerCase(),
  firstOrderOnly: Boolean(input.firstOrderOnly),
  scope: ["brands", "products", "categories"].includes(input.scope) ? input.scope : "order",
  brandIds: strings(input.brandIds),
  productIds: strings(input.productIds),
  categories: strings(input.categories),
  excludedBrandIds: strings(input.excludedBrandIds),
  excludedProductIds: strings(input.excludedProductIds),
  freeDelivery: Boolean(input.freeDelivery),
  createdAt: existing.createdAt || input.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export const validateDiscountRecord = (discount, all = []) => {
  if (!discount.code) return "Promo code is required.";
  if (!discount.name) return "Internal name is required.";
  if (!(discount.value > 0) && !discount.freeDelivery) return "Enter a discount value or enable free delivery.";
  if (discount.type === "percentage" && discount.value > 100) return "Percentage discounts cannot exceed 100%.";
  if (discount.expiresAt && discount.startsAt && new Date(discount.expiresAt) <= new Date(discount.startsAt)) return "Expiry must be after the start date.";
  if (all.some((item) => item.id !== discount.id && normalisePromoCode(item.code) === discount.code && !item.archived)) return "That promo code already exists.";
  return "";
};

const eligibleItems = (discount, products) => products.filter((item) => {
  if (discount.excludedProductIds.includes(item.id) || discount.excludedBrandIds.includes(item.brandId)) return false;
  if (discount.scope === "products") return discount.productIds.includes(item.id);
  if (discount.scope === "brands") return discount.brandIds.includes(item.brandId);
  if (discount.scope === "categories") return discount.categories.some((category) => category.toLowerCase() === String(item.category || "").toLowerCase());
  return true;
});

export const calculateDiscount = ({ discount, products, subtotal, deliveryFee }) => {
  const eligible = eligibleItems(discount, products);
  const eligibleSubtotal = money(eligible.reduce((sum, item) => sum + item.price * item.quantity, 0));
  if (!eligible.length && !discount.freeDelivery) throw new Error("This promo code does not apply to the selected products.");
  let productDiscount = discount.type === "percentage" ? eligibleSubtotal * discount.value / 100 : Math.min(discount.value, eligibleSubtotal);
  if (discount.type === "percentage" && discount.maximumDiscountAmount != null) productDiscount = Math.min(productDiscount, discount.maximumDiscountAmount);
  productDiscount = money(Math.min(productDiscount, subtotal));
  const deliveryDiscount = discount.freeDelivery ? money(deliveryFee) : 0;
  const discountAmount = money(productDiscount + deliveryDiscount);
  return { eligibleSubtotal, productDiscount, deliveryDiscount, discountAmount, deliveryFee: money(deliveryFee - deliveryDiscount), total: money(subtotal + deliveryFee - discountAmount) };
};

export const validatePromo = async ({ code, email, products, subtotal, deliveryFee, now = new Date() }) => {
  const normalisedCode = normalisePromoCode(code);
  const discounts = await readList(DISCOUNTS_KEY);
  const discount = discounts.find((item) => normalisePromoCode(item.code) === normalisedCode && !item.archived);
  if (!discount) throw new Error("Invalid promo code.");
  if (!discount.active) throw new Error("This promo code is inactive.");
  if (discount.startsAt && now < new Date(discount.startsAt)) throw new Error("This promo code has not started yet.");
  if (discount.expiresAt && now >= new Date(discount.expiresAt)) throw new Error("This promo code has expired.");
  if (subtotal < Number(discount.minimumOrderAmount || 0)) throw new Error(`This promo code requires a minimum order of R${money(discount.minimumOrderAmount).toFixed(2)}.`);
  const customerEmail = String(email || "").trim().toLowerCase();
  if (discount.customerEmail && discount.customerEmail !== customerEmail) throw new Error("This promo code is restricted to another customer.");
  const orders = await readList("orders");
  const redeemed = orders.filter((order) => order.promoCode === discount.code && order.paymentStatus !== "Unpaid" && order.orderStatus !== "Cancelled");
  if (discount.usageLimit && redeemed.length >= discount.usageLimit) throw new Error("This promo code has reached its usage limit.");
  if (discount.usageLimitPerCustomer && redeemed.filter((order) => String(order.customer?.email || "").toLowerCase() === customerEmail).length >= discount.usageLimitPerCustomer) throw new Error("You have reached the usage limit for this promo code.");
  if (discount.firstOrderOnly && orders.some((order) => String(order.customer?.email || "").toLowerCase() === customerEmail && order.paymentStatus === "Paid")) throw new Error("This promo code is for first orders only.");
  return { discount, ...calculateDiscount({ discount, products, subtotal, deliveryFee }) };
};

export const reserveRedemption = async ({ discount, email, orderNumber }) => {
  if (!discount.usageLimit && !discount.usageLimitPerCustomer) return "";
  const reservationId = `${RESERVATION_PREFIX}${encodeURIComponent(discount.code)}/${orderNumber}`;
  await contentStore().setJSON(reservationId, { code: discount.code, email: String(email).toLowerCase(), orderNumber, createdAt: new Date().toISOString() });
  const { blobs = [] } = await contentStore().list({ prefix: `${RESERVATION_PREFIX}${encodeURIComponent(discount.code)}/` });
  const active = blobs.map((blob) => blob.key).sort();
  const rank = active.indexOf(reservationId);
  if (discount.usageLimit && rank >= discount.usageLimit) {
    await contentStore().delete(reservationId);
    throw new Error("This promo code has just reached its usage limit.");
  }
  if (discount.usageLimitPerCustomer) {
    const records = await Promise.all(active.slice(0, rank + 1).map((key) => contentStore().get(key, { type: "json" })));
    if (records.filter((item) => item?.email === String(email).toLowerCase()).length > discount.usageLimitPerCustomer) {
      await contentStore().delete(reservationId);
      throw new Error("You have reached the usage limit for this promo code.");
    }
  }
  return reservationId;
};

export const releaseRedemption = async (reservationId) => {
  if (reservationId) await contentStore().delete(reservationId).catch(() => {});
};
