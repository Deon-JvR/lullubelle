// Edge responses stop the routing chain before Netlify can forward the
// legacy query into a serverless redirect's Location header.
export const legacyProductRedirect = async (request, resolveProduct = fetch) => {
  const source = new URL(request.url);
  const lookup = new URL("/.netlify/functions/product-page", source);
  lookup.search = source.search;
  try {
    const response = await resolveProduct(lookup, {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 301) {
      const destination = new URL(response.headers.get("location"), source);
      if (destination.origin !== source.origin || !/^\/products\/[^/]+$/.test(destination.pathname)) {
        throw new Error("Invalid product redirect destination");
      }
      destination.search = "";
      destination.hash = "";
      return new Response(null, {
        status: 301,
        headers: { Location: destination.href, "Cache-Control": "no-store" },
      });
    }
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("<h1>Catalogue temporarily unavailable</h1>", {
      status: 503,
      headers: { "Content-Type": "text/html; charset=UTF-8", "Retry-After": "60" },
    });
  }
};

export default (request) => legacyProductRedirect(request);
