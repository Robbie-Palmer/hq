import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ProductDecision,
  productDecisionPath,
} from "@/lib/domain/product-decision";

export function ProductDecisionList({
  decisions,
}: Readonly<{ decisions: ProductDecision[] }>) {
  if (decisions.length === 0) {
    return (
      <p className="text-muted-foreground">
        No product decisions have been published yet.
      </p>
    );
  }
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {decisions.map((decision) => (
        <Link key={decision.pdrRef} href={productDecisionPath(decision.pdrRef)}>
          <Card className="h-full transition-colors hover:border-primary/50">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <CardTitle>{decision.title}</CardTitle>
                <Badge variant="secondary">{decision.status}</Badge>
              </div>
              <CardDescription>
                {decision.projectSlug} · Opened {decision.date} ·{" "}
                {decision.readingTime}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
