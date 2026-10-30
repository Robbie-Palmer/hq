import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/lib/api/http", () => ({ apiRequest: mocks.apiRequest }));

import {
  retryTermReprojection,
  submitTermResolution,
} from "@/lib/api/term-resolution";

describe("term resolution API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiRequest.mockResolvedValue({});
  });

  it("sends only the strict target identity with a decision", async () => {
    const command = {
      action: "alias",
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      rationale: "Reviewed evidence.",
      targetSlug: "spring-onion",
    };
    const queueTarget = {
      kind: "ingredient" as const,
      normalizedText: "scallion",
      locale: "en-US",
      rawTexts: ["Scallion"],
    };

    await submitTermResolution({
      target: queueTarget,
      command,
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/admin/term-resolutions",
      {
        method: "POST",
        json: {
          target: {
            kind: "ingredient",
            normalizedText: "scallion",
            locale: "en-US",
          },
          command,
        },
      },
    );
  });

  it("encodes the decision ID for a reprojection retry", async () => {
    await retryTermReprojection("decision/with space");

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/admin/term-resolutions/decision%2Fwith%20space/reproject",
      { method: "POST" },
    );
  });
});
