import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { TechnologyBadgeView } from "@/lib/domain/technology/technologyViews";
import { cn } from "@/lib/generic/styles";

interface TechPaginationProps {
  prevTech?: TechnologyBadgeView;
  nextTech?: TechnologyBadgeView;
  variant?: "full" | "minimal";
  compact?: boolean;
  className?: string;
}

export function TechPagination({
  prevTech,
  nextTech,
  variant = "full",
  compact = false,
  className,
}: Readonly<TechPaginationProps>) {
  if (!prevTech && !nextTech) return null;
  return (
    <div
      className={cn(
        "flex flex-row gap-4 items-center",
        compact ? "w-full sm:w-auto" : "justify-between",
        className,
      )}
    >
      {prevTech ? (
        <Button
          variant="outline"
          size="sm"
          className="h-auto py-2 px-3 flex items-center gap-2 min-w-0 flex-1 md:flex-none md:max-w-[200px] text-left"
          asChild
        >
          <Link href={`/technologies/${prevTech.slug}`}>
            <ArrowLeft className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <div className="truncate flex-1">
              <div
                className={cn(
                  "text-muted-foreground",
                  variant === "full" && "text-[10px] sm:text-[10px]",
                  variant === "minimal" && "text-xs sm:text-sm font-medium",
                )}
              >
                Previous
              </div>
              {variant === "full" && (
                <div className="text-xs sm:text-sm font-medium truncate">
                  {prevTech.name}
                </div>
              )}
            </div>
          </Link>
        </Button>
      ) : (
        !compact && <div className="flex-1" />
      )}

      {nextTech ? (
        <Button
          variant="outline"
          size="sm"
          className="h-auto py-2 px-3 flex items-center gap-2 min-w-0 flex-1 md:flex-none md:max-w-[200px] text-right"
          asChild
        >
          <Link href={`/technologies/${nextTech.slug}`}>
            <div className="truncate flex-1">
              <div
                className={cn(
                  "text-muted-foreground",
                  variant === "full" && "text-[10px] sm:text-[10px]",
                  variant === "minimal" && "text-xs sm:text-sm font-medium",
                )}
              >
                Next
              </div>
              {variant === "full" && (
                <div className="text-xs sm:text-sm font-medium truncate">
                  {nextTech.name}
                </div>
              )}
            </div>
            <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          </Link>
        </Button>
      ) : (
        !compact && <div className="flex-1" />
      )}
    </div>
  );
}
