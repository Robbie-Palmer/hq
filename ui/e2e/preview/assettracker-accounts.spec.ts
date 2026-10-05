import { expect, previewSiteURL, test } from "./preview-test-helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("selects an account by URL and records a balance on mobile", async ({
  createPreviewSession,
}) => {
  const { page } = await createPreviewSession();
  await page.goto("/assettracker/accounts");
  await page.getByRole("link", { name: "Marcus Savings", exact: true }).click();

  await expect(page).toHaveURL(
    `${previewSiteURL.origin}/assettracker/accounts?account=marcus-savings`,
  );
  const accountDetail = page.getByRole("dialog", {
    name: "Marcus Savings",
  });
  await expect(accountDetail).toBeVisible();

  await page.reload();
  await expect(accountDetail).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(
    `${previewSiteURL.origin}/assettracker/accounts`,
  );
  await expect(accountDetail).toHaveCount(0);
  await page.goForward();
  await expect(accountDetail).toBeVisible();

  await accountDetail.getByRole("button", { name: "Log balance" }).click();
  const balanceForm = page.getByRole("dialog", { name: "Log a balance" });
  await balanceForm.getByLabel("Balance (GBP)").fill("1234.56");
  await balanceForm.getByLabel("Date").fill("2026-09-27");
  await balanceForm.getByRole("button", { name: "Save balance" }).click();

  await expect(balanceForm).toHaveCount(0);
  await expect(accountDetail.getByText("£1,234.56").first()).toBeVisible();
});
