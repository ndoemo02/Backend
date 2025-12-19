// api/_cors.js

export const ALLOWED_ORIGINS = [
  "https://freeflow-frontend-seven.vercel.app",
  "https://freeflow-backend.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "https://railroad-pharmacology-donald-trance.trycloudflare.com",
  "https://step-republic-hospital-blocking.trycloudflare.com",
  "https://", // Allow all Cloudflare tunnel origins (trycloudflare.com)
];

export const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "Accept",
  "Origin",
  "User-Agent",
  "Referer",
  "Accept-Encoding",
  "Accept-Language",
].join(",");

export function isAllowedOrigin(origin) {
  if (!origin) return true; // Allow requests without origin (e.g., Postman, curl)
  // Allow all Cloudflare tunnel origins
  if (origin.includes('trycloudflare.com')) {
    console.log('✅ Allowed Cloudflare origin:', origin);
    return true;
  }
  const isAllowed = ALLOWED_ORIGINS.some((allowed) => origin.startsWith(allowed));
  if (isAllowed) {
    console.log('✅ Allowed origin:', origin);
  } else {
    console.log('⚠️ Origin not in whitelist:', origin);
  }
  return isAllowed;
}

export function applyCORS(req, res) {
  const origin = req.headers.origin;
  
  // Always allow Cloudflare tunnel origins
  if (origin && origin.includes('trycloudflare.com')) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    console.log('✅ applyCORS: Allowed Cloudflare origin:', origin);
  } else if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else {
    // Fallback: allow all origins if not in whitelist (for development)
    res.setHeader("Access-Control-Allow-Origin", "*");
    console.log('⚠️ applyCORS: Using wildcard for origin:', origin);
  }

  // Allow PATCH/DELETE so Panel Klienta może aktualizować / anulować zamówienia
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}
