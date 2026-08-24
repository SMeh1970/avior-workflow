import { base64ToBytes, base64ToUtf8, bytesToBase64Url, utf8ToBase64Url } from "./base64.mjs";

const tokenCache = new Map();
const keyCache = new Map();

function base64url(value) {
  return utf8ToBase64Url(value);
}

function readCredentials(config) {
  let raw = config.serviceAccountJson;
  if (!raw && config.serviceAccountJsonBase64) {
    raw = base64ToUtf8(config.serviceAccountJsonBase64);
  }
  if (!raw) {
    throw new Error(
      "Для AVIOR_STORAGE=google задайте GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 как секрет хостинга."
    );
  }
  const credentials = JSON.parse(raw);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("JSON служебной учётной записи не содержит client_email/private_key.");
  }
  return credentials;
}

async function getSigningKey(credentials) {
  if (keyCache.has(credentials.client_email)) return keyCache.get(credentials.client_email);
  const body = credentials.private_key
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(body),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  keyCache.set(credentials.client_email, key);
  return key;
}

export async function getGoogleAccessToken(config) {
  const credentials = readCredentials(config);
  const cached = tokenCache.get(credentials.client_email);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > nowSeconds) return cached.token;

  const tokenUri = credentials.token_uri || "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await getSigningKey(credentials),
    new TextEncoder().encode(unsigned)
  );
  const assertion = `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) {
    throw new Error(`Google OAuth: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  tokenCache.set(credentials.client_email, {
    token: payload.access_token,
    expiresAt: nowSeconds + Number(payload.expires_in || 3600)
  });
  return payload.access_token;
}
