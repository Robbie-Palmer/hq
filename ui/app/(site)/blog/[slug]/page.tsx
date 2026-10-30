import { Tag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "ts-base/dates";
import {
  DebtInvestmentChart,
  FinancialIndependenceChart,
  LisaComparisonChart,
  PensionReturnsChart,
} from "@/components/blog/how-to-build-wealth/lazy-wealth-charts";
import { ShareButtons } from "@/components/blog/share-buttons";
import { IdeaBadges } from "@/components/ideas/idea-badges";
import { Markdown } from "@/components/markdown";
import { Mermaid } from "@/components/mermaid";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getAllPostSlugs, getPostBySlug } from "@/lib/api/blog";
import { getIdeasForBlog } from "@/lib/api/ideas";
import { siteConfig } from "@/lib/config/site-config";
import {
  getImageSrcSet,
  getImageUrl,
} from "@/lib/integrations/cloudflare-images";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const { slug } = params;
  const validSlugs = getAllPostSlugs();
  if (!validSlugs.includes(slug)) {
    notFound();
  }

  const post = getPostBySlug(slug);
  // Use custom canonical URL if specified, otherwise use production URL
  // Canonical URLs should always point to production, even in preview deployments
  const canonicalUrl = post.canonicalUrl || `${siteConfig.url}/blog/${slug}`;
  // OG images use the 'og' variant (1200px, optimized for social media)
  const imageUrl = post.image
    ? getImageUrl(post.image, "og")
    : siteConfig.ogImage;

  return {
    title: post.title,
    description: post.description,
    authors: [
      { name: siteConfig.author.name, url: siteConfig.author.linkedin },
    ],
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: post.title,
      description: post.description,
      url: `/blog/${slug}`,
      siteName: siteConfig.name,
      type: "article",
      publishedTime: post.date,
      modifiedTime: post.updated || post.date,
      authors: [siteConfig.author.name],
      tags: post.tags,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: post.image ? 675 : 630,
          alt: post.imageAlt || post.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [imageUrl],
    },
  };
}

export default async function BlogPostPage(props: Readonly<PageProps>) {
  const params = await props.params;
  const { slug } = params;

  const post = getPostBySlug(slug);
  const ideas = getIdeasForBlog(slug);

  return (
    <article className="container mx-auto px-4 py-12 max-w-4xl">
      <Link
        href="/blog"
        className="text-sm text-muted-foreground hover:text-foreground mb-8 inline-block"
      >
        ← Back to blog
      </Link>

      <header className="mb-8">
        <h1 className="text-4xl font-bold mb-4">{post.title}</h1>
        <p className="text-xl text-muted-foreground mb-4">{post.description}</p>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="text-muted-foreground">
            <time>{formatDate(post.date)}</time>
            <span className="mx-2">·</span>
            <span>{post.readingTime}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <Link key={tag} href={`/blog?tag=${encodeURIComponent(tag)}`}>
                <Badge
                  variant="secondary"
                  className="gap-1 hover:bg-primary/20 hover:text-primary hover:border-primary/30 border border-transparent transition-colors"
                >
                  <Tag className="h-3 w-3" />
                  {tag}
                </Badge>
              </Link>
            ))}
          </div>

          <IdeaBadges ideas={ideas} />

          <div className="sm:ml-auto">
            <ShareButtons
              slug={slug}
              title={post.title}
              url={`${siteConfig.url}/blog/${slug}`}
            />
          </div>
        </div>
      </header>

      {post.image && (
        <div className="relative w-full aspect-video mb-8 rounded-lg overflow-hidden bg-muted">
          {/* biome-ignore lint/performance/noImgElement: Need native img for srcset control with SSG */}
          <img
            src={getImageUrl(post.image, null, {
              width: 800,
              format: "auto",
            })}
            srcSet={getImageSrcSet(post.image, null, [800, 1200, 1600])}
            alt={post.imageAlt || post.title}
            sizes="(max-width: 896px) 100vw, 896px"
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>
      )}

      <Separator className="mb-8" />

      <Markdown
        source={post.content}
        components={{
          DebtInvestmentChart,
          PensionReturnsChart,
          LisaComparisonChart,
          FinancialIndependenceChart,
          Mermaid,
        }}
      />
    </article>
  );
}
