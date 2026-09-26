import type { Code, Paragraph, Root, RootContent } from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import { siteConfig } from "@/lib/config/site-config";

/**
 * Conversion of site content into plain, agent-friendly Markdown.
 *
 * Mirrors the pattern popularised by Neon's docs: every HTML page has a
 * Markdown twin at the same URL with a `.md` suffix, discoverable via
 * /llms.txt. See https://neon.com/blog/agents-grew-up-so-did-our-docs
 */

export interface MdxToMarkdownOptions {
  /**
   * Resolves image `src` values (e.g. Cloudflare Images IDs like
   * "blog/my-image-2025-12-14") to absolute URLs. Return null to drop the
   * image (e.g. when the account hash is unavailable).
   */
  resolveImageUrl?: (src: string) => string | null;
}

type MdxJsxAttribute = {
  type: string;
  name?: string;
  value?: string | { type: string; value: string } | null;
};

type MdxJsxNode = {
  type: string;
  name?: string | null;
  attributes?: MdxJsxAttribute[];
  children?: RootContent[];
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function getAttribute(node: MdxJsxNode, name: string): string | null {
  for (const attr of node.attributes ?? []) {
    if (attr.type !== "mdxJsxAttribute" || attr.name !== name) continue;
    if (typeof attr.value === "string") return attr.value;
    if (attr.value && typeof attr.value === "object") {
      // Attribute expression, e.g. chart={`graph TD ...`}
      const expression = attr.value.value.trim();
      const templateLiteral = expression.match(/^`([\s\S]*)`$/);
      if (templateLiteral?.[1] !== undefined) return templateLiteral[1];
      const stringLiteral = expression.match(/^(["'])([\s\S]*)\1$/);
      if (stringLiteral?.[2] !== undefined) return stringLiteral[2];
      return expression;
    }
  }
  return null;
}

function mermaidToCodeBlock(node: MdxJsxNode): Code | null {
  const chart = getAttribute(node, "chart");
  if (!chart) return null;
  return { type: "code", lang: "mermaid", value: chart.trim() };
}

function imageToMarkdown(
  node: MdxJsxNode,
  resolveImageUrl: (src: string) => string | null,
): Paragraph | null {
  const src = getAttribute(node, "src");
  if (!src) return null;
  const url = src.startsWith("http") ? src : resolveImageUrl(src);
  if (!url) return null;
  return {
    type: "paragraph",
    children: [{ type: "image", url, alt: getAttribute(node, "alt") ?? "" }],
  };
}

function componentPlaceholder(name: string): Paragraph {
  return {
    type: "paragraph",
    children: [
      {
        type: "emphasis",
        children: [
          {
            type: "text",
            value: `(Interactive ${name} component — view it on the HTML page)`,
          },
        ],
      },
    ],
  };
}

/**
 * Replaces MDX-specific syntax (ESM imports, JSX components, expressions)
 * with plain-Markdown equivalents so the output is readable by any
 * Markdown consumer.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function replaceMdxNodes(
  children: RootContent[],
  resolveImageUrl: (src: string) => string | null,
): RootContent[] {
  const result: RootContent[] = [];
  for (const node of children) {
    switch (node.type) {
      case "mdxjsEsm":
      case "mdxFlowExpression":
      case "mdxTextExpression":
        break;
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement": {
        const jsxNode = node as unknown as MdxJsxNode;
        const name = jsxNode.name ?? "";
        if (name === "Mermaid") {
          const code = mermaidToCodeBlock(jsxNode);
          if (code) result.push(code);
          break;
        }
        if (name === "img" || name === "Image") {
          const image = imageToMarkdown(jsxNode, resolveImageUrl);
          if (image) result.push(image);
          break;
        }
        const jsxChildren = jsxNode.children ?? [];
        if (jsxChildren.length > 0) {
          // Unwrap wrapper components so their inner content survives
          result.push(...replaceMdxNodes(jsxChildren, resolveImageUrl));
        } else if (node.type === "mdxJsxFlowElement" && name) {
          result.push(componentPlaceholder(name));
        }
        break;
      }
      default: {
        const container = node as { children?: RootContent[] };
        if (Array.isArray(container.children)) {
          container.children = replaceMdxNodes(
            container.children,
            resolveImageUrl,
          );
        }
        result.push(node);
      }
    }
  }
  return result;
}

/** Converts MDX source (without frontmatter) to plain Markdown. */
export function mdxToAgentMarkdown(
  mdxContent: string,
  options: MdxToMarkdownOptions = {},
): string {
  const resolveImageUrl = options.resolveImageUrl ?? ((src) => src);
  const processor = remark().use(remarkMdx).use(remarkGfm);
  const tree = processor.parse(mdxContent) as Root;
  tree.children = replaceMdxNodes(tree.children, resolveImageUrl);
  return processor.stringify(tree);
}

export interface PageMetadata {
  title: string;
  /** Path of the HTML page, e.g. "/projects/recipe-site" ("/" for home) */
  htmlPath: string;
  description?: string;
  /** Extra "Key: value" facts rendered under the title */
  facts?: [string, string][];
}

export function renderPageHeader(meta: PageMetadata): string {
  const lines = [`# ${meta.title}`, ""];
  if (meta.description) {
    lines.push(`> ${meta.description}`, "");
  }
  const htmlUrl =
    meta.htmlPath === "/"
      ? siteConfig.url
      : `${siteConfig.url}${meta.htmlPath}`;
  lines.push(`- HTML version: ${htmlUrl}`);
  for (const [key, value] of meta.facts ?? []) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderPageFooter(): string {
  return `---\n\nMarkdown index of this site: ${siteConfig.url}/llms.txt\n`;
}

export function renderPage(meta: PageMetadata, body: string): string {
  return `${renderPageHeader(meta)}\n${body.trim()}\n\n${renderPageFooter()}`;
}

/** Markdown twin URL for an HTML path, e.g. "/projects" -> ".../projects.md" */
export function markdownUrl(htmlPath: string): string {
  if (htmlPath === "/") return `${siteConfig.url}/index.md`;
  return `${siteConfig.url}${htmlPath}.md`;
}
