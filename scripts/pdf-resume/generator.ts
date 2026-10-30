import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildResumeLayout } from "./layout";
import type { ResumeProvenance } from "./model";
import { createPdf, extractPdfLinks } from "./pdf";
import { loadResumeSource } from "./source";

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function provenancePath(pdfPath: string): string {
  return pdfPath.endsWith(".pdf")
    ? `${pdfPath.slice(0, -4)}.provenance.json`
    : `${pdfPath}.provenance.json`;
}

export async function generateResume(
  repositoryRoot: string,
  outputPath: string,
): Promise<ResumeProvenance> {
  const source = await loadResumeSource(repositoryRoot);
  const layout = buildResumeLayout(source);
  const pdf = createPdf(layout, source.sourceDigest);
  const relativeOutputPath = path
    .relative(repositoryRoot, outputPath)
    .split(path.sep)
    .join("/");
  const provenance: ResumeProvenance = {
    schemaVersion: 1,
    generator: "scripts/pdf-resume",
    sourceDigest: source.sourceDigest,
    sources: source.sourceFiles,
    selectedProjects: source.projects.map(({ slug }) => slug),
    pdf: {
      path: relativeOutputPath,
      sha256: sha256(pdf),
      pages: layout.pageCount,
      links: [...new Set(extractPdfLinks(pdf))].sort((left, right) =>
        left.localeCompare(right),
      ),
    },
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, pdf);
  await writeFile(
    provenancePath(outputPath),
    `${JSON.stringify(provenance, null, 2)}\n`,
    "utf8",
  );
  return provenance;
}

export async function filesEqual(left: string, right: string): Promise<boolean> {
  const [leftValue, rightValue] = await Promise.all([
    readFile(left),
    readFile(right),
  ]);
  return leftValue.equals(rightValue);
}
