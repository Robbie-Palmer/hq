import { afterAll, describe, expect, it } from "vitest";
import { markdownCodeHighlighting } from "../src/index";

const [, options] = markdownCodeHighlighting;
const highlighterPromise = options.getHighlighter?.({
  langs: [],
  themes: ["github-dark", "github-light"],
});

afterAll(async () => {
  (await highlighterPromise)?.dispose();
});

describe("markdownCodeHighlighting", () => {
  it("registers Cooklang and emits both theme colors", async () => {
    expect(options).toMatchObject({
      keepBackground: false,
      theme: { dark: "github-dark", light: "github-light" },
    });
    const highlighter = await highlighterPromise;
    expect(highlighter).toBeDefined();
    const html = highlighter?.codeToHtml(
      "Mix @bread flour{500%g} in #mixing bowl{} and wait ~rest{10%minutes}.",
      {
        lang: "cooklang",
        themes: { dark: "github-dark", light: "github-light" },
      },
    );
    expect(html).toContain("bread flour");
    expect(html).toContain("mixing bowl");
    expect(html).toContain("~rest");
    expect(html).toMatch(/style="color:#[\dA-F]{6}/i);
    expect(html).toMatch(/--shiki-dark:#[\dA-F]{6}/i);
  });

  it("keeps malformed Cooklang source intact", async () => {
    const highlighter = await highlighterPromise;
    const source = "Stir @broken{2%cup and ?unknown, then add @salt{1%tsp}.";
    const tokens = highlighter?.codeToTokensBase(source, {
      lang: "cooklang",
      theme: "github-dark",
    });
    expect(tokens?.flatMap((line) => line.map((token) => token.content)).join(""))
      .toBe(source);
    expect(tokens?.flat().some((token) => token.content === "salt")).toBe(true);
  });
});
