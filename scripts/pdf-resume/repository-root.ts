import { fileURLToPath } from "node:url";

export function pdfResumeRepositoryRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}
