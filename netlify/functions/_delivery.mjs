export const DEFAULT_DELIVERY_SETTINGS = Object.freeze({
  freeDeliveryThreshold: 1000,
  standardPudoFee: 80,
  collectionEnabled: true,
});

const money = (value) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);

export const sanitiseDeliverySettings = (settings = {}) => ({
  freeDeliveryThreshold: money(settings.freeDeliveryThreshold ?? DEFAULT_DELIVERY_SETTINGS.freeDeliveryThreshold),
  standardPudoFee: money(settings.standardPudoFee ?? DEFAULT_DELIVERY_SETTINGS.standardPudoFee),
  collectionEnabled: settings.collectionEnabled !== false,
});

export const calculateDelivery = ({ productSubtotal, productDiscount = 0, deliveryOption, settings }) => {
  const configured = sanitiseDeliverySettings(settings);
  const qualifyingSubtotal = money(productSubtotal - productDiscount);
  const freeDeliveryApplied = deliveryOption === "pudo" && qualifyingSubtotal >= configured.freeDeliveryThreshold;
  const deliveryFee = deliveryOption === "pudo" && !freeDeliveryApplied ? configured.standardPudoFee : 0;
  return { ...configured, qualifyingSubtotal, freeDeliveryApplied, deliveryFee };
};
