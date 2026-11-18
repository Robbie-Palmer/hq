import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import type { IngestParams } from "../src/index";

const mocks = vi.hoisted(() => ({
  admitBatchJob: vi.fn(),
  applyDisambiguationChoices: vi.fn(),
  applyEquipmentDecisionsToEntry: vi.fn((entry) => entry),
  applyLlmDecisionsToEntry: vi.fn((entry) => entry),
  buildCategoryMap: vi.fn(() => new Map()),
  buildCooklangDraftFromExtraction: vi.fn(),
  buildFinalDraft: vi.fn(),
  canonicalizePredictionEntry: vi.fn(),
  collectUnresolved: vi.fn(
    (_decisions: unknown): Array<{
      slug: string;
      candidates: Array<{ slug: string; category: string }>;
    }> => [],
  ),
  deriveRecipeFromCooklang: vi.fn(),
  disambiguateEquipment: vi.fn(),
  disambiguateIngredients: vi.fn(),
  extractEquipmentContext: vi.fn(() => ({ title: "Test recipe" })),
  extractRecipeContext: vi.fn(() => ({ title: "Test recipe" })),
  extractRecipeFromImages: vi.fn(),
  listSourceImageKeys: vi.fn(),
  loadImageDataUrls: vi.fn(),
  markJobFailed: vi.fn(),
  markJobRunning: vi.fn(),
  markJobSucceeded: vi.fn(),
  normalizeExtractionToCooklang: vi.fn(),
  readPhotoJobSourceManifest: vi.fn(),
  runBatchItem: vi.fn(),
  runLlmCall: vi.fn(),
  updateJobStage: vi.fn(),
  writeArtifact: vi.fn(),
  db: {
    kind: "test-db",
    select: vi.fn(),
  },
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));

vi.mock("cloudflare:workflows", () => ({
  NonRetryableError: class extends Error {
    override name = "NonRetryableError";
  },
}));

vi.mock("observability", () => ({
  SpanKind: { CONSUMER: "consumer" },
  withPostHogRequest: vi.fn((_options, operation) => operation()),
  withPostHogSpan: vi.fn((_options, operation) => operation()),
}));

vi.mock("recipe-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("recipe-db")>()),
  withDb: vi.fn(
    (_env: Env, operation: (db: typeof mocks.db) => unknown) =>
      operation(mocks.db),
  ),
}));

vi.mock("recipe-parsing/cooklang", () => ({
  buildCooklangDraftFromExtraction: mocks.buildCooklangDraftFromExtraction,
  deriveRecipeFromCooklang: mocks.deriveRecipeFromCooklang,
}));

vi.mock("recipe-parsing/disambiguation", () => ({
  applyDisambiguationChoices: mocks.applyDisambiguationChoices,
  applyEquipmentDecisionsToEntry: mocks.applyEquipmentDecisionsToEntry,
  applyLlmDecisionsToEntry: mocks.applyLlmDecisionsToEntry,
  buildCategoryMap: mocks.buildCategoryMap,
  collectUnresolved: mocks.collectUnresolved,
  extractEquipmentContext: mocks.extractEquipmentContext,
  extractRecipeContext: mocks.extractRecipeContext,
}));

vi.mock("recipe-parsing/ingredient-canonicalization", () => ({
  canonicalizePredictionEntry: mocks.canonicalizePredictionEntry,
}));

vi.mock("recipe-parsing/openrouter", () => ({
  disambiguateEquipment: mocks.disambiguateEquipment,
  disambiguateIngredients: mocks.disambiguateIngredients,
  extractRecipeFromImages: mocks.extractRecipeFromImages,
  normalizeExtractionToCooklang: mocks.normalizeExtractionToCooklang,
}));

vi.mock("../src/artifacts", () => ({ writeArtifact: mocks.writeArtifact }));

vi.mock("../src/attempts", () => ({ runLlmCall: mocks.runLlmCall }));

vi.mock("../src/batch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/batch")>()),
  admitBatchJob: mocks.admitBatchJob,
  runBatchItem: mocks.runBatchItem,
}));

vi.mock("../src/draft", () => ({ buildFinalDraft: mocks.buildFinalDraft }));

vi.mock("../src/images", () => ({
  listSourceImageKeys: mocks.listSourceImageKeys,
  loadImageDataUrls: mocks.loadImageDataUrls,
  readPhotoJobSourceManifest: mocks.readPhotoJobSourceManifest,
}));

