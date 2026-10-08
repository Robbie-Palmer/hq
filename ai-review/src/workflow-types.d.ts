import type { WorkflowStepConfig } from "cloudflare:workers";

declare module "cloudflare:workers" {
  interface WorkflowStep {
    do<T>(name: string, operation: () => Promise<T>): Promise<T>;
    do<T>(
      name: string,
      config: WorkflowStepConfig,
      operation: () => Promise<T>,
    ): Promise<T>;
  }
}
