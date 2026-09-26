import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  createPreviewContext,
  previewReadinessTimeoutMs,
  previewSiteURL,
  signInPreviewScenario,
} from "./preview-test-helpers";

type PreviewSession = {
  context: BrowserContext;
  page: Page;
};

async function openOwnerRecipeSession(
  browser: Browser,
): Promise<PreviewSession> {
  const context = await createPreviewContext(browser);

  try {
    const page = await context.newPage();
    await signInPreviewScenario(page, "Household owner");
    await expect(
      page.getByText("Your recipe box", { exact: true }),
    ).toBeVisible();

    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function waitForOfflineRecipeData(page: Page): Promise<void> {
  await page.evaluate(async (readinessTimeoutMs) => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () =>
          reject(new Error("The recipe service worker did not take control")),
        readinessTimeoutMs,
      );
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });
  }, previewReadinessTimeoutMs);

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const sessionCache = await caches.open("recipe-session-v1");
          const session = await sessionCache.match(
            new Request(`${window.location.origin}/recipes/__offline-session`),
          );
          if (!session) return false;

          const databases = await indexedDB.databases();
          if (!databases.some(({ name }) => name === "robbies-recipes")) {
            return false;
          }

          return new Promise<boolean>((resolve) => {
            const request = indexedDB.open("robbies-recipes");
            request.onerror = () => resolve(false);
            request.onsuccess = () => {
              const database = request.result;
              if (!database.objectStoreNames.contains("recipe-snapshots")) {
                database.close();
                resolve(false);
                return;
              }
              const count = database
                .transaction("recipe-snapshots")
                .objectStore("recipe-snapshots")
                .count();
              count.onerror = () => {
                database.close();
                resolve(false);
              };
              count.onsuccess = () => {
                database.close();
                resolve(count.result > 0);
              };
            };
          });
        }),
      { timeout: previewReadinessTimeoutMs },
    )
    .toBe(true);
}

async function clearOfflineRecipeSnapshots(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("robbies-recipes");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            "recipe-snapshots",
            "readwrite",
          );
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.objectStore("recipe-snapshots").clear();
        };
      }),
  );
}

test.describe.configure({ mode: "serial", timeout: 90_000 });

test.describe("deployed recipe PWA offline navigation", () => {
  test("routes unavailable app navigation through the offline page", async ({
    browser,
  }) => {
    const { context, page } = await openOwnerRecipeSession(browser);
    try {
      await waitForOfflineRecipeData(page);
      await context.setOffline(true);

      const destinations = [
        { name: "Discover", path: "/recipes/discover" },
        { name: "Kitchen", path: "/recipes/kitchen" },
        { name: "Log", path: "/recipes/log" },
        { name: "Shopping", path: "/recipes/shopping" },
      ];

      const expectOfflineDestination = async (path: string) => {
        await expect(page).toHaveURL(`${previewSiteURL.origin}${path}`);
        await expect(
          page.getByRole("heading", { name: "You're offline" }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Recipe not found" }),
        ).toHaveCount(0);

        await page.getByRole("link", { name: "Back to recipes" }).click();
        await expect(page).toHaveURL(`${previewSiteURL.origin}/recipes`);
        await expect(
          page.getByText("Your recipe box", { exact: true }),
        ).toBeVisible();
      };

      for (const destination of destinations) {
        await page
          .getByRole("link", { name: destination.name, exact: true })
          .click();
        await expectOfflineDestination(destination.path);
      }

      await page.getByRole("link", { name: /^Notifications/ }).click();
      await expectOfflineDestination("/recipes/notifications");

      await page
        .getByRole("button", { name: "Account for Household owner" })
        .click();
      await page.getByRole("link", { name: "Profile", exact: true }).click();
      await expectOfflineDestination("/recipes/profile");

      await page
        .getByRole("button", { name: "Account for Household owner" })
        .click();
      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await expectOfflineDestination("/recipes/settings");
    } finally {
      await context.close();
    }
  });

  test("opens the offline explanation from an unavailable diet notice", async ({
    browser,
  }) => {
    const { context, page } = await openOwnerRecipeSession(browser);
    try {
      await waitForOfflineRecipeData(page);
      await context.setOffline(true);
      await clearOfflineRecipeSnapshots(page);
      await page.reload();

      await expect(
        page.getByRole("alert").filter({
          hasText: "Diet preferences are unavailable.",
        }),
      ).toBeVisible();
      await page.getByRole("link", { name: "diet settings" }).click();

      await expect(page).toHaveURL(
        `${previewSiteURL.origin}/recipes/settings?section=diet`,
      );
      await expect(
        page.getByRole("heading", { name: "You're offline" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Recipe not found" }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
