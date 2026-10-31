import { expect, test } from "@playwright/test";

test("renders a one-page A4 résumé with professional and independent work", async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/resume");
  await expect(
    page.getByRole("heading", { name: "Robbie Palmer", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("resume-sheet")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Print / save PDF" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to experience" }),
  ).toHaveAttribute("href", "/experience");

  const text = await page.getByLabel("Robbie Palmer résumé").innerText();
  expect(text.length).toBeGreaterThan(3_000);
  expect(text).toContain("Terminal Industries");
  expect(text).toContain("Real-Time Multi-Camera Video Analytics");
  expect(text).toContain("Multi-Modal Product Search");
  expect(text).toContain("Automated PII Detection");
  expect(text).toContain("Genomic Prediction from Histology");
  expect(text).toContain("MSI/MSS");
  expect(text).toContain("Microsoft");
  expect(text).toContain("CAREER PROJECTS");
  expect(text).toContain("INDEPENDENT BUILDS");

  const links = await page
    .getByLabel("Robbie Palmer résumé")
    .locator("a")
    .evaluateAll((anchors) =>
      anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
    );
  expect(new Set(links).size).toBeGreaterThan(12);
  expect(links).toContain("https://robbiepalmer.me/");
  expect(links).toContain("https://terminal-industries.com/");
  expect(links).toContain("https://confluent.io/");
  expect(links.map((link) => new URL(link).pathname)).toEqual(
    expect.arrayContaining([
      "/projects/real-time-multi-camera-video-analytics",
      "/projects/multi-modal-product-search",
      "/projects/pii-detection",
      "/projects/genomic-prediction",
    ]),
  );
  expect(links.every((link) => URL.canParse(link))).toBe(true);

  await page.screenshot({
    path: testInfo.outputPath("resume-screen.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("resume-sheet").first()).toBeVisible();
  const { mobileOverflow, overflowElements } = await page.evaluate(() => ({
    mobileOverflow: Math.max(
      0,
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    overflowElements: [...document.querySelectorAll("body *")]
      .map((element) => ({
        element: element.tagName.toLowerCase(),
        className:
          element instanceof HTMLElement ? String(element.className) : "",
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .filter(({ right }) => right > document.documentElement.clientWidth),
  }));
  expect(mobileOverflow, JSON.stringify(overflowElements, null, 2)).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("resume-mobile.png"),
    fullPage: true,
  });

  await page.emulateMedia({ media: "print" });
  const overflow = await page
    .getByTestId("resume-sheet")
    .evaluateAll((sheets) =>
      sheets.map((sheet) => ({
        horizontal: sheet.scrollWidth - sheet.clientWidth,
        vertical: sheet.scrollHeight - sheet.clientHeight,
      })),
    );
  expect(overflow).toEqual([{ horizontal: 0, vertical: 0 }]);

  const pdf = await page.pdf({
    format: "A4",
    preferCSSPageSize: true,
    printBackground: true,
  });
  const pdfSource = Buffer.from(pdf).toString("latin1");
  const pageCount = pdfSource.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  expect(pageCount).toBe(1);
  expect(pdf.byteLength).toBeGreaterThan(20_000);
  expect(pageErrors).toEqual([]);
});
