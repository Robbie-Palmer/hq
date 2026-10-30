import { createHash } from "node:crypto";
import type { LayoutItem, LayoutText, ResumeLayout } from "./model";
import { estimateTextWidth } from "./layout";

const FONT_REGULAR_OBJECT = 3;
const FONT_BOLD_OBJECT = 4;
const INFO_OBJECT = 5;
const BACKSLASH = String.fromCharCode(92);
const ESCAPED_BACKSLASH = String.raw`\\`;
const ESCAPED_OPEN_PARENTHESIS = String.raw`\(`;
const ESCAPED_CLOSE_PARENTHESIS = String.raw`\)`;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function pdfString(value: string): string {
  return value
    .replaceAll(BACKSLASH, ESCAPED_BACKSLASH)
    .replaceAll("(", ESCAPED_OPEN_PARENTHESIS)
    .replaceAll(")", ESCAPED_CLOSE_PARENTHESIS)
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

function pdfText(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replaceAll(/[\u2013\u2014]/g, "-")
    .replaceAll(/[\u2018\u2019]/g, "'")
    .replaceAll(/[\u201c\u201d]/g, '"')
    .replaceAll(/[^\x20-\x7e]/g, "?");
  return Buffer.from(normalized, "ascii").toString("hex").toUpperCase();
}

function rgb(hex: string): string {
  const value = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`Invalid PDF color '${hex}'`);
  }
  return [0, 2, 4]
    .map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel.toFixed(4))
    .join(" ");
}

function number(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function renderItem(item: LayoutItem, pageHeight: number): string {
  if (item.kind === "text") {
    const font = item.font === "bold" ? "/F2" : "/F1";
    return `BT ${rgb(item.color)} rg ${font} ${number(item.size)} Tf 1 0 0 1 ${number(item.x)} ${number(pageHeight - item.y)} Tm <${pdfText(item.text)}> Tj ET`;
  }
  if (item.kind === "rule") {
    const y = pageHeight - item.y;
    return `${rgb(item.color)} RG ${number(item.thickness)} w ${number(item.x)} ${number(y)} m ${number(item.x + item.width)} ${number(y)} l S`;
  }
  return `${rgb(item.color)} rg ${number(item.x)} ${number(pageHeight - item.y - item.height)} ${number(item.width)} ${number(item.height)} re f`;
}

function annotation(
  item: LayoutText,
  pageHeight: number,
): string | undefined {
  if (!item.link) return undefined;
  const width = estimateTextWidth(item.text, item.size);
  const bottom = pageHeight - item.y - item.size * 0.25;
  const top = pageHeight - item.y + item.size;
  return `<< /Type /Annot /Subtype /Link /Rect [${number(item.x)} ${number(bottom)} ${number(item.x + width)} ${number(top)}] /Border [0 0 0] /A << /S /URI /URI (${pdfString(item.link)}) >> >>`;
}

export function createPdf(layout: ResumeLayout, sourceDigest: string): Buffer {
  const objects: string[] = ["", "", "", "", ""];
  const addObject = (content: string): number => {
    objects.push(content);
    return objects.length;
  };
  objects[2] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[4] =
    `<< /Title (Robbie Palmer - Resume) /Author (Robbie Palmer) /Subject (Generated from canonical site content ${sourceDigest}) /Creator (scripts/pdf-resume) /Producer (hq deterministic PDF writer) >>`;

  const pageObjects: number[] = [];
  for (let page = 1; page <= layout.pageCount; page += 1) {
    const items = layout.items.filter((item) => item.page === page);
    const stream = `${items.map((item) => renderItem(item, layout.pageHeight)).join("\n")}\n`;
    const contentObject = addObject(
      `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
    );
    const annotationObjects = items
      .filter((item): item is LayoutText => item.kind === "text")
      .map((item) => annotation(item, layout.pageHeight))
      .filter((value): value is string => Boolean(value))
      .map(addObject);
    const annotationReferences = annotationObjects
      .map((id) => `${id} 0 R`)
      .join(" ");
    const annotations = annotationReferences
      ? ` /Annots [${annotationReferences}]`
      : "";
    pageObjects.push(
      addObject(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(layout.pageWidth)} ${number(layout.pageHeight)}] /Resources << /Font << /F1 ${FONT_REGULAR_OBJECT} 0 R /F2 ${FONT_BOLD_OBJECT} 0 R >> >> /Contents ${contentObject} 0 R${annotations} >>`,
      ),
    );
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  const pageReferences = pageObjects.map((id) => `${id} 0 R`).join(" ");
  objects[1] =
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageObjects.length} >>`;

  const header = "%PDF-1.7\n%\0\xE2\xE3\xCF\xD3\n";
  let body = header;
  const offsets = [0];
  objects.forEach((content, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  body += offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  const documentId = sha256(`${sourceDigest}\n${body}`).slice(0, 32);
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${INFO_OBJECT} 0 R /ID [<${documentId}><${documentId}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

export function extractPdfText(pdf: Uint8Array): string {
  const source = Buffer.from(pdf).toString("ascii");
  return [...source.matchAll(/<([0-9A-F]+)> Tj/g)]
    .map((match) => Buffer.from(match[1] ?? "", "hex").toString("ascii"))
    .join("\n");
}

export function extractPdfLinks(pdf: Uint8Array): string[] {
  const source = Buffer.from(pdf).toString("ascii");
  return [...source.matchAll(/\/URI \(([^)]*(?:\\\)[^)]*)*)\)/g)].map(
    (match) =>
      (match[1] ?? "")
        .replaceAll(ESCAPED_CLOSE_PARENTHESIS, ")")
        .replaceAll(ESCAPED_OPEN_PARENTHESIS, "(")
        .replaceAll(ESCAPED_BACKSLASH, BACKSLASH),
  );
}

export function countPdfPages(pdf: Uint8Array): number {
  return Buffer.from(pdf).toString("ascii").match(/\/Type \/Page\b/g)?.length ?? 0;
}
