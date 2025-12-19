import fs from "fs";
import jwt from "jsonwebtoken";

/**
 * Generuje token dostępu do Vertex AI / Google Cloud bez potrzeby używania gcloud CLI.
 * Obsługuje dwa tryby:
 *  - Lokalny: używa GOOGLE_APPLICATION_CREDENTIALS (ścieżka do pliku JSON)
 *  - Chmurowy: używa GOOGLE_VOICEORDER_KEY_B64 (Base64-encoded key)
 */
export async function getVertexAccessToken() {
  let creds;

  // 🔹 1. Wczytanie danych serwisowych
  if (process.env.GOOGLE_VOICEORDER_KEY_B64) {
    console.log("✅ Using GOOGLE_VOICEORDER_KEY_B64 (Vercel/Cloud)");
    creds = JSON.parse(
      Buffer.from(process.env.GOOGLE_VOICEORDER_KEY_B64, "base64").toString("utf8")
    );
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log("✅ Using GOOGLE_APPLICATION_CREDENTIALS (local)");
    creds = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    console.log("✅ Using GOOGLE_APPLICATION_CREDENTIALS_JSON");
    creds = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    console.log("✅ Using GOOGLE_APPLICATION_CREDENTIALS_BASE64");
    creds = JSON.parse(
      Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, "base64").toString("utf8")
    );
  } else {
    // Fallback: spróbuj znaleźć plik w domyślnych lokalizacjach
    console.warn("⚠ No Google credentials found, trying default paths");
    const defaultPaths = [
      'FreeFlow.json',
      'service-account.json',
      './FreeFlow.json',
      './service-account.json'
    ];
    
    for (const path of defaultPaths) {
      if (fs.existsSync(path)) {
        console.log(`✅ Using default credentials: ${path}`);
        creds = JSON.parse(fs.readFileSync(path, "utf8"));
        break;
      }
    }
    
    if (!creds) {
      throw new Error("Brak konfiguracji klucza Google (GOOGLE_VOICEORDER_KEY_B64 lub GOOGLE_APPLICATION_CREDENTIALS)");
    }
  }

  // 🔹 2. Tworzenie tokena JWT
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const payload = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp,
  };

  const token = jwt.sign(payload, creds.private_key, { algorithm: "RS256" });

  // 🔹 3. Wymiana JWT na access_token
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: token,
    }),
  });

  const data = await response.json();
  if (!data.access_token) {
    console.error("❌ Vertex token error:", data);
    throw new Error("Nie udało się uzyskać tokenu dostępu do Vertex AI");
  }

  console.log("✅ Google access token obtained successfully");
  return data.access_token;
}
