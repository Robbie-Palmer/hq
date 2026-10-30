import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { filesEqual, generateResume } from "./generator";
import { renderResumePreview } from "./preview";
import { pdfResumeRepositoryRoot } from "./repository-root";
import { verifyResume } from "./verify";

const repositoryRoot = pdfResumeRepositoryRoot();
const defaultOutput = path.join(
  repositoryRoot,
  "ui/public/robbie-palmer-resume.pdf",
);

async function withTemporaryDirectory<T>(
  callback: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hq-pdf-resume-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function checkCommitted(outputPath: string): Promise<void> {
  await withTemporaryDirectory(async (directory) => {
    const generatedPath = path.join(directory, path.basename(outputPath));
    await generateResume(repositoryRoot, generatedPath);
    const pdfMatches = await filesEqual(generatedPath, outputPath);
    if (!pdfMatches) {
      throw new Error(
        "Committed resume artifacts are stale; run mise //:resume:generate",
      );
    }
  });
  const result = await verifyResume(repositoryRoot, outputPath);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function checkDeterminism(): Promise<void> {
  await withTemporaryDirectory(async (directory) => {
    const first = path.join(directory, "first.pdf");
    const second = path.join(directory, "second.pdf");
    await generateResume(repositoryRoot, first);
    await generateResume(repositoryRoot, second);
    if (!(await filesEqual(first, second))) {
      throw new Error("Two resume generations produced different PDF bytes");
    }
  });
  process.stdout.write("PDF generation is byte-for-byte deterministic\n");
}

async function main(): Promise<void> {
  const [command = "generate", outputArgument] = process.argv.slice(2);
  const outputPath = outputArgument
    ? path.resolve(repositoryRoot, outputArgument)
    : defaultOutput;
  switch (command) {
    case "generate": {
      const provenance = await generateResume(repositoryRoot, outputPath);
      process.stdout.write(`${JSON.stringify(provenance.pdf)}\n`);
      return;
    }
    case "verify": {
      const result = await verifyResume(repositoryRoot, outputPath);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    case "check":
      await checkCommitted(outputPath);
      return;
    case "determinism":
      await checkDeterminism();
      return;
    case "preview": {
      const outputDirectory = outputArgument
        ? path.resolve(repositoryRoot, outputArgument)
        : path.join(repositoryRoot, "artifacts/resume-preview");
      const outputs = await renderResumePreview(
        repositoryRoot,
        outputDirectory,
      );
      process.stdout.write(`${JSON.stringify(outputs)}\n`);
      return;
    }
    default:
      throw new Error(
        `Unknown command '${command}'. Use generate, verify, check, determinism, or preview.`,
      );
  }
}

await main();
