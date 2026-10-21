import type { Metadata } from "next";
import { AssetTrackerLayout as PersonalFinanceLayout } from "@/features/personal-finance-app/routes/layout";

export const metadata: Metadata = {
  title: {
    default: "Asset Tracker",
    template: "%s | Asset Tracker",
  },
  description: "Track and manage your assets",
};

export default function AssetTrackerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <PersonalFinanceLayout>{children}</PersonalFinanceLayout>;
}
