// Authenticated preview smoke test that runs inside the protected GitHub
// environment. It creates a Better Auth session directly against the isolated
// preview database, then exercises the deployed Worker without bypassing
// Cloudflare Access on the Pages UI.
import { requiredEnv } from "node-base/env";
import { previewScenarios } from "../src/preview-scenarios";
import { createPreviewSessionCookie } from "./preview-session";

type CookingInsights = {
  cookModeStarts: number;
  mealsCooked: number;
  distinctRecipesCooked: number;
  recent: Array<{
    id: string;
    completedAt: string | null;
  }>;
};

const previewSessionEnvironment = {
  DATABASE_URL: requiredEnv("DATABASE_URL"),
  BETTER_AUTH_URL: requiredEnv("BETTER_AUTH_URL"),
  BETTER_AUTH_SECRET: requiredEnv("BETTER_AUTH_SECRET"),
  PREVIEW_AUTH_PASSWORD: requiredEnv("PREVIEW_AUTH_PASSWORD"),
};
const siteURL = previewSessionEnvironment.BETTER_AUTH_URL;
const apiURL = requiredEnv("PREVIEW_API_URL").replace(/\/$/, "");
const READY_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2_000;

async function fetchPreview(
  path: string,
  init: RequestInit | undefined,
  deadline: number,
): Promise<Response | null> {
  try {
    return await fetch(`${apiURL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(
        Math.min(REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
      ),
    });
  } catch (error) {
    // A fresh Worker can briefly reject connections while its route
    // converges. Readiness probes are safe to replay; mutations are not.
    if (init?.method) throw error;
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(RETRY_DELAY_MS, remaining)),
      );
    }
    return null;
  }
}

async function expectJson<T>(
  path: string,
  init?: RequestInit,
  expectedStatus = 200,
): Promise<T> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetchPreview(path, init, deadline);
    if (!response) continue;
    if (response.status === expectedStatus) {
      return response.json() as Promise<T>;
    }
    // Wrangler can report success before every request reaches the new Worker
    // version. Retry read-only readiness probes, but never replay mutations.
    if (
      !init?.method &&
      (response.status === 404 || response.status >= 500)
    ) {
      await response.body?.cancel();
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(RETRY_DELAY_MS, remaining)),
      );
      continue;
    }
    throw new Error(
      `${init?.method ?? "GET"} ${path} returned ${response.status}: ${await response.text()}`,
    );
  }
  throw new Error(`GET ${path} did not become ready within 120 seconds`);
}

const cookie = await createPreviewSessionCookie(
  previewSessionEnvironment,
  previewScenarios[0].email,
);
const headers = {
  cookie,
  origin: siteURL,
  "content-type": "application/json",
};

const before = await expectJson<CookingInsights>(
  "/api/profile/cooking-insights",
  { headers: { cookie } },
);
const sessionId = crypto.randomUUID();
const event = {
  sessionId,
  recipeSlug: "weeknight-pasta",
  recipeTitle: "Weeknight pasta",
  recipeVersion: "preview-v1",
  servings: 2,
};

await expectJson(
  "/api/profile/cooking-sessions",
  {
    method: "POST",
    headers,
    body: JSON.stringify({ ...event, event: "started" }),
  },
  201,
);
const afterStart = await expectJson<CookingInsights>(
  "/api/profile/cooking-insights",
  { headers: { cookie } },
);
if (
  afterStart.cookModeStarts !== before.cookModeStarts + 1 ||
  afterStart.mealsCooked !== before.mealsCooked
) {
  throw new Error("Cook-mode start did not update preview insights correctly");
}

await expectJson(
  "/api/profile/cooking-sessions",
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      sessionId: event.sessionId,
      recipeSlug: event.recipeSlug,
      recipeTitle: event.recipeTitle,
      recipeVersion: event.recipeVersion,
      servings: event.servings,
      event: "completed",
      outcome: {
        leftoverPortions: 1,
        leftoverStorage: "fridge",
        leftoverUseBy: null,
        audience: "personal",
      },
    }),
  },
  200,
);
const afterFinish = await expectJson<CookingInsights>(
  "/api/profile/cooking-insights",
  { headers: { cookie } },
);
if (
  afterFinish.cookModeStarts !== before.cookModeStarts + 1 ||
  afterFinish.mealsCooked !== before.mealsCooked + 1 ||
  !afterFinish.recent.some(
    (session) => session.id === sessionId && session.completedAt,
  )
) {
  throw new Error("Cook-mode finish did not update preview insights correctly");
}

console.log("Preview cooking-insights smoke test passed.");
