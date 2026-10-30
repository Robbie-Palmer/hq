# mdx-rendering

Shared Markdown and MDX transforms used by the site and other workspace consumers.
The package contains no React or Next.js composition.

The root export provides:

- `remarkRestrictMdxExpressions`, which rejects dynamic expressions, active
  elements, event handlers, HTML injection, and executable URL schemes.
- `markdownCodeHighlighting`, the `rehype-pretty-code` configuration with the
  Cooklang grammar and light and dark themes.
- `parseFrontmatter`, the `gray-matter` wrapper that disables JavaScript
  frontmatter evaluation.
- `mdxToAgentMarkdown`, which converts MDX syntax to plain Markdown for static
  agent-readable pages.
- `createAgentMarkdownPages`, which creates page and URL helpers after the
  caller supplies its site URL.

```ts
import {
  createAgentMarkdownPages,
  mdxToAgentMarkdown,
  remarkRestrictMdxExpressions,
} from "mdx-rendering";

const pages = createAgentMarkdownPages({ siteUrl: "https://example.com" });
const markdown = mdxToAgentMarkdown(source);
const page = pages.renderPage(
  { title: "Example", htmlPath: "/example" },
  markdown,
);
```
