import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`keeps the Agent Coordinator context diagram readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.goto("/projects/agent-coordinator");

    const diagram = page.locator(".mermaid-diagram");
    const svg = diagram.locator("svg");
    await expect(svg).toBeVisible();
    await expect(svg).toContainText("Agent Coordinator");
    await expect(svg).toContainText("Work Graph");
    await expect(svg).toContainText("Candidate actors");
    await expect(svg).toContainText("Model providers");

    const layout = await diagram.evaluate((container) => {
      const labels = Array.from(
        container.querySelectorAll<HTMLElement>(".nodeLabel"),
      );
      const overflowingLabels = labels.filter((label) => {
        const node = label.closest<SVGGElement>(".node");
        if (node === null) return true;
        const labelBounds = label.getBoundingClientRect();
        const nodeBounds = node.getBoundingClientRect();
        return (
          labelBounds.left < nodeBounds.left - 1 ||
          labelBounds.right > nodeBounds.right + 1 ||
          labelBounds.top < nodeBounds.top - 1 ||
          labelBounds.bottom > nodeBounds.bottom + 1
        );
      });

      return {
        renderedFontSizes: labels.map((label) => {
          const cssFontSize = Number.parseFloat(
            getComputedStyle(label).fontSize,
          );
          const renderedHeight = label.getBoundingClientRect().height;
          const scale = renderedHeight / label.offsetHeight;
          return cssFontSize * scale;
        }),
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
    expect(layout.renderedFontSizes).toHaveLength(5);
    expect(Math.min(...layout.renderedFontSizes)).toBeGreaterThanOrEqual(14);
  });
}
