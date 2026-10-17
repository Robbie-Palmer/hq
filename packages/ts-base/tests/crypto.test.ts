import { describe, expect, it } from "vitest";
import { bytesToHex, sha256Bytes, sha256Hex } from "../src/crypto";

describe("SHA-256", () => {
  it("returns digest bytes and lowercase hexadecimal", async () => {
    const expected =
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
    const digest = await sha256Bytes("hello world");

    expect(bytesToHex(digest)).toBe(expected);
    await expect(sha256Hex("hello world")).resolves.toBe(expected);
    await expect(
      sha256Hex(new TextEncoder().encode("hello world")),
    ).resolves.toBe(expected);
  });
});
