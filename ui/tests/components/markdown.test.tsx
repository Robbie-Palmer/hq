import { type EvaluateOptions, evaluate } from "next-mdx-remote-client/rsc";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { remarkRestrictMdxExpressions } from "@/lib/markdown/restrict-expressions";

const secureOptions: EvaluateOptions = {
  disableExports: true,
  disableImports: true,
  parseFrontmatter: true,
  mdxOptions: {
    remarkPlugins: [remarkRestrictMdxExpressions],
  },
};

describe("Markdown RSC compilation", () => {
  it("preserves frontmatter, custom components, and static literal props", async () => {
    const { content, error, frontmatter } = await evaluate({
      source: `---
title: Static MDX
---

# Heading

<Callout config={{tone: "info", count: 2, values: [1, null, -2]}}>{\`Safe content\`}</Callout>`,
      components: {
        Callout: ({
          children,
          config,
        }: {
          children?: React.ReactNode;
          config?: {
            tone: string;
            count: number;
            values: Array<number | null>;
          };
        }) => (
          <aside
            data-count={config?.count}
            data-tone={config?.tone}
            data-values={config?.values.join(",")}
          >
            {children}
          </aside>
        ),
      },
      options: secureOptions,
    });

    expect(error).toBeUndefined();
    expect(frontmatter).toEqual({ title: "Static MDX" });
    expect(renderToStaticMarkup(content)).toContain(
      '<aside data-count="2" data-tone="info" data-values="1,,-2">Safe content</aside>',
    );
  });

  it.each([
    ["function calls", "{globalThis.__mdx_attack__ = true}"],
    ["property access", "{process.env}"],
    ["interpolated templates", "{`value ${" + "globalThis}` }"],
    ["spread attributes", "<span {...globalThis} />"],
    ["regular expressions", "{/attack/}"],
    ["computed object properties", '<span data={{["key"]: 1}} />'],
    ["object spreads", "<span data={{...globalThis}} />"],
    ["object shorthand", "<span data={{globalThis}} />"],
    ["object methods", "<span data={{method() { return 1 }}} />"],
    ["non-numeric unary expressions", '{-"unsafe"}'],
    ["other unary expressions", "{!true}"],
  ])("rejects %s before evaluating MDX", async (_name, source) => {
    const marker = "__mdx_attack__";
    Reflect.deleteProperty(globalThis, marker);

    const { error } = await evaluate({ source, options: secureOptions });

    expect(error?.message).toContain(
      "MDX JavaScript expressions must contain only static literal values",
    );
    expect(Reflect.has(globalThis, marker)).toBe(false);
  });

  it.each([
    ["active elements", '<script src="https://example.com/attack.js" />'],
    [
      "HTML injection",
      '<div dangerouslySetInnerHTML={{__html: "<img src=x onerror=alert(1)>"}} />',
    ],
    ["event handlers", '<img src="safe.png" onerror="alert(1)" />'],
    ["executable URLs", '<a href="javascript:alert(1)">click</a>'],
  ])("rejects %s", async (_name, source) => {
    const { error } = await evaluate({ source, options: secureOptions });

    expect(error?.message).toContain("is not allowed");
  });

  it("disables imports and exports while keeping document content", async () => {
    const { content, error, mod } = await evaluate({
      source: `import fs from "node:fs"

export const secret = fs.readFileSync("/etc/passwd", "utf8")

Safe body`,
      options: secureOptions,
    });

    expect(error).toBeUndefined();
    expect(mod).not.toHaveProperty("secret");
    expect(renderToStaticMarkup(content)).toContain("Safe body");
  });
});
