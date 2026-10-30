import { Badge } from "@/components/ui/badge";
import type { ADR } from "@/lib/api/projects";
import { ADR_STATUS_CONFIG } from "@/lib/domain/adr/adr";
import { cn } from "@/lib/generic/styles";

interface ADRBadgeProps {
  status: ADR["status"];
  className?: string;
}

export function ADRBadge({ status, className }: Readonly<ADRBadgeProps>) {
  return (
    <Badge
      className={cn(ADR_STATUS_CONFIG[status].badgeClass, className)}
      variant="secondary"
    >
      {status}
    </Badge>
  );
}
