import type { Metadata } from "next";
import "@/app/_projects/wedding-planner/components/style.css";

export const metadata: Metadata = {
  title: "Wedding planner",
  description:
    "Private, browser-based wedding planner for accommodation and table seating",
  robots: { index: false, follow: false },
};

export default function WeddingPlannerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
