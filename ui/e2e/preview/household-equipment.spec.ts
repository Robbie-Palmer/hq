import { expect, test } from "@playwright/test";
import {
  createPreviewContext,
  previewSiteURL,
  signInPreviewScenario,
} from "./preview-test-helpers";

test("household members can manage shared kitchen equipment", async ({
  browser,
}) => {
  const context = await createPreviewContext(browser);

  try {
    const page = await context.newPage();
    await signInPreviewScenario(page, "Household owner");
    await page.goto("/recipes/settings");
    await expect(page).toHaveURL(`${previewSiteURL.origin}/recipes/settings`);

    await page.getByRole("button", { name: "Household", exact: true }).click();
    const showWarning = page.getByRole("button", { name: "Show warning" });
    await showWarning.click();
    await expect(showWarning).toHaveAttribute("aria-pressed", "true");
    await expect(showWarning).toBeEnabled();
    const equipmentSelect = page.getByLabel("Equipment to add");
    await expect(equipmentSelect).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove frying pan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove saucepan" }),
    ).toBeVisible();
    const removeBlender = page.getByRole("button", {
      name: "Remove blender",
    });
    const removeGrill = page.getByRole("button", { name: "Remove grill" });

    if (await removeGrill.isVisible()) {
      await removeGrill.click();
      await expect(removeGrill).toHaveCount(0);
      await expect(
        page.getByText("grill removed from the household."),
      ).toBeVisible();
    }

    if (await removeBlender.isVisible()) {
      await removeBlender.click();
      await expect(removeBlender).toHaveCount(0);
    }

    await equipmentSelect.selectOption("blender");
    await page.getByRole("button", { name: "Add equipment" }).click();

    await expect(removeBlender).toBeVisible();
    await expect(
      page.getByText("blender added to the household."),
    ).toBeVisible();

    await removeBlender.click();
    await expect(removeBlender).toHaveCount(0);
    await expect(
      page.getByText("blender removed from the household."),
    ).toBeVisible();

    await page.goto("/recipes");
    const curryCard = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("link", {
        name: "Preview Household Veggie Curry",
        exact: true,
      }),
    });
    const flatbreadCard = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("link", {
        name: "Preview Household Flatbread",
        exact: true,
      }),
    });
    await expect(curryCard.getByText(/Missing equipment:/)).toHaveCount(0);
    await expect(
      flatbreadCard.getByText("Missing equipment: grill.", { exact: true }),
    ).toBeVisible();

    await page.goto("/recipes/settings");
    await page.getByRole("button", { name: "Household", exact: true }).click();
    await page.getByRole("button", { name: "Disable it" }).click();
    await expect(page.getByText(/Equipment checks are off/)).toBeVisible();
    await expect(page.getByLabel("Equipment to add")).toHaveCount(0);

    await page.goto("/recipes");
    const disabledFlatbreadCard = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("link", {
        name: "Preview Household Flatbread",
        exact: true,
      }),
    });
    await expect(
      disabledFlatbreadCard.getByText(/Missing equipment:/),
    ).toHaveCount(0);

    await page.goto("/recipes/settings");
    await page.getByRole("button", { name: "Household", exact: true }).click();
    await showWarning.click();
    await expect(page.getByLabel("Equipment to add")).toBeVisible();
  } finally {
    await context.close();
  }
});
