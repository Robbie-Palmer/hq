"use client";

import { useRef, useState } from "react";
import {
  type BatchSource,
  CreateBatchSchema,
} from "recipe-domain/batch-import";
import type { RecipeVisibility } from "recipe-domain/visibility";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/http";
import {
  batchErrorMessage,
  type ImportBatch,
  recipeImportBatchesPath,
} from "@/lib/api/recipe-import-batches";

async function readRecipeFile(file: File): Promise<BatchSource> {
  if (file.size > 100000) throw new Error(`${file.name} exceeds 100 KB`);
  return { type: "file", filename: file.name, content: await file.text() };
}
function mixedSources(urls: string, files: BatchSource[]): BatchSource[] {
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
  const [sources, setSources] = useState<BatchSource[]>([]);
  const [visibility, setVisibility] = useState<RecipeVisibility>("private");
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
    const input = JSON.stringify([mixed, visibility]);
    if (submission.current?.input !== input)
      submission.current = { key: crypto.randomUUID(), input };
    const body = CreateBatchSchema.parse({
      idempotencyKey: submission.current.key,
      sources: mixed,
      visibility,
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
          One URL or file per recipe. Up to 50 sources. Review each draft before
          saving.
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
          Cooklang or schema.org files
          <Input
            id="batch-recipe-files"
            type="file"
            multiple
            accept=".cook,.cooklang,.json,.jsonld"
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
            key={`${source.type === "file" ? source.filename : source.url}-${index}`}
            className="text-sm"
          >
            {source.type === "file" ? source.filename : source.url}{" "}
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