vi.mock("../src/jobs", () => ({
  markJobFailed: mocks.markJobFailed,
  markJobRunning: mocks.markJobRunning,
  markJobSucceeded: mocks.markJobSucceeded,
  updateJobStage: mocks.updateJobStage,
}));

import handler, {
  awaitBatchAdmission,
  RecipeIngestWorkflow,
} from "../src/index";

const ctx = {
  waitUntil: vi.fn(),
} as unknown as ExecutionContext;
const env = {} as Env;

const extraction = {
  title: "Tomato soup",
  ingredientGroups: [{ lines: ["2 tomatoes"] }],
  instructions: ["Simmer the tomatoes."],
  equipment: ["pot"],
};
const derivedRecipe = {
  title: "Tomato soup",
  description: "A simple soup.",
  cuisine: ["Irish"],
  servings: 2,
  prepTime: 5,
  cookTime: 20,
  ingredientGroups: [
    { items: [{ ingredient: "tomato", amount: 2, unit: "piece" }] },
  ],
  instructions: ["Simmer the tomatoes."],
  cookware: ["pot"],
};
const cooklang = {
  frontmatter: { title: "Tomato soup", tags: [] },
  body: "@tomato{2%piece}\n\nSimmer in a #pot{}.",
  diagnostics: [],
  derived: derivedRecipe,
};
const draft = {
  recipe: derivedRecipe,
  cooklang,
  sourceImages: ["imports/job-1/source/0.jpg"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admitBatchJob.mockResolvedValue("admitted");
  mocks.db.select.mockReturnValue({
    from: () => ({ where: () => Promise.resolve([{ sourceChecksum: "sum-1" }]) }),
  });
  mocks.listSourceImageKeys.mockResolvedValue([
    "imports/job-1/source/0.jpg",
  ]);
  mocks.loadImageDataUrls.mockResolvedValue(["data:image/jpeg;base64,AA=="]);
  mocks.extractRecipeFromImages.mockResolvedValue(extraction);
  mocks.normalizeExtractionToCooklang.mockResolvedValue(cooklang);
  mocks.deriveRecipeFromCooklang.mockImplementation((value) => value);
  mocks.buildCooklangDraftFromExtraction.mockReturnValue(cooklang);
  mocks.canonicalizePredictionEntry.mockReturnValue({
    entry: {
      images: ["imports/job-1/source/0.jpg"],
      predicted: derivedRecipe,
    },
    decisions: [],
    cookwareDecisions: [],
  });
  mocks.runLlmCall.mockImplementation(({ call }) => call());
  mocks.buildFinalDraft.mockReturnValue(draft);
});

