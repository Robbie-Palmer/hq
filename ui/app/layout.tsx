import type { Metadata } from "next";
import "./globals.css";
import { CommandPaletteProvider } from "@/components/command-palette-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { siteConfig } from "@/lib/config/site-config";
import {
  getAllBlogListItems,
  getAllInitiatives,
  getAllProjectListItems,
  loadDomainRepository,
} from "@/lib/domain";
import { getAllIdeas } from "@/lib/domain/idea";
import { getAllTechnologyBadgesSorted } from "@/lib/domain/technology";

// Use Cloudflare Pages URL for preview deployments, fallback to production URL
const baseUrl = process.env.CF_PAGES_URL || siteConfig.url;

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  alternates: {
    canonical: siteConfig.url,
    types: {
      "application/rss+xml": [
        { url: "/feed.xml", title: `${siteConfig.name} RSS Feed` },
      ],
    },
  },
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  authors: [{ name: siteConfig.author.name, url: siteConfig.author.linkedin }],
  openGraph: {
    type: "website",
    locale: "en_GB",
    // Always use production URL for canonical/permanent reference, even in previews
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const repository = loadDomainRepository();
  const technologies = getAllTechnologyBadgesSorted(repository).map((tech) => ({
    slug: tech.slug,
    name: tech.name,
    iconSlug: tech.iconSlug,
    hasIcon: tech.hasIcon,
  }));
  const ideas = getAllIdeas(repository).map((idea) => ({
    slug: idea.slug,
    title: idea.title,
  }));
  const projects = getAllProjectListItems(repository).map((project) => ({
    slug: project.slug,
    title: project.title,
  }));
  const initiatives = getAllInitiatives(repository).map((initiative) => ({
    slug: initiative.slug,
    title: initiative.title,
  }));
  const blogPosts = getAllBlogListItems(repository).map((post) => ({
    slug: post.slug,
    title: post.title,
  }));

  return (
    <html lang="en-GB" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <CommandPaletteProvider
            technologies={technologies}
            ideas={ideas}
            projects={projects}
            initiatives={initiatives}
            blogPosts={blogPosts}
          >
            {children}
          </CommandPaletteProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
