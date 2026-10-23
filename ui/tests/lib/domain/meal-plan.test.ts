import { describe, expect, it } from "vitest";
import { parseMealPlan } from "@/lib/domain/meal-plan";

function committedMeal(id: string, date: string) {
  return {
    id,
    kind: "recipe",
    status: "committed",
    date,
    mealType: "dinner",
    recipeSlug: "risotto",
  };
}

describe("parseMealPlan", () => {
  it("accepts real calendar dates, including leap day", () => {
    expect(parseMealPlan([committedMeal("leap-day", "2028-02-29")])).toEqual([
      committedMeal("leap-day", "2028-02-29"),
    ]);
  });

  it("rejects impossible calendar dates", () => {
    expect(
      parseMealPlan([
        committedMeal("bad-month", "2026-13-01"),
        committedMeal("bad-day", "2026-04-31"),
        committedMeal("bad-leap-day", "2026-02-29"),
      ]),
    ).toEqual([]);
  });
});
