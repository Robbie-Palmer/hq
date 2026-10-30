import { markdownCodeHighlighting } from "mdx-rendering";
import { evaluate } from "next-mdx-remote-client/rsc";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function renderCooklang(source: string) {
  const { content, error } = await evaluate({
    source,
    options: {
      mdxOptions: {
        rehypePlugins: [markdownCodeHighlighting],
      },
    },
  });
  if (error) throw error;

  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(content);
  return container;
}

function tokenFor(container: HTMLElement, value: string) {
  return [...container.querySelectorAll("code span span")].find(
    (span) => span.textContent === value,
  );
}

describe("Cooklang Markdown code fences", () => {
  it("renders Cooklang entities and instruction text as distinct tokens", async () => {
    const container = await renderCooklang(`\`\`\`cooklang
Mix @bread flour{500%g} in #mixing bowl{} and wait ~rest{10%minutes}.
Season with @salt in #pan, then hold ~{5%minutes}.
\`\`\``);

    const code = container.querySelector("code[data-language='cooklang']");
    expect(code).toHaveTextContent(
      "Mix @bread flour{500%g} in #mixing bowl{} and wait ~rest{10%minutes}. Season with @salt in #pan, then hold ~{5%minutes}.",
    );

    const instruction = [...container.querySelectorAll("code span span")].find(
      (span) => span.textContent?.startsWith("Mix "),
    );
    const ingredient = tokenFor(container, "bread flour");
    const cookware = tokenFor(container, "mixing bowl");
    const timer = tokenFor(container, "~rest");
    const unnamedTimer = tokenFor(container, "~");
    const amount = tokenFor(container, "500");
    const unit = tokenFor(container, "g");
    const unbracedIngredient = tokenFor(container, "salt");
    const unbracedCookware = tokenFor(container, "pan");

    for (const [name, token] of Object.entries({
      instruction,
      ingredient,
      cookware,
      timer,
      amount,
      unit,
      unnamedTimer,
      unbracedIngredient,
      unbracedCookware,
    })) {
      expect(token, name).toBeDefined();
    }

    const semanticStyles = [
      instruction,
      ingredient,
      cookware,
      timer,
      amount,
    ].map((token) => token?.getAttribute("style"));
    expect(new Set(semanticStyles)).toHaveLength(5);
    expect(unit?.getAttribute("style")).toBe(amount?.getAttribute("style"));
    expect(unnamedTimer?.getAttribute("style")).toBe(
      timer?.getAttribute("style"),
    );
    expect(unbracedIngredient?.getAttribute("style")).toBe(
      ingredient?.getAttribute("style"),
    );
    expect(unbracedCookware?.getAttribute("style")).toBe(
      cookware?.getAttribute("style"),
    );
  });

  it("keeps unknown and malformed syntax intact", async () => {
    const container = await renderCooklang(`\`\`\`cooklang
Stir @broken{2%cup and ?unknown, then add @salt{1%tsp}.
\`\`\``);

    expect(container.querySelector("code")).toHaveTextContent(
      "Stir @broken{2%cup and ?unknown, then add @salt{1%tsp}.",
    );
    expect(tokenFor(container, "salt")).toBeDefined();
  });

  it("emits light and dark Shiki colors for Cooklang tokens", async () => {
    const container = await renderCooklang(`\`\`\`cooklang
Add @salt{1%tsp}.
\`\`\``);

    const code = container.querySelector("code[data-language='cooklang']");
    expect(code).toHaveAttribute("data-theme", "github-dark github-light");

    for (const token of container.querySelectorAll("code span span")) {
      expect(token.getAttribute("style")).toMatch(/--shiki-dark:#[\dA-F]{6}/i);
      expect(token.getAttribute("style")).toMatch(/--shiki-light:#[\dA-F]{6}/i);
    }
  });
});
