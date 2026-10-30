import { Badge } from "@/components/ui/badge";
import {
  INITIATIVE_STATUS_CONFIG,
  type InitiativeStatus,
} from "@/lib/domain/initiative/initiative";
import { cn } from "@/lib/generic/styles";

interface InitiativeStatusBadgeProps {
  status: InitiativeStatus;
  className?: string;
}

export function InitiativeStatusBadge({
  status,
  className,
}: Readonly<InitiativeStatusBadgeProps>) {
  return (
    <Badge
      className={cn(INITIATIVE_STATUS_CONFIG[status].badgeClass, className)}
    >
      {INITIATIVE_STATUS_CONFIG[status].label}
    </Badge>
  );
}
