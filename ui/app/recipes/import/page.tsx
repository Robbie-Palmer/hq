import type { Metadata } from "next";
import { BatchRecipeImport } from "@/components/recipes/batch-recipe-import";

export const metadata: Metadata = {
  title: "Import recipes",
  robots: { index: false, follow: false },
};
export default function ImportRecipesPage() {
  return <BatchRecipeImport />;
}
