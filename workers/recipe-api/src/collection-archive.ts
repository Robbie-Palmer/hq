import { Unzip, UnzipInflate } from "fflate";
import type { z } from "zod";
import type { ArchiveSourceSchema, BatchSource } from "recipe-domain/batch-import";
import { sha256Hex } from "ts-base/crypto";

export type ArchiveEntry = {
  source: BatchSource;
  archiveName: string;
  archiveChecksum: string;
  entryPath: string;
  contentChecksum: string;
  error?: string;
};

function appendText(entry: { content: string; error?: string }, decoder: TextDecoder, data: Uint8Array, final: boolean, size: number) {
  if (size > 100_000) {
    entry.error = "Archive recipe exceeds 100 KB";
    entry.content = "";
    return;
  }
  if (entry.error) return;
  try { entry.content += decoder.decode(data, { stream: !final }); }
  catch { entry.error = "Archive recipe is not UTF-8 text"; entry.content = ""; }
}

// Only recipe text is retained, using the existing import-source retention policy.
export async function expandCooklangArchive(input: z.infer<typeof ArchiveSourceSchema>): Promise<ArchiveEntry[]> {
  const bytes = Uint8Array.from(atob(input.content), value => value.charCodeAt(0));
  if (bytes.length > 1_000_000) throw new Error("Archive exceeds 1 MB");
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
  const entries: { path: string; content: string; error?: string }[] = [];
  const paths = new Set<string>();
  let expanded = 0;
  let count = 0;
  let completed = 0;
  const unzip = new Unzip(file => {
    if (++count > 100) throw new Error("Archive exceeds 100 entries");
    const path = file.name.normalize("NFC");
    if (path.length > 255 || (path.includes("\\") || path.includes(":") || Array.from(path).some(character => character.charCodeAt(0) < 32)) || path.startsWith("/") || path.split("/").some(part => part === "." || part === "..")) throw new Error("Unsafe archive entry path");
    if (paths.has(path.toLowerCase())) throw new Error("Duplicate archive entry path");
    paths.add(path.toLowerCase());
    if (!/\.(cook|cooklang)$/i.test(path)) return;
    if (entries.length >= 50) throw new Error("Archive exceeds 50 recipes");
    if (file.compression !== 0 && file.compression !== 8) throw new Error("Unsupported ZIP compression");
    const entry = { path, content: "", error: undefined as string | undefined };
    entries.push(entry);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    let size = 0;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length;
      expanded += data.length;
      if (expanded > 5_000_000 || expanded > Math.max(bytes.length, 1) * 100) throw new Error("Archive expansion limit exceeded");
      appendText(entry, decoder, data, final, size);
      if (final) completed++;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Bound the output produced by each synchronous inflate call.
  for (let offset = 0; offset < bytes.length; offset += 256) unzip.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length);
  if (!entries.length) throw new Error("ZIP contains no Cooklang recipes");
  if (completed !== entries.length) throw new Error("ZIP contains incomplete recipe entries");
  return Promise.all(entries.map(async entry => ({
    source: { type: "file" as const, filename: entry.path, content: entry.content || " " },
    archiveName: input.filename,
    archiveChecksum: checksum,
    entryPath: entry.path,
    contentChecksum: await sha256Hex(entry.content),
    error: entry.error,
  })));
}
