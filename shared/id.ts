interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint8Array) => Uint8Array;
}

let fallbackSequence = 0;

function globalCrypto(): CryptoLike | null {
  return typeof globalThis.crypto === "object" ? globalThis.crypto as CryptoLike : null;
}

function formatUuid(bytes: Uint8Array) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/**
 * Creates a non-secret identifier in both secure and non-secure browser contexts.
 * Plain HTTP does not expose crypto.randomUUID(), but getRandomValues() can still
 * provide enough entropy for dashboard record IDs.
 */
export function createClientId(prefix: string, source?: CryptoLike | null) {
  const cryptoSource = source === undefined ? globalCrypto() : source;

  try {
    if (typeof cryptoSource?.randomUUID === "function") {
      return `${prefix}-${cryptoSource.randomUUID()}`;
    }
  } catch {
    // Continue with an HTTP-compatible fallback.
  }

  try {
    if (typeof cryptoSource?.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoSource.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return `${prefix}-${formatUuid(bytes)}`;
    }
  } catch {
    // Continue with the last-resort collision-resistant fallback.
  }

  fallbackSequence += 1;
  const entropy = Math.random().toString(36).slice(2).padEnd(10, "0").slice(0, 10);
  return `${prefix}-${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${entropy}`;
}
