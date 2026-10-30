import { Badge } from "@/components/ui/badge";
import type { ProjectStatus } from "@/lib/api/projects";
import { PROJECT_STATUS_CONFIG } from "@/lib/domain/project/project";
import { cn } from "@/lib/generic/styles";

interface ProjectStatusBadgeProps {
  status: ProjectStatus;
  className?: string;
  interactive?: boolean;
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function ProjectStatusBadge({
  status,
  className,
  interactive,
  active,
  onClick,
}: Readonly<ProjectStatusBadgeProps>) {
  return (
    <Badge
      className={cn(
        PROJECT_STATUS_CONFIG[status].badgeClass,
        interactive && "cursor-pointer",
        interactive && active && "ring-2 ring-offset-1 ring-current",
        className,
      )}
      onClick={onClick}
    >
      {PROJECT_STATUS_CONFIG[status].label}
    </Badge>
  );
}
