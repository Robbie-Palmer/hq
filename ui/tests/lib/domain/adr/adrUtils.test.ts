import { describe, expect, it } from "vitest";
import {
  formatADRIndex,
  formatADRSlugIndex,
  normalizeADRTitle,
  parseADRRef,
} from "@/lib/domain/adr/adr";
import { summarizeMarkdown } from "@/lib/domain/adr/adrQueries";

describe("ADR utilities", () => {
  it("formats ADR indexes as zero-padded 3-digit values", () => {
    expect(formatADRIndex(0)).toBe("000");
    expect(formatADRIndex(9)).toBe("009");
    expect(formatADRIndex(123)).toBe("123");
  });

  it("formats the stable numeric prefix from an ADR slug", () => {
    expect(formatADRSlugIndex("067-versioned-density-catalog")).toBe("067");
    expect(formatADRSlugIndex("7-short-slug")).toBe("007");
    expect(formatADRSlugIndex("adr-without-number")).toBe("---");
  });

  it("normalizes ADR title by removing prefixed ADR number", () => {
    expect(normalizeADRTitle("ADR 014: SSG")).toBe("SSG");
    expect(normalizeADRTitle("ADR 025: Content Graph Indexes")).toBe(
      "Content Graph Indexes",
    );
    expect(normalizeADRTitle("Use React")).toBe("Use React");
  });

  it("parses ADRRef with a single separator", () => {
    const parsed = parseADRRef("personal-knowledge-graph:014-ssg");
    expect(parsed).toEqual({
      projectSlug: "personal-knowledge-graph",
      adrSlug: "014-ssg",
    });
  });

  it("throws for invalid ADRRef shapes", () => {
    expect(() => parseADRRef("bad:ref:shape" as never)).toThrow(
      "Invalid ADRRef format",
    );
    expect(() => parseADRRef("missing-separator" as never)).toThrow(
      "Invalid ADRRef format",
    );
  });

  it("summarizes markdown to clean plain text", () => {
    const markdown = `# Heading

**Bold** with [link](https://example.com) and \`inline code\`.

Second paragraph.`;

    expect(summarizeMarkdown(markdown)).toBe("Bold with link and inline code.");
  });

  it("summarizes a leading blockquote without quote markers", () => {
    const markdown = `# Heading

> Decision quoted from the RFC.

Details follow.`;

    expect(summarizeMarkdown(markdown)).toBe("Decision quoted from the RFC.");
  });

  it("skips code fences and MDX imports before the first paragraph", () => {
    const markdown = `import { Chart } from "@/components/chart";

\`\`\`ts
const ignored = true;
\`\`\`

The real opening paragraph.`;

    expect(summarizeMarkdown(markdown)).toBe("The real opening paragraph.");
  });

  it("flattens MDX components to their text content", () => {
    const markdown = `<Callout kind="info">Ship the smallest change.</Callout>`;

    expect(summarizeMarkdown(markdown)).toBe("Ship the smallest change.");
  });

  it("returns an empty summary when only headings exist", () => {
    expect(summarizeMarkdown("# Only a heading")).toBe("");
  });

  it("truncates summaries to 280 characters with an ellipsis", () => {
    const summary = summarizeMarkdown(`${"word ".repeat(80)}end`);

    expect(summary).toHaveLength(280);
    expect(summary.endsWith("...")).toBe(true);
  });

  it("preserves nested link labels and continues past non-link brackets", () => {
    expect(
      summarizeMarkdown(
        "[not a link] then [text [nested]](https://example.com/a_(b)).",
      ),
    ).toBe("[not a link] then text [nested].");
  });
});
