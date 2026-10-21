import type { Metadata } from "next";
import { AssetTrackerImports } from "@/features/personal-finance-app/routes/imports";

export const metadata: Metadata = { title: "Imports" };

export default function AssetTrackerImportsPage() {
  return <AssetTrackerImports />;
}
