import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test.describe(`${width}px viewport`, () => {
    test.use({ viewport: { height: 900, width } });

    test(`keeps the automated macrodissection data flow readable at ${width}px`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));

      await page.goto("/projects/automated-macrodissection");

      const diagram = page.locator(".mermaid-diagram");
      const svg = diagram.locator("svg");
      await expect(svg).toBeVisible();
      await expect(svg).toContainText("Tissue models and artifact handling");
      await expect(svg).toContainText("Region optimisation");
      await expect(svg).toContainText("Proposed cutting coordinates");
      await expect(svg).toContainText("Dissection hardware");

      const layout = await diagram.evaluate((container) => {
        const labels = Array.from(
          container.querySelectorAll<HTMLElement>(".node .nodeLabel"),
        );
        const overflowingLabels = labels.filter((label) => {
          const node = label.closest<SVGGElement>(".node");
          if (node === null) return true;
          const shape = node.querySelector<SVGGraphicsElement>(
            ":scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path",
          );
          if (shape === null) return true;
          const labelBounds = label.getBoundingClientRect();
          const nodeBounds = shape.getBoundingClientRect();
          return (
            labelBounds.left < nodeBounds.left - 1 ||
            labelBounds.right > nodeBounds.right + 1 ||
            labelBounds.top < nodeBounds.top - 1 ||
            labelBounds.bottom > nodeBounds.bottom + 1
          );
        });

        return {
          overflowingLabels: overflowingLabels.map(
            (label) => label.textContent?.trim() ?? "",
          ),
          pageOverflows:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth + 1,
        };
      });

      expect(pageErrors).toEqual([]);
      expect(layout.pageOverflows).toBe(false);
      expect(layout.overflowingLabels).toEqual([]);
    });
  });
}
