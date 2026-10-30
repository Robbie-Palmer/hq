"use client";

import posthog from "posthog-js";
import { useCallback, useState } from "react";
import { BlogCarousel } from "@/components/blog/blog-carousel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BlogPost } from "@/lib/api/blog";
import type { BlogCollectionWithId } from "@/lib/api/blog-collections";
import { cn } from "@/lib/generic/styles";

type BlogCollectionTabsProps = {
  collections: BlogCollectionWithId[];
  collectionPosts: Record<string, BlogPost[]>;
  defaultCollectionId?: string;
};

export function BlogCollectionTabs({
  collections,
  collectionPosts,
  defaultCollectionId,
}: Readonly<BlogCollectionTabsProps>) {
  const [activeCollection, setActiveCollection] = useState(
    defaultCollectionId || collections[0]?.id || "all",
  );
  const currentCollection = collections.find((c) => c.id === activeCollection);
  const currentPosts = collectionPosts[activeCollection] || [];

  const handleCollectionChange = useCallback(
    (id: string) => {
      setActiveCollection(id);
      const collection = collections.find((c) => c.id === id);
      posthog.capture("blog_collection_selected", {
        collection_id: id,
        collection_title: collection?.title,
      });
    },
    [collections],
  );

  if (!currentCollection) return null;
  return (
    <div className="space-y-8">
      {/* Main title */}
      <div>
        <h2 className="text-3xl font-bold mb-6">Explore Posts</h2>
      </div>

      {/* Mobile dropdown */}
      <div className="md:hidden">
        <Select value={activeCollection} onValueChange={handleCollectionChange}>
          <SelectTrigger className="w-full" aria-label="Select blog collection">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {collections.map((collection) => (
              <SelectItem key={collection.id} value={collection.id}>
                {collection.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop tabs */}
      <div className="hidden md:block border-b border-border">
        <nav className="flex gap-8" aria-label="Blog collections">
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              onClick={() => handleCollectionChange(collection.id)}
              className={cn(
                "pb-4 px-1 text-sm font-medium whitespace-nowrap transition-colors border-b-2",
                activeCollection === collection.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              )}
              aria-pressed={activeCollection === collection.id}
            >
              {collection.title}
            </button>
          ))}
        </nav>
      </div>

      {/* Carousel */}
      {currentPosts.length > 0 ? (
        <BlogCarousel posts={currentPosts} />
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          No posts found in this collection.
        </div>
      )}
    </div>
  );
}
