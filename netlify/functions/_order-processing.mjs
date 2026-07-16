export const ORDER_PROCESSING_NOTICE = "Orders are processed within 5–10 business days before collection or dispatch.";

const digitalOnlyId = (item) => /^(gift-voucher-|online-skin-consultation)/i.test(String(item?.id || ""));

export const requiresPhysicalFulfilment = (products = []) => Array.isArray(products)
  && products.some((product) => !digitalOnlyId(product));

export const fulfilmentDetail = (deliveryOption) => String(deliveryOption || "").toLowerCase() === "collection"
  ? "Collection is available only after we notify you that your order is ready."
  : "Delivery transit time begins only after your order has been dispatched.";

const escapeHtml = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

export const buildCustomerOrderConfirmationEmail = (order = {}) => {
  const showProcessingNotice = requiresPhysicalFulfilment(order.products);
  const detail = fulfilmentDetail(order.delivery?.option || order.deliveryOption);
  const processingText = showProcessingNotice ? `\n\n${ORDER_PROCESSING_NOTICE}\n${detail}` : "";
  const processingHtml = showProcessingNotice ? `<p><strong>${ORDER_PROCESSING_NOTICE}</strong><br>${detail}</p>` : "";
  return {
    subject: `Lullubelle order ${String(order.orderNumber || "confirmation")}`,
    text: `Thank you for your Lullubelle order.${processingText}`,
    html: `<p>Thank you for your Lullubelle order${order.orderNumber ? ` <strong>${escapeHtml(order.orderNumber)}</strong>` : ""}.</p>${processingHtml}`,
  };
};
