// A stateful RFC 4180 scan keeps quoted commas, escaped quotes, and line breaks
// intact. Splitting this state machine makes its transitions harder to audit.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CSV state machine
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  return rows;
}

export type CsvCell = string | number | boolean | null | undefined;

export type StringifyCsvOptions = Readonly<{
  lineEnding?: "\n" | "\r\n";
  trailingLineEnding?: boolean;
  escapeSpreadsheetFormulas?: boolean;
}>;

function stringifyCsvCell(
  value: CsvCell,
  escapeSpreadsheetFormulas: boolean,
): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe =
    escapeSpreadsheetFormulas && /^[=+\-@\t\r]/.test(text)
      ? `'${text}`
      : text;
  return /[",\r\n]/.test(safe)
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
}

export function stringifyCsv(
  rows: readonly (readonly CsvCell[])[],
  options: StringifyCsvOptions = {},
): string {
  const lineEnding = options.lineEnding ?? "\r\n";
  const content = rows
    .map((row) =>
      row
        .map((value) =>
          stringifyCsvCell(value, options.escapeSpreadsheetFormulas ?? false),
        )
        .join(","),
    )
    .join(lineEnding);
  return options.trailingLineEnding && content
    ? `${content}${lineEnding}`
    : content;
}
