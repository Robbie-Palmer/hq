import { afterEach, describe, expect, it, vi } from "vitest";
import { createReviewEventId } from "../domain/review-event-id";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("review event IDs", () => {
  it("creates a UUID accepted by the review contract", () => {
    expect(createReviewEventId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(values: Uint8Array) {
        values.set(Array.from({ length: 16 }, (_, index) => index));
        return values;
      },
    });

    expect(createReviewEventId()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("rejects browsers without a secure random source", () => {
    vi.stubGlobal("crypto", {});

    expect(() => createReviewEventId()).toThrow(TypeError);
  });
});
