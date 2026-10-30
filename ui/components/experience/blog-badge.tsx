"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { Badge } from "@/components/ui/badge";
import type { BlogListItemView } from "@/lib/domain/blog/blogViews";
import { cn } from "@/lib/generic/styles";

interface BlogBadgeProps {
  blog: BlogListItemView;
  className?: string;
  source_type?: string;
}

export function BlogBadge({
  blog,
  className,
  source_type = "experience",
}: Readonly<BlogBadgeProps>) {
  return (
    <Link
      href={`/blog/${blog.slug}`}
      onClick={(e) => {
        e.stopPropagation();
        posthog.capture("cross_reference_clicked", {
          source_type,
          target_type: "blog",
          target_slug: blog.slug,
        });
      }}
      aria-label={`View blog post ${blog.title}`}
    >
      <Badge
        variant="outline"
        interactive
        className={cn("max-w-48 sm:max-w-none justify-start", className)}
      >
        <span className="truncate">{blog.title}</span>
      </Badge>
    </Link>
  );
}
