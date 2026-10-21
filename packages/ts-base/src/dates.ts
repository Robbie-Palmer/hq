export const ENGLISH_MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function isoDatePart(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError(`Invalid timestamp ${timestamp}`);
  }
  return parsed.toISOString().slice(0, 10);
}

export const UTC_INSTANT_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;

export function isUtcInstant(value: string): boolean {
  if (!UTC_INSTANT_PATTERN.test(value)) return false;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = (datePart ?? "").split("-").map(Number);
  const [hour, minute, second] = (timePart ?? "")
    .slice(0, 8)
    .split(":")
    .map(Number);
  const parsed = new Date(timestamp);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute &&
    parsed.getUTCSeconds() === second
  );
}

export function compareUtcInstants(left: string, right: string): number {
  const leftParts = parseUtcInstant(left);
  const rightParts = parseUtcInstant(right);
  if (leftParts.seconds !== rightParts.seconds) {
    return leftParts.seconds < rightParts.seconds ? -1 : 1;
  }
  if (leftParts.nanoseconds === rightParts.nanoseconds) return 0;
  return leftParts.nanoseconds < rightParts.nanoseconds ? -1 : 1;
}

export function previousUtcInstant(value: string): string {
  const { seconds, nanoseconds } = parseUtcInstant(value);
  if (nanoseconds > 0) {
    return `${seconds}.${String(nanoseconds - 1).padStart(9, "0")}Z`;
  }
  const previousSecond = new Date(Date.parse(`${seconds}Z`) - 1_000)
    .toISOString()
    .replace(".000Z", "");
  return `${previousSecond}.999999999Z`;
}

function parseUtcInstant(value: string): {
  seconds: string;
  nanoseconds: number;
} {
  const match = UTC_INSTANT_PATTERN.exec(value);
  if (!match || !isUtcInstant(value)) {
    throw new RangeError(`Invalid RFC 3339 UTC instant: '${value}'`);
  }
  return {
    seconds: match[1] ?? "",
    nanoseconds: Number((match[2] ?? "").padEnd(9, "0")),
  };
}
