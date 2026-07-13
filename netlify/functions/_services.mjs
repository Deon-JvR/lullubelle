export const SERVICE_CATALOGUE_VERSION = "2026-03-23-draft-2";

const key = (value) => String(value || "").trim().toLowerCase();

export const validateServiceCatalogue = (treatments = []) => {
  if (!Array.isArray(treatments) || !treatments.length) return "The service catalogue is empty.";
  const ids = treatments.map((item) => key(item?.id));
  const duplicateId = ids.find((id, index) => id && ids.indexOf(id) !== index);
  if (duplicateId) return `Duplicate treatment ID: ${duplicateId}.`;
  for (const treatment of treatments) {
    if (!key(treatment?.id) || !String(treatment?.category || "").trim() || !String(treatment?.name || "").trim()) {
      return "Every treatment requires an ID, category and name.";
    }
    if (!/^(?:R\d+|Confirm)$/.test(String(treatment?.price || ""))) {
      return `Invalid treatment price for ${treatment.name}.`;
    }
  }
  return "";
};

export const migrateServiceCatalogue = (storedContent = {}, seedContent = {}) => {
  if (storedContent?.serviceCatalogueVersion === SERVICE_CATALOGUE_VERSION) {
    return { content: storedContent, changed: false };
  }
  const treatments = Array.isArray(seedContent?.treatments) ? seedContent.treatments : [];
  const validationError = validateServiceCatalogue(treatments);
  if (validationError) throw new Error(`Seed service catalogue is invalid: ${validationError}`);
  return {
    changed: true,
    content: {
      ...storedContent,
      treatments,
      serviceCatalogueVersion: SERVICE_CATALOGUE_VERSION,
    },
  };
};
