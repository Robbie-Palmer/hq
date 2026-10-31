import { expect, previewSiteURL, test } from "./preview-test-helpers";

test("keeps wedding workflows addressable through refresh and history", async ({
  createPreviewSession,
}) => {
  const { page } = await createPreviewSession();
  await page.goto("/wedding-planner");
  await expect(page).toHaveURL(
    `${previewSiteURL.origin}/wedding-planner/readiness`,
  );
  await page.getByRole("button", { name: "Use sample plan" }).click();
  await expect(page.getByRole("heading", { name: "Readiness" })).toBeVisible();

  await page.getByRole("link", { name: "Guests", exact: true }).first().click();
  await expect(page).toHaveURL(
    `${previewSiteURL.origin}/wedding-planner/guests`,
  );
  await expect(page.getByRole("heading", { name: "Guests" })).toBeVisible();

  await page.getByRole("button", { name: /Casey Brooks.*Staying/ }).click();
  await expect(page).toHaveURL(
    `${previewSiteURL.origin}/wedding-planner/guests?guest=casey`,
  );
  await page.reload();
  await expect(
    page.locator(".guest-detail").getByText("Casey Brooks", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("link", { name: "Accommodation", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(
    `${previewSiteURL.origin}/wedding-planner/accommodation`,
  );
  await page.goBack();
  await expect(page).toHaveURL(
    `${previewSiteURL.origin}/wedding-planner/guests?guest=casey`,
  );
  await expect(
    page.locator(".guest-detail").getByText("Casey Brooks", { exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Who shares a bed?" }),
  ).toBeVisible();
});

test("keeps primary navigation keyboard-usable on a narrow screen", async ({
  createPreviewSession,
}) => {
  const { page } = await createPreviewSession();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/wedding-planner/readiness?demo=1");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

  await page.getByText("Sections", { exact: true }).click();
  const music = page.getByRole("link", { name: "Music", exact: true }).first();
  await music.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    `${previewSiteURL.origin}/wedding-planner/music`,
  );
  await expect(page.getByRole("heading", { name: "Music" })).toBeVisible();
});
