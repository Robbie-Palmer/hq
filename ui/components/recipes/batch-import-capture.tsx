"use client";

import { useRef, useState } from "react";
import {
  type ArchiveSourceSchema,
  type BatchSource,
  CreateBatchSchema,
} from "recipe-domain/batch-import";
import type { RecipeVisibility } from "recipe-domain/visibility";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/http";
import {
  batchErrorMessage,
  type ImportBatch,
  recipeImportBatchesPath,
} from "@/lib/api/recipe-import-batches";

type CaptureSource = BatchSource | z.infer<typeof ArchiveSourceSchema>;
async function readRecipeFile(file: File): Promise<CaptureSource> {
  if (/\.zip$/i.test(file.name)) {
    if (file.size > 1_000_000) throw new Error(`${file.name} exceeds 1 MB`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const value of bytes) binary += String.fromCharCode(value);
    return { type: "archive", filename: file.name, content: btoa(binary) };
  }
  if (file.size > 100000) throw new Error(`${file.name} exceeds 100 KB`);
  return { type: "file", filename: file.name, content: await file.text() };
}
function mixedSources(urls: string, files: CaptureSource[]): CaptureSource[] {
  return [
    ...urls
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => ({ type: "url" as const, url })),
    ...files,
  ];
}

export function BatchImportCapture({
  hasBatch,
  onStart,
}: Readonly<{
  hasBatch: boolean;
  onStart: (batchId: string) => Promise<void>;
}>) {
  const [urls, setUrls] = useState("");
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [visibility, setVisibility] = useState<RecipeVisibility>("private");
  const [duplicatePolicy, setDuplicatePolicy] = useState<"skip" | "allow">(
    "skip",
  );
  const [prepared, setPrepared] = useState<ImportBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submission = useRef<{ key: string; input: string } | null>(null);
  const checks = prepared?.items.map((item, position) => ({
    position,
    label: item.sourceLabel,
    error: item.errorMessage,
  }));
  function clearPreparation() {
    setPrepared(null);
  }
  async function addFiles(files: File[]) {
    clearPreparation();
    setBusy(true);
    setError(null);
    try {
      const values = await Promise.all(files.map(readRecipeFile));
      setSources((current) => [...current, ...values]);
    } catch (cause) {
      setError(batchErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function createPreparation() {
    const mixed = mixedSources(urls, sources);
    const input = JSON.stringify([mixed, visibility, duplicatePolicy]);
    if (submission.current?.input !== input)
      submission.current = { key: crypto.randomUUID(), input };
    const body = CreateBatchSchema.parse({
      idempotencyKey: submission.current.key,
      sources: mixed,
      visibility,
      duplicatePolicy,
    });
    const value = await apiRequest<ImportBatch>(recipeImportBatchesPath, {
      method: "POST",
      json: body,
    });
    setPrepared(value);
  }
  async function prepare(start: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (start && prepared) await onStart(prepared.id);
      else await createPreparation();
    } catch (cause) {
      setError(batchErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      {error && (
        <p role="alert" className="my-3 text-destructive">
          {error}
        </p>
      )}
      <details
        open={!hasBatch}
        className="my-4 rounded-lg border border-[var(--line)] p-4"
      >
        <summary className="cursor-pointer">New batch</summary>
        <p className="my-2 text-sm text-[var(--ink-3)]">
          Import URLs, recipe files, or a ZIP of Cooklang files. Up to 50
          recipes. ZIP limits: 1 MB compressed, 5 MB expanded, 100 entries, and
          100 KB per recipe. Review each draft before saving.
        </p>
        <label className="grid gap-2">
          <span>Recipe URLs, one per line</span>
          <textarea
            className="min-h-32 rounded-md border border-[var(--line)] bg-[var(--card)] p-2"
            value={urls}
            onChange={(event) => {
              setUrls(event.target.value);
              clearPreparation();
            }}
            disabled={busy}
          />
        </label>
        <label htmlFor="batch-recipe-files" className="my-3 grid gap-2">
          Cooklang, schema.org files, or Cooklang collection ZIP
          <Input
            id="batch-recipe-files"
            type="file"
            multiple
            accept=".cook,.cooklang,.json,.jsonld,.zip"
            disabled={busy}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void addFiles(files);
            }}
          />
        </label>
        {sources.map((source, index) => (
          <p
            key={`${source.type === "url" ? source.url : source.filename}-${index}`}
            className="text-sm"
          >
            {source.type === "url" ? source.url : source.filename}{" "}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setSources((values) => values.filter((_, i) => i !== index));
                clearPreparation();
              }}
            >
              Remove
            </Button>
          </p>
        ))}
        <label className="my-3 grid gap-2">
          <span>Default visibility</span>
          <select
            value={visibility}
            onChange={(event) => {
              setVisibility(event.target.value as RecipeVisibility);
              clearPreparation();
            }}
            className="rounded-md border border-[var(--line)] p-2"
          >
            <option value="private">Private</option>
            <option value="household">Household</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label className="my-3 grid gap-2">
          <span>Duplicate archive recipes</span>
          <select
            value={duplicatePolicy}
            disabled={busy}
            onChange={(event) => {
              setDuplicatePolicy(event.target.value as "skip" | "allow");
              clearPreparation();
            }}
            className="rounded-md border border-[var(--line)] p-2"
          >
            <option value="skip">
              Skip identical recipes from this or previous imports
            </option>
            <option value="allow">Create separate copies after review</option>
          </select>
        </label>
        <Button disabled={busy} onClick={() => void prepare(false)}>
          Check sources
        </Button>
        {checks && (
          <div className="my-3">
            <ul>
              {checks.map((check) => (
                <li key={check.position} className="text-sm">
                  {check.label}: {check.error ?? "Ready to import"}
                </li>
              ))}
            </ul>
            <Button disabled={busy} onClick={() => void prepare(true)}>
              Start batch
            </Button>
          </div>
        )}
      </details>
    </section>
  );
}
