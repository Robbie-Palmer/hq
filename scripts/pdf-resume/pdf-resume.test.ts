import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateResume, provenancePath } from "./generator";
import { buildResumeLayout, validateLayout, wrapText } from "./layout";
import { countPdfPages, extractPdfLinks, extractPdfText } from "./pdf";
import { renderLayoutPage } from "./preview";
import { pdfResumeRepositoryRoot } from "./repository-root";
import { loadResumeSource } from "./source";
import { verifyResume } from "./verify";

const repositoryRoot = pdfResumeRepositoryRoot();
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pdf-resume-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("PDF resume", () => {
  it("loads experience and projects from canonical site files", async () => {
    const source = await loadResumeSource(repositoryRoot);

    expect(source.experiences).toHaveLength(8);
    expect(source.projects).toHaveLength(5);
    expect(source.sourceFiles.length).toBeGreaterThan(30);
    expect(source.experiences[0]?.sourcePath).toBe("ui/content/experience.ts");
    expect(
      source.projects.every(({ sourcePath }) =>
        sourcePath.startsWith("ui/content/projects/"),
      ),
    ).toBe(true);
  });

  it("wraps text within the requested width", () => {
    const lines = wrapText(
      "A deterministic line wrapper keeps every word and breaks long copy",
      10,
      120,
    );

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(
      "A deterministic line wrapper keeps every word and breaks long copy",
    );
  });

  it("keeps all laid-out text inside two A4 pages", async () => {
    const layout = buildResumeLayout(await loadResumeSource(repositoryRoot));

    expect(() => validateLayout(layout)).not.toThrow();
    expect(layout.pageCount).toBe(2);
    expect(layout.pageWidth).toBeCloseTo(595.28);
    expect(layout.pageHeight).toBeCloseTo(841.89);
    const preview = renderLayoutPage(layout, 1);
    expect(preview).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(preview).toContain("Robbie Palmer");
  });

  it("generates byte-identical PDFs with extractable text and live links", async () => {
    const directory = await temporaryDirectory();
    const firstPath = path.join(directory, "first.pdf");
    const secondPath = path.join(directory, "second.pdf");
    const source = await loadResumeSource(repositoryRoot);
    await generateResume(repositoryRoot, firstPath);
    await generateResume(repositoryRoot, secondPath);
    const [first, second] = await Promise.all([
      readFile(firstPath),
      readFile(secondPath),
    ]);

    expect(first.equals(second)).toBe(true);
    expect(countPdfPages(first)).toBe(2);
    const text = extractPdfText(first);
    expect(text).toContain(source.person.name);
    for (const experience of source.experiences) {
      expect(text).toContain(experience.company);
    }
    const links = extractPdfLinks(first);
    expect(links).toContain(source.person.website);
    expect(links).toContain(source.person.linkedin);
    expect(links).toContain(source.person.github);
  });

  it("writes verifiable content provenance", async () => {
    const directory = await temporaryDirectory();
    const outputPath = path.join(directory, "resume.pdf");
    await generateResume(repositoryRoot, outputPath);

    const result = await verifyResume(repositoryRoot, outputPath);
    const provenance = JSON.parse(
      await readFile(provenancePath(outputPath), "utf8"),
    ) as { sourceDigest: string; sources: unknown[] };
    const source = await loadResumeSource(repositoryRoot);

    expect(result.pages).toBe(2);
    expect(result.extractedCharacters).toBeGreaterThan(2_000);
    expect(result.links).toBeGreaterThan(10);
    expect(provenance.sourceDigest).toBe(source.sourceDigest);
    expect(provenance.sources).toEqual(source.sourceFiles);
  });
});
