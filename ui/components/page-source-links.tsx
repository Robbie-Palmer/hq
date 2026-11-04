"use client";

import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { siteConfig } from "@/lib/config/site-config";
import { resolvePageSource } from "@/lib/content/page-source";
import { cn } from "@/lib/generic/styles";

interface PageSourceLinksProps {
  className?: string;
  linkClassName?: string;
}

export function PageSourceLinks({
  className,
  linkClassName,
}: Readonly<PageSourceLinksProps>) {
  const pathname = usePathname();
  const pageSource = resolvePageSource(pathname);

  return (
    <nav
      aria-label="Source links"
      className={cn("flex items-center gap-2 text-sm", className)}
    >
      <a
        href={pageSource.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "hover:text-foreground transition-colors underline decoration-dotted underline-offset-4",
          linkClassName,
        )}
        onClick={() =>
          posthog.capture("source_code_viewed", {
            source: "page_footer",
            source_kind: pageSource.kind,
            pathname,
            url: pageSource.url,
          })
        }
      >
        Page source
      </a>
      <span aria-hidden="true">·</span>
      <a
        href={siteConfig.author.sourceRepo}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "hover:text-foreground transition-colors underline decoration-dotted underline-offset-4",
          linkClassName,
        )}
        onClick={() =>
          posthog.capture("source_code_viewed", {
            source: "repository_footer",
            pathname,
            url: siteConfig.author.sourceRepo,
          })
        }
      >
        Repository
      </a>
    </nav>
  );
}
