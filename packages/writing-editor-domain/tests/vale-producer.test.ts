import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { DecisionSchema } from "../src/decisions";
import { main as reviewCommand } from "../src/review-cli";
import { ReviewReceiptSchema } from "../src/review-receipt";
import {
  runValeDeterministicProducer,
  UNSLOP_RULE_CLASSIFICATION,
  valeAlertsToReviewRecords,
} from "../src/vale-producer";

function scriptedInput(...answers: string[]): PassThrough {
  const input = new PassThrough();
  answers.forEach((answer, index) => {
    setTimeout(() => {
      input.write(`${answer}\n`);
      if (index === answers.length - 1) input.end();
    }, (index + 1) * 10);
  });
  return input;
}

describe("deterministic Vale producer", () => {
  it("classifies every repository Unslop rule", async () => {
    const styles = resolve(import.meta.dirname, "../../../.vale/styles/Unslop");
    const checks = (await readdir(styles))
      .filter((file) => file.endsWith(".yml"))
      .map((file) => `Unslop.${basename(file, ".yml")}`)
      .sort();

    expect(Object.keys(UNSLOP_RULE_CLASSIFICATION).sort()).toEqual(checks);
  });

  it("emits exact proposals only for safe rules and remains idempotent", () => {
    const source = "# Draft\n\nUtilize evidence, not merely polish.\n";
    const result = valeAlertsToReviewRecords({
      source,
      documentId: "draft.md",
      revision: "worktree:test",
      producerVersion: "vale@3.13.0",
      alerts: [
        {
          Span: [1, 7],
          Check: "Unslop.PlainWordsSafe",
          Message: "Use the plain replacement",
          Severity: "warning",
          Match: "Utilize",
          Line: 3,
        },
        {
          Span: [18, 33],
          Check: "Unslop.ContrastFormula",
          Message: "State the point directly",
          Severity: "error",
          Match: "not merely",
          Line: 3,
        },
      ],
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.suggestions[0]).toMatchObject({
      span: { sourceText: "Utilize" },
      replacement: "Use",
      confidence: 1,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.producer.provenance).toEqual({
      kind: "rule",
      ruleId: "Unslop.ContrastFormula",
    });

    const improved = source.replace("Utilize", "Use");
    expect(valeAlertsToReviewRecords({
      source: improved,
      documentId: "draft.md",
      revision: "worktree:test-2",
      producerVersion: "vale@3.13.0",
      alerts: [],
    }).proposals).toEqual([]);
  });

  it("fails closed when a safe-rule span is embedded in a larger word", () => {
    expect(() => valeAlertsToReviewRecords({
      source: "commenced\n",
      documentId: "draft.md",
      revision: "worktree:test",
      producerVersion: "vale@3.13.0",
      alerts: [{
        Span: [1, 8],
        Check: "Unslop.PlainWordsSafe",
        Message: "Use the plain replacement",
        Severity: "warning",
        Match: "commence",
        Line: 1,
      }],
    })).toThrow(/inside a larger word/);
  });

  it("writes producer output and a decision before changing the addressed source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "writing-editor-source-review-"));
    try {
      const sourcePath = join(directory, "draft.md");
      const recordsPath = join(directory, "evidence", "records.json");
      const decisionsPath = join(directory, "evidence", "decisions.jsonl");
      const receiptPath = join(directory, "evidence", "receipt.json");
      const valePath = join(directory, "fake-vale");
      await writeFile(sourcePath, "# Draft\n\nUtilize direct words.\n", "utf8");
      const alerts = [{
        Span: [1, 7],
        Check: "Unslop.PlainWordsSafe",
        Message: "Use the plain replacement",
        Severity: "warning",
        Match: "Utilize",
        Line: 3,
      }];
      await writeFile(valePath, [
        "#!/usr/bin/env node",
        "if (process.argv.includes('--version')) { console.log('vale version 3.13.0'); }",
        `else { process.stdout.write(JSON.stringify({ [process.argv.at(-1)]: ${JSON.stringify(alerts)} })); }`,
        "",
      ].join("\n"), "utf8");
      await chmod(valePath, 0o755);

      const commandOutput = new PassThrough();
      let displayed = "";
      commandOutput.on("data", (chunk) => displayed += chunk.toString());
      await reviewCommand([
        "--source", sourcePath,
        "--revision", "worktree:test",
        "--records", recordsPath,
        "--decisions", decisionsPath,
        "--receipt", receiptPath,
        "--vale", valePath,
      ], { input: scriptedInput("a"), output: commandOutput });

      expect(JSON.parse(await readFile(recordsPath, "utf8")).proposals).toHaveLength(1);
      const decision = DecisionSchema.parse(
        JSON.parse((await readFile(decisionsPath, "utf8")).trim()),
      );
      expect(decision.outcome).toBe("accepted");
      expect(ReviewReceiptSchema.parse(
        JSON.parse(await readFile(receiptPath, "utf8")),
      )).toMatchObject({
        sourceChanged: true,
        summary: { findings: 0, proposals: 1, accepted: 1 },
      });
      expect(await readFile(sourcePath, "utf8")).toBe("# Draft\n\nUse direct words.\n");
      expect(displayed).toContain("-Utilize direct words.");
      expect(displayed).toContain("+Use direct words.");

      const committedRecords = await readFile(recordsPath, "utf8");
      await writeFile(valePath, [
        "#!/usr/bin/env node",
        "if (process.argv.includes('--version')) { console.log('vale version 3.13.0'); }",
        "else { process.stdout.write(JSON.stringify({ [process.argv.at(-1)]: [] })); }",
        "",
      ].join("\n"), "utf8");
      await expect(reviewCommand([
        "--source", sourcePath,
        "--revision", "worktree:test",
        "--records", recordsPath,
        "--decisions", decisionsPath,
        "--receipt", receiptPath,
        "--vale", valePath,
      ], { input: scriptedInput("q"), output: new PassThrough() })).rejects.toThrow(
        /does not match a current proposal/,
      );
      expect(await readFile(recordsPath, "utf8")).toBe(committedRecords);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs Vale against the exact source snapshot instead of the live file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "writing-editor-vale-snapshot-"));
    try {
      const sourcePath = join(directory, "draft.md");
      const scannedPathFile = join(directory, "scanned-path.txt");
      const valePath = join(directory, "fake-vale");
      const source = "Utilize direct words.\n";
      await writeFile(sourcePath, source, "utf8");
      await writeFile(valePath, [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "if (process.argv.includes('--version')) { console.log('vale version 3.13.0'); }",
        "else {",
        "  const scannedPath = process.argv.at(-1);",
        `  fs.writeFileSync(${JSON.stringify(scannedPathFile)}, scannedPath);`,
        `  fs.writeFileSync(${JSON.stringify(sourcePath)}, 'Changed during Vale.\\n');`,
        "  const scanned = fs.readFileSync(scannedPath, 'utf8');",
        "  if (scanned !== 'Utilize direct words.\\n') process.exit(2);",
        "  process.stdout.write(JSON.stringify({ [scannedPath]: [{",
        "    Span: [1, 7], Check: 'Unslop.PlainWordsSafe',",
        "    Message: 'Use the plain replacement', Severity: 'warning',",
        "    Match: 'Utilize', Line: 1",
        "  }] }));",
        "}",
        "",
      ].join("\n"), "utf8");
      await chmod(valePath, 0o755);

      const result = runValeDeterministicProducer({
        source,
        sourcePath,
        documentId: "draft.md",
        revision: "worktree:test",
        configPath: resolve(import.meta.dirname, "../../../.vale.ini"),
        valeBinary: valePath,
      });

      expect(result.proposals[0]?.suggestions[0]?.span.sourceText).toBe("Utilize");
      expect(await readFile(sourcePath, "utf8")).toBe("Changed during Vale.\n");
      const scannedPath = await readFile(scannedPathFile, "utf8");
      expect(scannedPath).not.toBe(sourcePath);
      await expect(readFile(scannedPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when a new Unslop rule lacks a safety classification", () => {
    expect(() => valeAlertsToReviewRecords({
      source: "Example.\n",
      documentId: "draft.md",
      revision: "worktree:test",
      producerVersion: "vale@3.13.0",
      alerts: [{
        Span: [1, 7],
        Check: "Unslop.Unclassified",
        Message: "Example",
        Severity: "warning",
        Match: "Example",
        Line: 1,
      }],
    })).toThrow(/no rewrite safety classification/);
  });
});
