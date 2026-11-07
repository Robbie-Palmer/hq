"use client";

import { AlertTriangle, Database, LoaderCircle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/generic/styles";

export function WorkflowPage({
  title,
  description,
  actions,
  children,
}: Readonly<{
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <section aria-labelledby="workflow-page-title">
      <div className="page-heading">
        <div>
          <h1 id="workflow-page-title">{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function WorkflowLoadingState() {
  return (
    <output
      aria-label="Loading saved wedding plan"
      className="workflow-state workflow-loading"
    >
      <LoaderCircle aria-hidden="true" className="workflow-spin" />
      <span>Loading saved plan...</span>
    </output>
  );
}

export function WorkflowErrorState({
  message,
  onRetry,
}: Readonly<{ message: string; onRetry?: () => void }>) {
  return (
    <div role="alert" className="workflow-state workflow-error">
      <AlertTriangle aria-hidden="true" />
      <div>
        <strong>Wedding plan unavailable</strong>
        <p>{message}</p>
        {onRetry && (
          <Button type="button" variant="outline" onClick={onRetry}>
            <RotateCw aria-hidden="true" /> Try again
          </Button>
        )}
      </div>
    </div>
  );
}

export function WorkflowEmptyState({
  title,
  description,
  action,
  className,
}: Readonly<{
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}>) {
  return (
    <Card className={cn("workflow-empty", className)}>
      <CardHeader>
        <Database aria-hidden="true" />
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {action && <CardContent>{action}</CardContent>}
    </Card>
  );
}

export function WorkflowFormSection({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description?: string;
  children: ReactNode;
}>) {
  return (
    <Card className="workflow-form-section">
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function WorkflowDataTable({
  caption,
  children,
}: Readonly<{ caption: string; children: ReactNode }>) {
  return (
    <div className="workflow-table-wrap">
      <table className="workflow-table">
        <caption>{caption}</caption>
        {children}
      </table>
    </div>
  );
}
