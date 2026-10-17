const textEncoder = new TextEncoder();

export async function sha256Bytes(
  value: string | Uint8Array,
): Promise<Uint8Array> {
  const source = typeof value === "string" ? textEncoder.encode(value) : value;
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes,
  );
  return new Uint8Array(digest);
}

export function bytesToHex(value: Uint8Array): string {
  return [...value]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(
  value: string | Uint8Array,
): Promise<string> {
  return bytesToHex(await sha256Bytes(value));
}
