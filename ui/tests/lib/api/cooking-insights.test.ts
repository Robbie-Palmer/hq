import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOKING_COMPLETION_OUTBOX_STORAGE_KEY,
  flushCookingCompletionOutbox,
  getCookingInsights,
  queueCookingCompletion,
  recordCookingCompletionReliably,
  recordCookingSession,
} from "@/lib/api/cooking-insights";

function cookingOutcome() {
  return {
    leftoverPortions: 1,
    leftoverStorage: "fridge" as const,
    leftoverUseBy: null,
    audience: "personal" as const,
  };
}

describe("cooking insights API", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the user's cook log", async () => {
    const insights = {
      cookModeStarts: 3,
      mealsCooked: 2,
      distinctRecipesCooked: 1,
      recent: [],
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(insights));

    await expect(getCookingInsights()).resolves.toEqual(insights);
    expect(fetchMock).toHaveBeenCalledWith("/api/profile/cooking-insights", {
      credentials: "same-origin",
      signal: undefined,
    });
  });

  it("records start and completion events through the same idempotent session", async () => {
    const cookingSession = {
      id: "2f64837b-3f3e-4c18-ae39-35df6808dc6c",
      recipeSlug: "weeknight-pasta",
      recipeTitle: "Weeknight pasta",
      recipeVersion: "2026-07-28T17:00:00.000Z",
      servings: 2,
      startedAt: "2026-07-28T17:30:00.000Z",
      completedAt: null,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ cookingSession }));
    const event = {
      sessionId: cookingSession.id,
      recipeSlug: cookingSession.recipeSlug,
      recipeTitle: cookingSession.recipeTitle,
      recipeVersion: "2026-07-28T17:00:00.000Z",
      servings: cookingSession.servings,
      event: "started" as const,
    };

    await expect(recordCookingSession(event)).resolves.toEqual(cookingSession);
    expect(fetchMock).toHaveBeenCalledWith("/api/profile/cooking-sessions", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true,
    });
  });

  it("surfaces API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: "Cooking history is unavailable" },
        { status: 503 },
      ),
    );

    await expect(getCookingInsights()).rejects.toMatchObject({
      message: "Cooking history is unavailable",
      status: 503,
    });
  });

  it("persists a completion until its immediate write succeeds", async () => {
    const completion = {
      sessionId: "2f64837b-3f3e-4c18-ae39-35df6808dc6c",
      recipeSlug: "weeknight-pasta",
      recipeTitle: "Weeknight pasta",
      recipeVersion: "2026-07-28T17:00:00.000Z",
      servings: 2,
      event: "completed" as const,
      outcome: cookingOutcome(),
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(
        Response.json({
          cookingSession: {
            id: completion.sessionId,
            recipeSlug: completion.recipeSlug,
            recipeTitle: completion.recipeTitle,
            servings: completion.servings,
            startedAt: "2026-07-28T17:30:00.000Z",
            completedAt: "2026-07-28T18:05:00.000Z",
          },
        }),
      );

    await expect(
      recordCookingCompletionReliably("cook-1", completion),
    ).rejects.toThrow("offline");
    expect(
      JSON.parse(
        localStorage.getItem(COOKING_COMPLETION_OUTBOX_STORAGE_KEY) ?? "[]",
      ),
    ).toEqual([
      expect.objectContaining({
        userId: "cook-1",
        event: completion,
      }),
    ]);

    await expect(
      flushCookingCompletionOutbox("cook-1"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      localStorage.getItem(COOKING_COMPLETION_OUTBOX_STORAGE_KEY),
    ).toBeNull();
  });

  it("flushes only completions belonging to the active account", async () => {
    const firstUserCompletion = {
      sessionId: "72f99e71-a5cb-472a-adb4-2761a25a5651",
      recipeSlug: "first-user-recipe",
      recipeTitle: "First user's recipe",
      recipeVersion: "2026-07-28T17:00:00.000Z",
      servings: 2,
      event: "completed" as const,
      outcome: cookingOutcome(),
    };
    const secondUserCompletion = {
      sessionId: "a86555ab-a4c2-4692-93ed-b7678dc23b27",
      recipeSlug: "second-user-recipe",
      recipeTitle: "Second user's recipe",
      recipeVersion: "2026-07-28T17:00:00.000Z",
      servings: 4,
      event: "completed" as const,
      outcome: cookingOutcome(),
    };
    queueCookingCompletion("cook-1", firstUserCompletion);
    queueCookingCompletion("cook-2", secondUserCompletion);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        cookingSession: {
          id: secondUserCompletion.sessionId,
          recipeSlug: secondUserCompletion.recipeSlug,
          recipeTitle: secondUserCompletion.recipeTitle,
          servings: secondUserCompletion.servings,
          startedAt: "2026-07-28T17:30:00.000Z",
          completedAt: "2026-07-28T18:05:00.000Z",
        },
      }),
    );

    await flushCookingCompletionOutbox("cook-2");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify(secondUserCompletion),
    );
    expect(
      JSON.parse(
        localStorage.getItem(COOKING_COMPLETION_OUTBOX_STORAGE_KEY) ?? "[]",
      ),
    ).toEqual([
      expect.objectContaining({
        userId: "cook-1",
        event: firstUserCompletion,
      }),
    ]);
  });

  it("drops permanently invalid queued events instead of retrying forever", async () => {
    const completion = {
      sessionId: "cc191c61-2439-46f4-9001-7509f600ea1c",
      recipeSlug: "stale-recipe",
      recipeTitle: "Stale recipe",
      recipeVersion: "2026-07-28T17:00:00.000Z",
      servings: 2,
      event: "completed" as const,
      outcome: cookingOutcome(),
    };
    queueCookingCompletion("cook-1", completion);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "Invalid cooking event" }, { status: 422 }),
    );

    await expect(
      flushCookingCompletionOutbox("cook-1"),
    ).resolves.toBeUndefined();
    expect(
      localStorage.getItem(COOKING_COMPLETION_OUTBOX_STORAGE_KEY),
    ).toBeNull();
  });
});
