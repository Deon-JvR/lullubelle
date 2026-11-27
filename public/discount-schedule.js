// The shop schedules promotions in South African Standard Time (UTC+02:00).
const localDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
export const discountTimestamp = (value) => Date.parse(localDateTime.test(value) ? value + "+02:00" : value);

export const discountFormTime = (value) => {
  if (!value || localDateTime.test(value)) return value || "";
  const timestamp = discountTimestamp(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp + 2 * 60 * 60 * 1000).toISOString().replace(/(?:\.000)?Z$/, "");
};
