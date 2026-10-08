import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractRecipeFromImages, imagePathToDataUrl } = vi.hoisted(() => ({
  extractRecipeFromImages: vi.fn(),
  imagePathToDataUrl: vi.fn(),
}));

vi.mock("recipe-parsing/openrouter", () => ({ extractRecipeFromImages }));
vi.mock("../../src/lib/images.js", () => ({ imagePathToDataUrl }));

const { extractEntryWithRetries } = await import(
  "../../src/stages/extract.js"
);

const extractedRecipe = {
  title: "Soup",
  ingredientGroups: [{ lines: ["1 potato"] }],
  instructions: ["Cook."],
  equipment: [],
};

const params = {
  apiKey: "test-key",
  images: ["soup.jpg"],
  model: "test-model",
  requestTimeoutMs: 1_000,
  maxRetries: 1,
  maxImageDimension: 1_600,
  jpegQuality: 80,
  backoffBaseDelayMs: 0,
  backoffMaxDelayMs: 0,
};

describe("extractEntryWithRetries", () => {
  beforeEach(() => {
    extractRecipeFromImages.mockReset();
    imagePathToDataUrl.mockReset();
    imagePathToDataUrl.mockResolvedValue("data:image/jpeg;base64,test");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns an entry-level failure when an image cannot be read", async () => {
    imagePathToDataUrl.mockRejectedValue(new Error("unreadable image"));

    const result = await extractEntryWithRetries(params);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        stage: "extraction",
        attemptCount: 1,
        errorMessage: "unreadable image",
      },
    });
    expect(extractRecipeFromImages).not.toHaveBeenCalled();
  });

  it("retries a transient provider failure and preserves the extraction", async () => {
    const transient = Object.assign(new Error("provider unavailable"), {
      status: 503,
      requestID: "request-1",
    });
    extractRecipeFromImages
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ value: extractedRecipe });

    const result = await extractEntryWithRetries(params);

    expect(result).toEqual({
      ok: true,
      prediction: { images: ["soup.jpg"], extracted: extractedRecipe },
    });
    expect(extractRecipeFromImages).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("status=503, request_id=request-1"),
    );
  });

  it("stops after a non-retryable provider failure", async () => {
    const invalid = Object.assign(new Error("invalid request"), {
      status: 400,
      code: "bad_request",
      type: "invalid_request_error",
      error: { message: "invalid request" },
    });
    extractRecipeFromImages.mockRejectedValue(invalid);

    const result = await extractEntryWithRetries(params);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        attemptCount: 1,
        statusCode: 400,
        providerErrorCode: "bad_request",
        providerErrorType: "invalid_request_error",
      },
    });
    expect(extractRecipeFromImages).toHaveBeenCalledTimes(1);
  });
});
