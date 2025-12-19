import fetch from "node-fetch";

/**
 * Retrieves an OAuth2 access token for Google Vertex AI using
 * a service account (JWT Bearer grant).
 */
export async function getVertexAccessToken() {
  const GOOGLE_OAUTH_URL =
    "https://oauth2.googleapis.com/token";

  const {
    GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY,
  } = process.env;

  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error("Missing Google service account credentials");
  }

  const jwtHeader = {
    alg: "RS256",
    typ: "JWT",
  };

  const jwtClaim = {
    iss: GOOGLE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: GOOGLE_OAUTH_URL,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };

  const base64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const header = base64url(jwtHeader);
  const claim = base64url(jwtClaim);

  const crypto = await import("node:crypto");

  const signature = crypto
    .createSign("RSA-SHA256")
    .update(`${header}.${claim}`)
    .sign(GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${header}.${claim}.${signature}`;

  const res = await fetch(GOOGLE_OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  return data.access_token;
}
