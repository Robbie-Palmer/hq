import type { Metadata } from "next";
import { RecipeShopping } from "@/components/recipes/shopping/recipe-shopping";

export const metadata: Metadata = {
  title: "Shopping List",
  description:
    "Build a shopping list from your recipes or add individual items.",
  robots: { index: false, follow: false },
};

export default function ShoppingPage() {
  return <RecipeShopping />;
}
