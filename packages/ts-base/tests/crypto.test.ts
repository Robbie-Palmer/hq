import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/crypto";

describe("sha256Hex", () => {
  it("returns the lowercase SHA-256 digest", async () => {
    await expect(sha256Hex("hello world")).resolves.toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });
});
