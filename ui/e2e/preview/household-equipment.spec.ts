import type {
  BrowserContext,
  Page,
  Response as PlaywrightResponse,
} from "@playwright/test";
import {
  expect,
  expectPreviewJSON,
  expectPreviewStatus,
  previewSiteURL,
  test,
} from "./preview-test-helpers";

type Household = {
  id: string;
};

const managedEquipment = ["frying-pan", "saucepan"] as const;
const absentEquipment = ["blender", "grill"] as const;

async function setEquipmentBaseline(context: BrowserContext): Promise<void> {
  const [household] = await expectPreviewJSON<Household[]>(
    context,
    "/api/households",
  );
  if (!household) throw new Error("Household owner has no preview household");

  const results = await Promise.allSettled([
    ...managedEquipment.map((slug) =>
      expectPreviewJSON(
        context,
        `/api/households/${household.id}/equipment/${slug}`,
        { method: "PUT" },
      ),
    ),
    ...absentEquipment.map((slug) =>
      expectPreviewStatus(
        context,
        `/api/households/${household.id}/equipment/${slug}`,
        { method: "DELETE" },
        204,
      ),
    ),
    expectPreviewJSON(context, `/api/households/${household.id}/equipment`, {
      data: { recipeMatchMode: "warn" },
      method: "PATCH",
    }),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

function waitForEquipmentRequest(page: Page, method: string, slug?: string) {
  return page.waitForResponse((response) => {
    const request = response.request();
    const path = new URL(response.url()).pathname;
    return (
      request.method() === method &&
      path.startsWith("/api/households/") &&
      path.endsWith(slug ? `/equipment/${slug}` : "/equipment")
    );
  });
}

async function expectSuccessfulResponse(
  responsePromise: Promise<PlaywrightResponse>,
): Promise<void> {
  const response = await responsePromise;
  if (response.ok()) return;
  throw new Error(
    `${response.request().method()} ${new URL(response.url()).pathname} returned ${response.status()}: ${(await response.text()).slice(0, 2_000)}`,
  );
}

test("manages household equipment and applies it to recipe cards", async ({
  createPreviewSession,
}) => {
  const { context, page } = await createPreviewSession("household-owner");

  try {
    await setEquipmentBaseline(context);
    await page.goto("/recipes/settings");
    await expect(page).toHaveURL(`${previewSiteURL.origin}/recipes/settings`);
    await page.getByRole("button", { name: "Household", exact: true }).click();

    const showWarning = page.getByRole("button", { name: "Show warning" });
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

    await equipmentSelect.selectOption("blender");
    const addBlenderResponse = waitForEquipmentRequest(page, "PUT", "blender");
    await page.getByRole("button", { name: "Add equipment" }).click();
    await expectSuccessfulResponse(addBlenderResponse);

    const removeBlender = page.getByRole("button", {
      name: "Remove blender",
    });
    await expect(removeBlender).toBeVisible();
    await expect(
      page.getByText("blender added to the household."),
    ).toBeVisible();

    const removeBlenderResponse = waitForEquipmentRequest(
      page,
      "DELETE",
      "blender",
    );
    await removeBlender.click();
    await expectSuccessfulResponse(removeBlenderResponse);
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
      flatbreadCard.getByText(/^Missing equipment: grill\./),
    ).toBeVisible();

    await page.goto("/recipes/settings");
    await page.getByRole("button", { name: "Household", exact: true }).click();
    const disableResponse = waitForEquipmentRequest(page, "PATCH");
    await page.getByRole("button", { name: "Disable it" }).click();
    await expectSuccessfulResponse(disableResponse);
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
  } finally {
    await setEquipmentBaseline(context);
  }
});
