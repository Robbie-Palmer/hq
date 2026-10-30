import { describe, expect, it } from "vitest";
import {
  createAgentMarkdownPages,
  mdxToAgentMarkdown,
} from "../src/index";

describe("mdxToAgentMarkdown", () => {
  it("passes plain Markdown through, including GFM tables", () => {
    const mdx = [
      "# Heading",
      "",
      "Some **bold** prose with a [link](https://example.com).",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
    ].join("\n");
    const result = mdxToAgentMarkdown(mdx);
    expect(result).toContain("# Heading");
    expect(result).toContain("**bold**");
    expect(result).toContain("| 1 | 2 |");
  });

  it("removes ESM imports and expressions", () => {
    const mdx =
      'import { Mermaid } from "./mermaid";\n\nHello {globalThis.secret}.';
    const result = mdxToAgentMarkdown(mdx);
    expect(result).not.toContain("import");
    expect(result).not.toContain("globalThis");
    expect(result).toContain("Hello .");
  });

  it("converts Mermaid components to code blocks", () => {
    const result = mdxToAgentMarkdown(
      "<Mermaid chart={`graph TD\n  A --> B`} />",
    );
    expect(result).toContain("```mermaid");
    expect(result).toContain("A --> B");
  });

  it("replaces childless components with a placeholder", () => {
    const result = mdxToAgentMarkdown("Before\n\n<MermaidDemo />\n\nAfter");
    expect(result).toContain(
      "(Interactive MermaidDemo component — view it on the HTML page)",
    );
    expect(result).not.toContain("<MermaidDemo");
  });

  it("unwraps wrapper components and keeps their children", () => {
    const result = mdxToAgentMarkdown(
      "<MyParagraph>\n  Inner *content* stays\n</MyParagraph>",
    );
    expect(result).toContain("Inner *content* stays");
    expect(result).not.toContain("MyParagraph");
  });

  it("resolves local image sources and preserves absolute sources", () => {
    const local = mdxToAgentMarkdown(
      '<img src="blog/image" alt="An image" />',
      { resolveImageUrl: (src) => `https://images.example.com/${src}` },
    );
    const absolute = mdxToAgentMarkdown(
      '<Image src="https://cdn.example.com/image.png" alt="Remote" />',
      { resolveImageUrl: () => null },
    );
    expect(local).toContain(
      "![An image](https://images.example.com/blog/image)",
    );
    expect(absolute).toContain(
      "![Remote](https://cdn.example.com/image.png)",
    );
  });

  it("drops unresolved and malformed images", () => {
    const result = mdxToAgentMarkdown(
      'Before\n\n<img src="blog/image" />\n\n<img alt="missing" />\n\nAfter',
      { resolveImageUrl: () => null },
    );
    expect(result).not.toContain("img");
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });

  it("leaves fenced code containing JSX-like generics untouched", () => {
    const result = mdxToAgentMarkdown(
      "```ts\ntechnologies: Map<TechnologySlug, Technology>;\n```",
    );
    expect(result).toContain("Map<TechnologySlug, Technology>");
  });
});

describe("createAgentMarkdownPages", () => {
  const pages = createAgentMarkdownPages({
    siteUrl: "https://example.com////",
    markdownIndexPath: "/agents.txt",
  });

  it("injects the site URL into page headers and footers", () => {
    const page = pages.renderPage(
      {
        title: "Projects",
        htmlPath: "/projects",
        description: "All projects",
        facts: [["Status", "live"]],
      },
      "Body content",
    );
    expect(page).toContain("# Projects");
    expect(page).toContain("> All projects");
    expect(page).toContain("- HTML version: https://example.com/projects");
    expect(page).toContain("- Status: live");
    expect(page).toContain("Body content");
    expect(page).toContain("https://example.com/agents.txt");
  });

  it("maps the home page and nested pages to Markdown twins", () => {
    expect(pages.markdownUrl("/")).toBe("https://example.com/index.md");
    expect(pages.markdownUrl("/projects/example")).toBe(
      "https://example.com/projects/example.md",
    );
    expect(pages.renderPageHeader({ title: "Home", htmlPath: "/" })).toContain(
      "- HTML version: https://example.com",
    );
    expect(pages.renderPageFooter()).toContain(
      "https://example.com/agents.txt",
    );
  });

  it("uses llms.txt as the default Markdown index", () => {
    const defaultPages = createAgentMarkdownPages({
      siteUrl: "https://example.com",
    });
    expect(defaultPages.renderPageFooter()).toContain(
      "https://example.com/llms.txt",
    );
  });
});
