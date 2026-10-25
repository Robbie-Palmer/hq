import { Lightbulb } from "lucide-react";
import type { Metadata } from "next";
import { IdeaList } from "@/components/ideas/idea-list";
import { getAllIdeas } from "@/lib/api/ideas";

export const metadata: Metadata = {
  title: "Ideas",
  description:
    "Laws, methods, and mental models that recur across my projects, decisions, and writing.",
  alternates: { canonical: "/ideas" },
};

export default function IdeasPage() {
  const ideas = getAllIdeas();

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12">
      <header className="mb-10 max-w-3xl space-y-4">
        <div className="flex items-center gap-3">
          <Lightbulb className="size-8 text-cyan-500" />
          <h1 className="text-4xl font-bold md:text-5xl">Ideas</h1>
        </div>
        <p className="text-xl leading-relaxed text-muted-foreground">
          Laws, methods, and mental models that recur across my projects,
          decisions, and writing. These pages are the stable definitions; the
          backlinks show where I have put each idea to work.
        </p>
      </header>

      <IdeaList ideas={ideas} />
    </div>
  );
}
