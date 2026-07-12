const INVALID_GALLERY_IMAGE = /(?:^|\/)(?:lullubelle-logo|placeholder)(?:[.\-_\/]|$)|^data:image/i;

const normaliseImage = (value) => {
  const image = String(value || "").trim();
  if (!image || INVALID_GALLERY_IMAGE.test(image)) return "";
  if (/^\.\.\/before-after-images\//i.test(image)) return `/${image.replace(/^\.\.\//, "")}`;
  if (/^(?:\/before-after-images\/|\/\.netlify\/functions\/admin-asset\?key=|https?:\/\/)/i.test(image)) return image;
  return "";
};

const isPublished = (item) => item?.hidden !== true
  && item?.active !== false
  && item?.published !== false
  && !/^(draft|inactive|archived)$/i.test(String(item?.status || ""));

export const sanitiseGallery = (items, { publicOnly = false } = {}) => {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const id = String(item.id || "").trim();
    const image = normaliseImage(item.image);
    if (!id || seen.has(id) || !image || (publicOnly && !isPublished(item))) return [];
    seen.add(id);
    const order = Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1;
    return [{
      ...item,
      id,
      title: String(item.title || "").trim(),
      category: String(item.category || "").trim(),
      categories: String(item.categories || "").trim(),
      description: String(item.description || "").trim(),
      treatments: String(item.treatments || "").trim(),
      image,
      order,
      featured: Boolean(item.featured),
      hidden: Boolean(item.hidden),
    }];
  }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
};
