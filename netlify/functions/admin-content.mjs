import { json, readContent } from "./_admin-shared.mjs";

export const handler = async () => {
  const content = await readContent();
  return json(200, content, {
    "Cache-Control": "public, max-age=0, must-revalidate",
  });
};
