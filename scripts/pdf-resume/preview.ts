import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildResumeLayout } from "./layout";
import type { LayoutItem, ResumeLayout } from "./model";
import { loadResumeSource } from "./source";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderItem(item: LayoutItem): string {
  if (item.kind === "rectangle") {
    return `<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" fill="${item.color}"/>`;
  }
  if (item.kind === "rule") {
    return `<line x1="${item.x}" y1="${item.y}" x2="${item.x + item.width}" y2="${item.y}" stroke="${item.color}" stroke-width="${item.thickness}"/>`;
  }
  const text = `<text x="${item.x}" y="${item.y}" fill="${item.color}" font-family="Arial, Helvetica, sans-serif" font-size="${item.size}" font-weight="${item.font === "bold" ? "700" : "400"}">${escapeXml(item.text)}</text>`;
  return item.link
    ? `<a href="${escapeXml(item.link)}">${text}</a>`
    : text;
}

export function renderLayoutPage(layout: ResumeLayout, page: number): string {
  const content = layout.items
    .filter((item) => item.page === page)
    .map(renderItem)
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.pageWidth}" height="${layout.pageHeight}" viewBox="0 0 ${layout.pageWidth} ${layout.pageHeight}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${content}
</svg>
`;
}

export async function renderResumePreview(
  repositoryRoot: string,
  outputDirectory: string,
): Promise<string[]> {
  const layout = buildResumeLayout(await loadResumeSource(repositoryRoot));
  await mkdir(outputDirectory, { recursive: true });
  const outputs = Array.from(
    { length: layout.pageCount },
    (_, index) => path.join(outputDirectory, `page-${index + 1}.svg`),
  );
  await Promise.all(
    outputs.map((output, index) =>
      writeFile(output, renderLayoutPage(layout, index + 1), "utf8"),
    ),
  );
  return outputs;
}
