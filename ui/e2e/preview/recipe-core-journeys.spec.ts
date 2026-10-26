import { expect, previewSiteURL, test } from "./preview-test-helpers";

test("imports a URL recipe into the accessible editor", async ({
  createPreviewSession,
}) => {
  const { page } = await createPreviewSession("empty-user");
  await page.route("**/api/recipe-drafts/url", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        title: "Preview imported pasta",
        description: "A browser-test import.",
        cuisine: "Italian",
        servings: 2,
        prepTime: 5,
        cookTime: 20,
        source: "Cook the @pasta{200%g}.",
        url: "https://example.test/imported-pasta",
      },
    });
  });

  await page.goto("/recipes/add");
  await page.getByRole("button", { name: "Import URL" }).click();
  await page
    .getByLabel("Recipe webpage URL")
    .fill("https://example.test/imported-pasta");
  await page.getByRole("button", { name: "Import recipe" }).click();

  await expect(page.getByLabel("Recipe name")).toHaveValue(
    "Preview imported pasta",
  );
  await expect(page.getByLabel("Short description")).toHaveValue(
    "A browser-test import.",
  );
  await expect(page.getByText(/Imported successfully/)).toBeVisible();
});

test("keeps keyboard focus inside cook mode and restores the recipe", async ({
  createPreviewSession,
}) => {
  const { page } = await createPreviewSession("user-with-recipes");
  await page.goto("/recipes/preview-private-weeknight-pasta");
  await page.getByRole("button", { name: "Start cooking" }).click();

  const dialog = page.getByRole("dialog", {
    name: "Cook mode: Preview Weeknight Pasta",
  });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\?cook=1&step=1$/);

  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(
    `${previewSiteURL.origin}/recipes/preview-private-weeknight-pasta`,
  );
});
