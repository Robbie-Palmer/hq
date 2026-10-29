import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import {
  getImageSrcSet,
  getImageUrl,
} from "@/lib/integrations/cloudflare-images";
import { markdownCodeHighlighting } from "@/lib/markdown/code-highlighting";

type MDXComponents = React.ComponentProps<typeof MDXRemote>["components"];
type MDXOptions = NonNullable<
  NonNullable<React.ComponentProps<typeof MDXRemote>["options"]>["mdxOptions"]
>;

export interface MarkdownProps {
  source: string;
  components?: MDXComponents; // Custom MDX components to override default rendering
  className?: string; // Optional className to apply to the wrapper article element
  remarkPlugins?: MDXOptions extends { remarkPlugins?: infer T } ? T : never;
}

const baseComponents: MDXComponents = {
  a: ({ href, children, ...props }) => {
    const isInternal = href?.startsWith("/") || href?.startsWith("#");
    if (isInternal) {
      return (
        <Link href={href as string} {...props}>
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-words"
        {...props}
      >
        {children}
      </a>
    );
  },
};

/**
 * Consolidated Markdown component for rendering MDX content
 *
 * Features:
 * - GitHub Flavored Markdown support (tables, task lists, strikethrough, etc.)
 * - Syntax highlighting with dual themes (github-dark/github-light)
 * - Automatic heading IDs and anchor links
 * - Tailwind Typography styling
 * - Smart internal/external link handling
 * - Cloudflare Images preprocessing with responsive srcset
 * - Custom component support (e.g., Mermaid, custom charts)
 *
 * @example
 * ```tsx
 * import { Markdown } from "@/components/markdown";
 * import { Mermaid } from "@/components/mermaid";
 *
 * <Markdown
 *   source={content}
 *   components={{ Mermaid }}
 * />
 * ```
 */
const defaultClassName = "prose prose-zinc dark:prose-invert max-w-none";

export function Markdown({
  source,
  components,
  className = defaultClassName,
  remarkPlugins = [],
}: Readonly<MarkdownProps>) {
  return (
    <article className={className}>
      <MarkdownContent
        source={source}
        components={components}
        remarkPlugins={remarkPlugins}
      />
    </article>
  );
}

export function MarkdownContent({
  source,
  components,
  remarkPlugins = [],
}: Readonly<Omit<MarkdownProps, "className">>) {
  // Convert Cloudflare Images IDs to responsive URLs in every MDX renderer,
  // including pitch decks that render without an article wrapper.
  const processedContent = source.replace(
    /src="([a-z0-9_-]+\/[a-z0-9_-]+-\d{4}-\d{2}-\d{2})"/g,
    (_match, imageId) => {
      const url = getImageUrl(imageId, null, { width: 800, format: "auto" });
      const srcSet = getImageSrcSet(imageId, null, [800, 1200, 1600]);
      return `src="${url}" srcSet="${srcSet}" sizes="(max-width: 896px) 100vw, 896px" loading="lazy"`;
    },
  );

  return (
    <MDXRemote
      source={processedContent}
      components={{ ...baseComponents, ...components }}
      options={{
        parseFrontmatter: true,
        blockJS: false,
        mdxOptions: {
          remarkPlugins: [remarkGfm, ...(remarkPlugins ?? [])],
          rehypePlugins: [
            rehypeSlug,
            rehypeAutolinkHeadings,
            markdownCodeHighlighting,
          ],
        },
      }}
    />
  );
}
