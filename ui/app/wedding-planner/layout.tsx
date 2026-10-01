import type { Metadata } from "next";
import "@/components/wedding-planner/style.css";

export const metadata: Metadata = {
  title: "Wedding planner",
  description:
    "Private, browser-based wedding planner, starting with accommodation",
  robots: { index: false, follow: false },
};

export default function WeddingPlannerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
