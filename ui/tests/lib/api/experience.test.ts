import { describe, expect, it } from "vitest";
import {
  formatExperienceDateRange,
  getAllExperience,
  getExperienceDuration,
} from "@/lib/api/experience";

describe("getAllExperience", () => {
  it("shows the Terminal Industries role transition", () => {
    const terminalIndustries = getAllExperience().find(
      ({ company }) => company === "Terminal Industries",
    );

    expect(terminalIndustries).toMatchObject({
      title: "Principal Software Engineer & Engineering Manager",
      startDate: "2024-05",
      previousTitles: [
        {
          title: "Principal Software Engineer",
          startDate: "2024-05",
          endDate: "2026-03",
        },
      ],
    });
    expect(terminalIndustries?.endDate).toBeUndefined();
  });
});

describe("formatExperienceDateRange", () => {
  it("formats a closed range", () => {
    expect(formatExperienceDateRange("2020-03", "2021-11")).toBe(
      "Mar 2020 - Nov 2021",
    );
  });

  it("formats an open range as Present", () => {
    expect(formatExperienceDateRange("2020-03")).toBe("Mar 2020 - Present");
  });

  it("rejects dates without a month", () => {
    expect(() => formatExperienceDateRange("2020")).toThrow(
      "Expected YYYY-MM format",
    );
  });

  it("rejects non-numeric dates", () => {
    expect(() => formatExperienceDateRange("20xx-ab")).toThrow(
      "Expected YYYY-MM format",
    );
  });

  it("rejects unpadded months", () => {
    expect(() => formatExperienceDateRange("2020-3")).toThrow(
      "Expected YYYY-MM format",
    );
  });

  it("rejects out-of-range months instead of rolling the year", () => {
    expect(() => formatExperienceDateRange("2020-13")).toThrow(
      "Month must be between 01 and 12",
    );
    expect(() => formatExperienceDateRange("2020-00")).toThrow(
      "Month must be between 01 and 12",
    );
  });
});

describe("getExperienceDuration", () => {
  it("counts inclusive months", () => {
    expect(getExperienceDuration("2020-01", "2020-03")).toBe("3 months");
  });

  it("formats years with remaining months", () => {
    expect(getExperienceDuration("2020-01", "2021-03")).toBe(
      "1 year, 3 months",
    );
  });
});