function admissionStep() {
  return {
    do: vi.fn(
      async (_name: string, operation: () => Promise<unknown>) => operation(),
    ),
    sleep: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkflowStep;
}

function workflowStep(attempt = 1) {
  return {
    do: vi.fn(
      async (
        _name: string,
        configOrOperation: unknown,
        operation?: (context: { attempt: number }) => Promise<unknown>,
      ) => {
        const run = operation ?? configOrOperation;
        return (run as (context: { attempt: number }) => Promise<unknown>)({
          attempt,
        });
      },
    ),
    sleep: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkflowStep;
}

function workflowEvent(
  payload: IngestParams,
): WorkflowEvent<IngestParams> {
  return { payload, instanceId: "instance-1" } as WorkflowEvent<IngestParams>;
}

function workflow(workerEnv = env) {
  return Object.assign(
    new RecipeIngestWorkflow(ctx as never, workerEnv),
    { env: workerEnv, ctx },
  );
}

describe("recipe ingest Worker", () => {
  it("returns its health response through the tracing wrapper", async () => {
    const response = await handler.fetch(
      new Request("https://recipe-ingest.example.test/health"),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "recipe-ingest",
    });
  });

  it("returns not found for unknown paths", async () => {
    const response = await handler.fetch(
      new Request("https://recipe-ingest.example.test/unknown"),
      env,
      ctx,
    );

    expect(response.status).toBe(404);
  });
});

describe("recipe ingestion workflow", () => {
  it("delegates non-photo batch items to the independent batch runner", async () => {
    const step = workflowStep();

    await workflow().run(
      workflowEvent({ jobId: "job-1", batchAttempt: 3 }),
      step,
    );

    expect(mocks.runBatchItem).toHaveBeenCalledWith(
      env,
      "job-1",
      3,
      "instance-1",
      step,
    );
    expect(mocks.listSourceImageKeys).not.toHaveBeenCalled();
  });

  it("runs the durable photo pipeline and records each persisted boundary", async () => {
    const step = workflowStep();

    await workflow().run(workflowEvent({ jobId: "job-1" }), step);

    expect(step.do).toHaveBeenCalledWith(
      "extract",
      {
        retries: { limit: 2, delay: 1_000, backoff: "exponential" },
        timeout: 90_000,
      },
      expect.any(Function),
    );
    expect(step.do).toHaveBeenCalledWith(
      "normalize",
      {
        retries: { limit: 2, delay: 1_000, backoff: "exponential" },
        timeout: 90_000,
      },
      expect.any(Function),
    );
    expect(mocks.writeArtifact.mock.calls.map(([value]) => value.kind)).toEqual([
      "extraction",
      "cooklang",
      "canonicalization-decisions",
      "draft",
    ]);
    expect(mocks.updateJobStage.mock.calls.map((call) => call[2])).toEqual([
      "normalize",
      "canonicalize",
      "finalize",
    ]);
    expect(mocks.markJobSucceeded).toHaveBeenCalledWith(
      mocks.db,
      "job-1",
      undefined,
    );
    expect(mocks.markJobFailed).not.toHaveBeenCalled();
  });

  it("uses the immutable photo manifest and publishes a batch review draft", async () => {
    const manifest = {
      manifestVersion: 2,
      manifestChecksum: "manifest-sum",
      groupChecksum: "group-sum",
      images: [
        {
          r2Key: "imports/job-1/source/group-0.png",
          checksum: "image-sum",
        },
      ],
    };
    mocks.readPhotoJobSourceManifest.mockResolvedValue(manifest);

    await workflow().run(
      workflowEvent({ jobId: "job-1", batchAttempt: 2, batchPhoto: true }),
      workflowStep(),
    );

    expect(mocks.readPhotoJobSourceManifest).toHaveBeenCalledWith(
      env,
      "job-1",
      "sum-1",
    );
    expect(mocks.listSourceImageKeys).not.toHaveBeenCalled();
    expect(mocks.loadImageDataUrls).toHaveBeenCalledWith(
      env,
      ["imports/job-1/source/group-0.png"],
      new Map([["imports/job-1/source/group-0.png", "image-sum"]]),
    );
    expect(mocks.writeArtifact).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "photo-group-source-manifest",
        payload: manifest,
        preview: {
          manifestVersion: 2,
          manifestChecksum: "manifest-sum",
          groupChecksum: "group-sum",
        },
      }),
    );
    expect(mocks.markJobRunning).toHaveBeenCalledWith(
      mocks.db,
      "job-1",
      "instance-1",
      2,
    );
    expect(mocks.markJobSucceeded).toHaveBeenCalledWith(mocks.db, "job-1", {
      batchAttempt: 2,
      draft: {
        title: "Tomato soup",
        description: "A simple soup.",
        cuisine: "Irish",
        servings: 2,
        prepTime: 5,
        cookTime: 20,
        source: cooklang.body,
      },
    });
  });

  it("falls back to a deterministic Cooklang draft when normalization fails", async () => {
    mocks.normalizeExtractionToCooklang.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );
    const fallback = {
      ...cooklang,
      diagnostics: ["Drafted without the provider."],
    };
    mocks.buildCooklangDraftFromExtraction.mockReturnValue(fallback);

    await workflow().run(workflowEvent({ jobId: "job-1" }), workflowStep());

    const normalizeArtifact = mocks.writeArtifact.mock.calls
      .map(([value]) => value)
      .find((value) => value.kind === "cooklang");
    expect(normalizeArtifact?.payload).toMatchObject({
      diagnostics: [
        "Drafted without the provider.",
        "Normalization LLM failed; using deterministic draft. (provider unavailable)",
      ],
    });
    expect(mocks.markJobSucceeded).toHaveBeenCalledOnce();
  });

  it("keeps a retryable disambiguation failure inside the durable retry budget", async () => {
    const ingredientDecisions = [
      {
        baseSlug: "red-pepper",
        canonicalSlug: "red-pepper",
        method: "none",
        candidates: [{ slug: "bell-pepper", score: 0.8 }],
      },
    ];
    mocks.canonicalizePredictionEntry.mockReturnValue({
      entry: { images: draft.sourceImages, predicted: derivedRecipe },
      decisions: ingredientDecisions,
      cookwareDecisions: [],
    });
    mocks.collectUnresolved.mockImplementation((decisions) =>
      decisions === ingredientDecisions
        ? [
            {
              slug: "red-pepper",
              candidates: [{ slug: "bell-pepper", category: "vegetable" }],
            },
          ]
        : [],
    );
    mocks.disambiguateIngredients.mockRejectedValueOnce(
      new Error("temporary provider error"),
    );

    await expect(
      workflow().run(workflowEvent({ jobId: "job-1" }), workflowStep(1)),
    ).rejects.toThrow("temporary provider error");

    expect(mocks.markJobFailed).toHaveBeenCalledWith(
      mocks.db,
      "job-1",
      "Error",
      "temporary provider error",
      undefined,
    );
    expect(mocks.markJobSucceeded).not.toHaveBeenCalled();
  });

  it("keeps the deterministic result after disambiguation retries are exhausted", async () => {
    const ingredientDecisions = [
      {
        baseSlug: "red-pepper",
        canonicalSlug: "red-pepper",
        method: "none",
        candidates: [{ slug: "bell-pepper", score: 0.8 }],
      },
    ];
    mocks.canonicalizePredictionEntry.mockReturnValue({
      entry: { images: draft.sourceImages, predicted: derivedRecipe },
      decisions: ingredientDecisions,
      cookwareDecisions: [],
    });
    mocks.collectUnresolved.mockImplementation((decisions) =>
      decisions === ingredientDecisions
        ? [
            {
              slug: "red-pepper",
              candidates: [{ slug: "bell-pepper", category: "vegetable" }],
            },
          ]
        : [],
    );
    mocks.disambiguateIngredients.mockRejectedValueOnce(
      new Error("provider still unavailable"),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await workflow().run(workflowEvent({ jobId: "job-1" }), workflowStep(2));

    expect(warning).toHaveBeenCalledWith(
      "LLM disambiguation failed for job job-1: provider still unavailable",
    );
    expect(mocks.applyDisambiguationChoices).toHaveBeenCalledWith(
      ingredientDecisions,
      expect.any(Array),
      [],
    );
    expect(mocks.markJobSucceeded).toHaveBeenCalledOnce();
    expect(mocks.markJobFailed).not.toHaveBeenCalled();
    warning.mockRestore();
  });

  it("records terminal source failures before rethrowing them", async () => {
    mocks.listSourceImageKeys.mockResolvedValueOnce([]);

    await expect(
      workflow().run(workflowEvent({ jobId: "job-1" }), workflowStep()),
    ).rejects.toThrow("No source images found for job job-1");

    expect(mocks.markJobRunning).not.toHaveBeenCalled();
    expect(mocks.markJobFailed).toHaveBeenCalledWith(
      mocks.db,
      "job-1",
      "NonRetryableError",
      "No source images found for job job-1",
      undefined,
    );
  });
});

