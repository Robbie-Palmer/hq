import { expect, test } from "@playwright/test";

const actorPalette = {
  dark: {
    fill: "rgb(30, 58, 95)",
    stroke: "rgb(96, 165, 250)",
  },
  light: {
    fill: "rgb(219, 234, 254)",
    stroke: "rgb(59, 130, 246)",
  },
} as const;

for (const colorScheme of ["light", "dark"] as const) {
  test(`renders visible SVG diagrams in the ${colorScheme} theme`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme });
    await context.addInitScript((theme) => {
      window.localStorage.setItem("theme", theme);
    }, colorScheme);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    try {
      await page.goto("/technologies/mermaid");
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`(^|\\s)${colorScheme}(\\s|$)`),
      );

      const containers = page.locator(".mermaid-diagram");
      await expect(containers).toHaveCount(3);
      await expect(containers.locator("pre")).toHaveCount(0);

      const diagrams = containers.locator("svg");
      await expect(diagrams).toHaveCount(3);
      const sequenceActor = diagrams.nth(1).locator("rect.actor").first();
      await expect(sequenceActor).toHaveCSS(
        "fill",
        actorPalette[colorScheme].fill,
      );
      await expect(sequenceActor).toHaveCSS(
        "stroke",
        actorPalette[colorScheme].stroke,
      );

      const renderedDiagrams = await diagrams.evaluateAll((elements) =>
        elements.map((svg) => {
          const bounds = svg.getBoundingClientRect();
          return {
            height: bounds.height,
            text: svg.textContent ?? "",
            viewBox: svg.getAttribute("viewBox") ?? "",
            width: bounds.width,
          };
        }),
      );

      expect(pageErrors).toEqual([]);
      for (const diagram of renderedDiagrams) {
        expect(diagram.viewBox).toMatch(
          /^\s*[-\d.]+\s+[-\d.]+\s+[\d.]+\s+[\d.]+\s*$/,
        );
        expect(diagram.width).toBeGreaterThan(100);
        expect(diagram.height).toBeGreaterThan(40);
      }

      expect(renderedDiagrams[0]?.text).toContain("Is it working?");
      expect(renderedDiagrams[0]?.text).toContain("Ship it!");
      expect(renderedDiagrams[1]?.text).toContain("POST /api/data");
      expect(renderedDiagrams[1]?.text).toContain("201 Created");
      expect(renderedDiagrams[2]?.text).toContain("Draft");
      expect(renderedDiagrams[2]?.text).toContain("Published");
    } finally {
      await context.close();
    }
  });
}
