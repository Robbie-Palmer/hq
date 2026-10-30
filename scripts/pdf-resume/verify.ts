import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResumeProvenance } from "./model";
import {
  countPdfPages,
  extractPdfLinks,
  extractPdfText,
} from "./pdf";
import { loadResumeSource } from "./source";
import { provenancePath } from "./generator";

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export interface VerificationResult {
  pages: number;
  extractedCharacters: number;
  links: number;
  sourceFiles: number;
  pdfSha256: string;
}

export async function verifyResume(
  repositoryRoot: string,
  pdfPath: string,
): Promise<VerificationResult> {
  const [pdf, provenanceSource, source] = await Promise.all([
    readFile(pdfPath),
    readFile(provenancePath(pdfPath), "utf8"),
    loadResumeSource(repositoryRoot),
  ]);
  const provenance = JSON.parse(provenanceSource) as ResumeProvenance;
  const pdfHash = sha256(pdf);
  const pages = countPdfPages(pdf);
  const text = extractPdfText(pdf);
  const links = extractPdfLinks(pdf);

  assert(provenance.schemaVersion === 1, "Unsupported provenance schema");
  assert(provenance.pdf.sha256 === pdfHash, "PDF hash does not match provenance");
  assert(provenance.sourceDigest === source.sourceDigest, "Canonical source content changed; regenerate the resume");
  assert(
    JSON.stringify(provenance.sources) === JSON.stringify(source.sourceFiles),
    "Provenance source hashes do not match canonical content",
  );
  assert(pages === 2, `Expected exactly 2 PDF pages, found ${pages}`);
  assert(provenance.pdf.pages === pages, "Provenance page count is stale");
  assert(text.length >= 2_000, `Extracted text is unexpectedly short: ${text.length} characters`);
  assert(text.includes(source.person.name), "Extracted PDF text has no person name");
  for (const experience of source.experiences) {
    assert(
      text.includes(experience.company),
      `Extracted PDF text has no experience for ${experience.company}`,
    );
  }
  for (const project of source.projects) {
    assert(
      text.includes(project.title),
      `Extracted PDF text has no selected project ${project.title}`,
    );
  }
  const expectedLinks = new Set([
    source.person.website,
    source.person.github,
    source.person.linkedin,
    ...source.experiences.map(({ companyUrl }) => companyUrl),
    ...source.projects.flatMap((project) =>
      [project.canonicalUrl, project.repositoryUrl].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ]);
  for (const expectedLink of expectedLinks) {
    assert(links.includes(expectedLink), `PDF has no hyperlink for ${expectedLink}`);
  }
  assert(
    JSON.stringify([...new Set(links)].sort()) ===
      JSON.stringify(provenance.pdf.links),
    "Provenance hyperlink inventory is stale",
  );
  assert(
    provenance.pdf.path ===
      path.relative(repositoryRoot, pdfPath).split(path.sep).join("/"),
    "Provenance artifact path is stale",
  );

  return {
    pages,
    extractedCharacters: text.length,
    links: new Set(links).size,
    sourceFiles: source.sourceFiles.length,
    pdfSha256: pdfHash,
  };
}
