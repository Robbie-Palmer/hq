import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ADR } from "@/lib/api/projects";
import { formatADRSlugIndex, normalizeADRTitle } from "@/lib/domain/adr/adr";
import { cn } from "@/lib/generic/styles";

interface ADRPaginationProps {
  projectSlug: string;
  prevAdr?: ADR;
  nextAdr?: ADR;
  variant?: "full" | "minimal";
  compact?: boolean;
  className?: string;
}

export function ADRPagination({
  projectSlug,
  prevAdr,
  nextAdr,
  variant = "full",
  compact = false,
  className,
}: Readonly<ADRPaginationProps>) {
  // If no nav is possible, render nothing
  if (!prevAdr && !nextAdr) return null;
  return (
    <div
      className={cn(
        "flex flex-row gap-4 items-center",
        compact ? "w-full sm:w-auto" : "justify-between",
        className,
      )}
    >
      {prevAdr ? (
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-auto py-2 px-3 flex items-center gap-2 min-w-0 flex-1 max-w-none md:max-w-[200px] lg:max-w-none xl:max-w-[200px] text-left",
          )}
          asChild
        >
          <Link href={`/projects/${projectSlug}/adrs/${prevAdr.slug}`}>
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
                  <span className="font-mono mr-1">
                    ADR {formatADRSlugIndex(prevAdr.slug)}:
                  </span>
                  {normalizeADRTitle(prevAdr.title)}
                </div>
              )}
            </div>
          </Link>
        </Button>
      ) : (
        !compact && <div className="flex-1" />
      )}

      {nextAdr ? (
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-auto py-2 px-3 flex items-center gap-2 min-w-0 flex-1 max-w-none md:max-w-[200px] lg:max-w-none xl:max-w-[200px] text-right ml-auto",
          )}
          asChild
        >
          <Link href={`/projects/${projectSlug}/adrs/${nextAdr.slug}`}>
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
                  <span className="font-mono mr-1">
                    ADR {formatADRSlugIndex(nextAdr.slug)}:
                  </span>
                  {normalizeADRTitle(nextAdr.title)}
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
