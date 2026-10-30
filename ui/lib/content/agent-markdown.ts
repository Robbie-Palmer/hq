import { createAgentMarkdownPages } from "mdx-rendering";
import { siteConfig } from "@/lib/config/site-config";

export {
  type MdxToMarkdownOptions,
  mdxToAgentMarkdown,
  type PageMetadata,
} from "mdx-rendering";

const pageHelpers = createAgentMarkdownPages({ siteUrl: siteConfig.url });

export const { markdownUrl, renderPage, renderPageFooter, renderPageHeader } =
  pageHelpers;