describe("photo batch admission", () => {
  it("waits for capacity and retries with a stable execution fence", async () => {
    mocks.admitBatchJob
      .mockResolvedValueOnce("queued")
      .mockResolvedValueOnce("admitted");
    const step = admissionStep();

    await expect(
      awaitBatchAdmission(env, "job-1", 3, "instance-1", step),
    ).resolves.toBe(true);

    expect(step.do).toHaveBeenNthCalledWith(1, "admit-0", expect.any(Function));
    expect(step.do).toHaveBeenNthCalledWith(2, "admit-1", expect.any(Function));
    expect(step.sleep).toHaveBeenCalledOnce();
    expect(step.sleep).toHaveBeenCalledWith("wait-0", "5 seconds");
    expect(mocks.admitBatchJob).toHaveBeenCalledTimes(2);
    expect(mocks.admitBatchJob).toHaveBeenLastCalledWith(
      mocks.db,
      "job-1",
      3,
      "instance-1",
    );
  });

  it("stops an obsolete attempt without sleeping or retrying", async () => {
    mocks.admitBatchJob.mockResolvedValueOnce("obsolete");
    const step = admissionStep();

    await expect(
      awaitBatchAdmission(env, "job-2", 4, "instance-2", step),
    ).resolves.toBe(false);

    expect(step.do).toHaveBeenCalledOnce();
    expect(step.sleep).not.toHaveBeenCalled();
    expect(mocks.admitBatchJob).toHaveBeenCalledWith(
      mocks.db,
      "job-2",
      4,
      "instance-2",
    );
  });
});
