const sharedSecurityHeaders = Object.freeze({
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
  "X-Permitted-Cross-Domain-Policies": "none",
});

export const apiSecurityHeaders = sharedSecurityHeaders;
export const xmlSecurityHeaders = sharedSecurityHeaders;
export const htmlSecurityHeaders = Object.freeze({
  ...sharedSecurityHeaders,
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.google.com https://www.googletagmanager.com; media-src 'self' blob:; frame-src 'none'; child-src 'none'; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests",
});

export const mergeSecurityHeaders = (headers = {}, securityHeaders = apiSecurityHeaders) => {
  const merged = { ...headers };
  Object.entries(securityHeaders).forEach(([name, value]) => {
    Object.keys(merged)
      .filter((existingName) => existingName.toLowerCase() === name.toLowerCase())
      .forEach((existingName) => delete merged[existingName]);
    merged[name] = value;
  });
  return merged;
};
