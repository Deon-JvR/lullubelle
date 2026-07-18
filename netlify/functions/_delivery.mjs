export const DEFAULT_DELIVERY_SETTINGS = Object.freeze({
  freeDeliveryThreshold: 1000,
  standardPudoFee: 80,
  collectionEnabled: true,
});

export const DOOR_TO_DOOR_METHOD = "door_to_door_flat_rate";
export const DOOR_TO_DOOR_FEE = 80;
export const SUPPORTED_DELIVERY_METHODS = Object.freeze(["collection", "pudo", DOOR_TO_DOOR_METHOD]);

export const normaliseDeliveryMethod = (value) => {
  const method = String(value || "").trim().toLowerCase();
  if (!SUPPORTED_DELIVERY_METHODS.includes(method)) throw new Error("Unsupported delivery method.");
  return method;
};

const money = (value) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);

export const sanitiseDeliverySettings = (settings = {}) => ({
  freeDeliveryThreshold: money(settings.freeDeliveryThreshold ?? DEFAULT_DELIVERY_SETTINGS.freeDeliveryThreshold),
  standardPudoFee: money(settings.standardPudoFee ?? DEFAULT_DELIVERY_SETTINGS.standardPudoFee),
  collectionEnabled: settings.collectionEnabled !== false,
});

export const calculateDelivery = ({ productSubtotal, productDiscount = 0, deliveryOption, settings }) => {
  const method = normaliseDeliveryMethod(deliveryOption);
  const configured = sanitiseDeliverySettings(settings);
  const qualifyingSubtotal = money(productSubtotal - productDiscount);
  const freeDeliveryApplied = method === "pudo" && qualifyingSubtotal >= configured.freeDeliveryThreshold;
  const deliveryFee = method === DOOR_TO_DOOR_METHOD
    ? DOOR_TO_DOOR_FEE
    : method === "pudo" && !freeDeliveryApplied ? configured.standardPudoFee : 0;
  return { ...configured, qualifyingSubtotal, freeDeliveryApplied, deliveryFee };
};
