import type { Metadata } from "next";
import { ImportsRoute } from "@/components/assettracker/imports-route";

export const metadata: Metadata = { title: "Imports" };

export default function AssetTrackerImportsPage() {
  return <ImportsRoute />;
}
