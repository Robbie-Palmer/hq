"use client";

import type { EmblaOptionsType } from "embla-carousel";
import Link from "next/link";
import { formatDate } from "ts-base/dates";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ContentCarousel } from "@/components/ui/content-carousel";
import type { BlogPost } from "@/lib/api/blog";
import { defaultCarouselConfig } from "@/lib/config/carousel-config";
import { getImageUrl } from "@/lib/integrations/cloudflare-images";

type BlogCarouselProps = {
  posts: BlogPost[];
  options?: EmblaOptionsType;
  autoScroll?: boolean;
  scrollSpeed?: number;
  stopOnInteraction?: boolean;
  stopOnMouseEnter?: boolean;
};

export function BlogCarousel({
  posts,
  options,
  autoScroll = defaultCarouselConfig.autoScroll,
  scrollSpeed = defaultCarouselConfig.scrollSpeed,
  stopOnInteraction = defaultCarouselConfig.stopOnInteraction,
  stopOnMouseEnter = defaultCarouselConfig.stopOnMouseEnter,
}: Readonly<BlogCarouselProps>) {
  return (
    <ContentCarousel
      items={posts}
      getItemKey={(post) => post.slug}
      options={options}
      autoScroll={autoScroll}
      scrollSpeed={scrollSpeed}
      stopOnInteraction={stopOnInteraction}
      stopOnMouseEnter={stopOnMouseEnter}
      renderItem={(post, index) => (
        <Link href={`/blog/${post.slug}`} className="group block h-full">
          <Card className="h-full flex flex-col overflow-hidden transition-all hover:shadow-lg hover:border-primary/50">
            {post.image && (
              <div className="relative w-full h-40 bg-muted overflow-hidden">
                {/* biome-ignore lint/performance/noImgElement: Need native img for srcset control with SSG */}
                <img
                  src={getImageUrl(post.image, null, {
                    width: 400,
                    format: "auto",
                  })}
                  alt={post.imageAlt || post.title}
                  width={400}
                  height={160}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading={index === 0 ? "eager" : "lazy"}
                  fetchPriority={index === 0 ? "high" : undefined}
                />
              </div>
            )}
            <CardHeader className="flex-1">
              <CardTitle className="line-clamp-2 group-hover:text-primary transition-colors">
                {post.title}
              </CardTitle>
              <CardDescription className="line-clamp-2">
                {post.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {post.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                <time>{formatDate(post.date)}</time>
                <span className="mx-2">·</span>
                <span>{post.readingTime}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}
    />
  );
}
