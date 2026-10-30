import {
  createAgentMarkdownPages,
  type MdxToMarkdownOptions,
  mdxToAgentMarkdown,
  type PageMetadata,
} from "mdx-rendering";
import { siteConfig } from "@/lib/config/site-config";

const pageHelpers = createAgentMarkdownPages({ siteUrl: siteConfig.url });

export const { markdownUrl, renderPage, renderPageFooter, renderPageHeader } =
  pageHelpers;
export type { MdxToMarkdownOptions, PageMetadata };
export { mdxToAgentMarkdown };
