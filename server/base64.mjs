const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBinary(bytes) {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return result;
}

export function base64ToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function bytesToBase64Url(value) {
  return btoa(bytesToBinary(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function utf8ToBase64Url(value) {
  return bytesToBase64Url(encoder.encode(String(value)));
}

export function base64UrlToUtf8(value) {
  return decoder.decode(base64ToBytes(value));
}

export function base64ToUtf8(value) {
  return decoder.decode(base64ToBytes(value));
}
