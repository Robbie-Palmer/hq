import type { Metadata } from "next";
import { RecipePlanning } from "@/components/recipes/planning/recipe-planning";

export const metadata: Metadata = {
  title: "Meal Plan",
  description: "Plan one meal, save ideas, or review the household week.",
  robots: { index: false, follow: false },
};

export default function PlanningPage() {
  return <RecipePlanning />;
}
