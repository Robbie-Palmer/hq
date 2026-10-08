import {
  posthogApplication,
  posthogApplicationMarkdown,
} from "@/content/posthog";
import { renderPage } from "@/lib/content/agent-markdown";

export const dynamic = "force-static";

export function GET() {
  const markdown = renderPage(
    {
      title: posthogApplication.title,
      htmlPath: "/posthog",
      description: posthogApplication.description,
      facts: [["Location", "Belfast, UK"]],
    },
    posthogApplicationMarkdown(),
  );

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
