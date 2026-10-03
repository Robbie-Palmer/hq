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
    const equipmentSelect = page.getByLabel("Equipment to add");
    await expect(equipmentSelect).toBeVisible();
    const removeBlender = page.getByRole("button", {
      name: "Remove blender",
    });

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
  } finally {
    await context.close();
  }
});
