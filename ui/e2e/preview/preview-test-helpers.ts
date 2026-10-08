import {
  type APIResponse,
  type Browser,
  type BrowserContext,
  test as base,
  expect,
  type Page,
} from "@playwright/test";
import { requiredEnv } from "node-base/env";

export const previewSiteURL = new URL(requiredEnv("PREVIEW_SITE_URL"));
export const previewReadinessTimeoutMs = 30_000;
const pagesHost = requiredEnv("CLOUDFLARE_PAGES_HOST").toLowerCase();
const accessHeaders = {
  "CF-Access-Client-Id": requiredEnv("CF_ACCESS_CLIENT_ID"),
  "CF-Access-Client-Secret": requiredEnv("CF_ACCESS_CLIENT_SECRET"),
};

export type PreviewScenario =
  | "admin-user"
  | "empty-user"
  | "household-member"
  | "household-owner"
  | "user-with-recipes";

const previewScenarioNames: Record<PreviewScenario, string> = {
  "admin-user": "Administrator",
  "empty-user": "Empty account",
  "household-member": "Household member",
  "household-owner": "Household owner",
  "user-with-recipes": "User with recipes",
};

export type PreviewSession = {
  context: BrowserContext;
  page: Page;
};

type PreviewFixtures = {
  createPreviewSession: (scenario?: PreviewScenario) => Promise<PreviewSession>;
};

function assertCanonicalPreviewURL(): void {
  const previewLabel = previewSiteURL.hostname.split(".", 1)[0];
  if (
    previewSiteURL.protocol !== "https:" ||
    previewSiteURL.origin !== previewSiteURL.href.replace(/\/$/, "") ||
    !previewLabel ||
    !/^pr-[1-9]\d*$/.test(previewLabel) ||
    previewSiteURL.hostname !== `${previewLabel}.${pagesHost}`
  ) {
    throw new Error(
      "PREVIEW_SITE_URL must be the canonical HTTPS PR alias for CLOUDFLARE_PAGES_HOST",
    );
  }
}

assertCanonicalPreviewURL();

export function previewURL(input: string): string {
  const url = new URL(input, previewSiteURL.origin);
  if (url.origin !== previewSiteURL.origin) {
    throw new Error(`Preview request must stay on ${previewSiteURL.origin}`);
  }
  return url.href;
}

type PreviewRequestOptions = {
  data?: unknown;
  headers?: Record<string, string>;
  method?: string;
};

export function previewRequest(
  context: BrowserContext,
  input: string,
  options: PreviewRequestOptions = {},
): Promise<APIResponse> {
  return context.request.fetch(previewURL(input), {
    data: options.data,
    failOnStatusCode: false,
    headers: { origin: previewSiteURL.origin, ...options.headers },
    method: options.method,
  });
}

export async function expectPreviewJSON<T>(
  context: BrowserContext,
  input: string,
  options: PreviewRequestOptions = {},
  expectedStatus = 200,
): Promise<T> {
  const response = await previewRequest(context, input, options);
  try {
    if (response.status() !== expectedStatus) {
      const text = (await response.text()).slice(0, 2_000);
      throw new Error(
        `${options.method ?? "GET"} ${new URL(input, previewSiteURL).pathname} returned ${response.status()}: ${text}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    await response.dispose();
  }
}

export async function expectPreviewStatus(
  context: BrowserContext,
  input: string,
  options: PreviewRequestOptions,
  expectedStatus: number,
): Promise<void> {
  const response = await previewRequest(context, input, options);
  try {
    if (response.status() !== expectedStatus) {
      const text = (await response.text()).slice(0, 2_000);
      throw new Error(
        `${options.method ?? "GET"} ${new URL(input, previewSiteURL).pathname} returned ${response.status()}: ${text}`,
      );
    }
  } finally {
    await response.dispose();
  }
}

async function createPreviewContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: previewSiteURL.origin });

  try {
    // Send the service-token headers only to the canonical preview origin. The
    // resulting Access cookie authenticates later page, API, and WebSocket use.
    const accessResponse = await context.request.get(previewURL("/recipes"), {
      headers: accessHeaders,
      maxRedirects: 0,
    });
    const responseURL = new URL(accessResponse.url());
    if (!accessResponse.ok() || responseURL.origin !== previewSiteURL.origin) {
      throw new Error(
        `Cloudflare Access did not authorize the preview (${accessResponse.status()} ${accessResponse.url()})`,
      );
    }
    await accessResponse.dispose();
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function signInPreviewScenario(
  page: Page,
  scenario: PreviewScenario,
): Promise<void> {
  await expectPreviewStatus(
    page.context(),
    "/api/auth/preview/sign-in",
    { data: { scenario }, method: "POST" },
    200,
  );
  await page.goto("/recipes");
  await expect(page).toHaveURL(`${previewSiteURL.origin}/recipes`);
  await expect(
    page.getByRole("button", {
      name: `Account for ${previewScenarioNames[scenario]}`,
    }),
  ).toBeVisible({ timeout: previewReadinessTimeoutMs });
}

export const test = base.extend<PreviewFixtures>({
  createPreviewSession: async ({ browser }, use) => {
    const contexts = new Set<BrowserContext>();

    await use(async (scenario) => {
      const context = await createPreviewContext(browser);
      contexts.add(context);
      try {
        const page = await context.newPage();
        if (scenario) await signInPreviewScenario(page, scenario);
        return { context, page };
      } catch (error) {
        contexts.delete(context);
        await context.close();
        throw error;
      }
    });

    await Promise.allSettled(
      [...contexts].map(async (context) => {
        contexts.delete(context);
        await context.close();
      }),
    );
  },
});

export { expect };
