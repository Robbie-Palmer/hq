import type { BrowserContext, Page } from "@playwright/test";
import {
  expect,
  expectPreviewJSON,
  previewSiteURL,
  test,
} from "./preview-test-helpers";

type StoredList = {
  id: string;
  revision: string;
  snapshot: {
    recipes: Array<{ slug: string; servings?: number }>;
    checked: string[];
    extras: Array<{ id: string; text: string; checked: boolean }>;
    plan: unknown[];
  };
};

async function currentList(context: BrowserContext): Promise<StoredList> {
  return expectPreviewJSON(context, "/api/shopping-lists/current");
}

async function restoreList(
  context: BrowserContext,
  snapshot: StoredList["snapshot"],
): Promise<void> {
  const current = await currentList(context);
  await expectPreviewJSON(context, "/api/shopping-lists/current", {
    method: "PUT",
    data: { listId: current.id, revision: current.revision, snapshot },
  });
}

function waitForListSave(page: Page) {
  return page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "PUT" &&
      new URL(response.url()).pathname === "/api/shopping-lists/current"
    );
  });
}

test("keeps planning and shopping as independent durable destinations", async ({
  createPreviewSession,
}) => {
  const first = await createPreviewSession("user-with-recipes");
  const original = (await currentList(first.context)).snapshot;

  try {
    await first.page.goto("/recipes/shopping");
    await expect(first.page).toHaveURL(
      `${previewSiteURL.origin}/recipes/shopping`,
    );
    await expect(
      first.page.getByRole("heading", { name: "Shopping list." }),
    ).toBeVisible();
    await expect(
      first.page.getByRole("button", { name: "Plan one meal" }),
    ).toHaveCount(0);

    await first.page.goto("/recipes/planning");
    await expect(
      first.page.getByRole("heading", { name: "Meal plan." }),
    ).toBeVisible();
    await first.page.getByRole("button", { name: "Plan one meal" }).click();
    const recipe = first.page.getByLabel("Recipe");
    await recipe.selectOption({ index: 1 });
    const recipeTitle = await recipe.locator("option:checked").textContent();
    const saved = waitForListSave(first.page);
    await first.page.getByRole("button", { name: "Save meal" }).click();
    expect((await saved).ok()).toBeTruthy();

    await first.page.reload();
    await expect(first.page.getByText(recipeTitle ?? "")).toBeVisible();
    await first.page.getByRole("link", { name: "Shop" }).click();
    await first.page.goBack();
    await expect(first.page).toHaveURL(
      `${previewSiteURL.origin}/recipes/planning`,
    );

    const second = await createPreviewSession("user-with-recipes");
    await second.page.goto("/recipes/planning");
    await expect(second.page.getByText(recipeTitle ?? "")).toBeVisible();
  } finally {
    await restoreList(first.context, original);
  }
});
