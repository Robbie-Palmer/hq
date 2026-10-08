import { experiences } from "@/content/experience";
import type { JobRoleContent } from "@/lib/domain/role/jobRole";
import { normalizeSlug } from "@/lib/generic/slugs";

export type Experience = JobRoleContent;

export function getExperienceSlug(experience: Experience): string {
  return normalizeSlug(experience.company);
}

const EXPERIENCE_DATE_PATTERN = /^(\d{4})-(\d{2})$/;

function parseDateString(dateStr: string): Date {
  const match = EXPERIENCE_DATE_PATTERN.exec(dateStr);
  if (!match) {
    throw new Error(
      `Invalid date format: ${dateStr}. Expected YYYY-MM format.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error(
      `Invalid date format: ${dateStr}. Month must be between 01 and 12.`,
    );
  }
  return new Date(Date.UTC(year, month - 1, 1));
}

export function formatExperienceDateRange(
  startDate: string,
  endDate?: string,
): string {
  const start = parseDateString(startDate);
  const end = endDate ? parseDateString(endDate) : new Date();
  const startFormatted = start.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const endFormatted = endDate
    ? end.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "Present";
  return `${startFormatted} - ${endFormatted}`;
}

export function getExperienceDuration(
  startDate: string,
  endDate?: string,
): string {
  const start = parseDateString(startDate);
  const end = endDate ? parseDateString(endDate) : new Date();
  return formatDuration(start, end);
}

export function formatExperienceDateLabel(
  startDate: string,
  endDate?: string,
): string {
  const range = formatExperienceDateRange(startDate, endDate);
  const duration = getExperienceDuration(startDate, endDate);
  return `${range} (${duration})`;
}

function formatDuration(start: Date, end: Date): string {
  // Add 1 to make the calculation inclusive of both start and end months.
  // Read UTC parts: parseDateString returns UTC midnight on the 1st, which is
  // the previous month in timezones west of UTC, so local parts would make
  // open-ended durations differ from the server-rendered HTML.
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (years === 0) {
    return `${remainingMonths} ${remainingMonths === 1 ? "month" : "months"}`;
  }
  if (remainingMonths === 0) {
    return `${years} ${years === 1 ? "year" : "years"}`;
  }
  return `${years} ${years === 1 ? "year" : "years"}, ${remainingMonths} ${remainingMonths === 1 ? "month" : "months"}`;
}

export type TitleWithDateRange = {
  title: string;
  dateRange: string;
  isCurrent: boolean;
};

export function getTitleTimeline(
  experience: Experience,
): TitleWithDateRange[] | undefined {
  const { previousTitles } = experience;
  if (!previousTitles || previousTitles.length === 0) return undefined;

  // Sort by endDate descending so most-recent previous title is first
  const sorted = [...previousTitles].sort((a, b) =>
    b.endDate.localeCompare(a.endDate),
  );

  const currentTitleStart = sorted[0]!.endDate;
  return [
    {
      title: experience.title,
      dateRange: formatExperienceDateRange(
        currentTitleStart,
        experience.endDate,
      ),
      isCurrent: !experience.endDate,
    },
    ...sorted.map((prev) => ({
      title: prev.title,
      dateRange: formatExperienceDateRange(prev.startDate, prev.endDate),
      isCurrent: false,
    })),
  ];
}

export function getAllExperience(): Experience[] {
  return experiences;
}
