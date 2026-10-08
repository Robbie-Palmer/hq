import { ScrollProgress } from "@/components/ui/scroll-progress";

export default function ProductDecisionLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <ScrollProgress />
      {children}
    </>
  );
}
