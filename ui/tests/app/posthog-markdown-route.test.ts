import { describe, expect, it } from "vitest";
import { GET } from "@/app/posthog.md/route";

describe("PostHog application Markdown route", () => {
  it("serves the Markdown twin in the same narrative order", async () => {
    const response = GET();
    const markdown = await response.text();

    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(markdown).toContain("# I want to help products drive themselves");
    expect(markdown).toContain("I love getting together in person");
    expect(
      markdown.indexOf(
        "## I was already building the machine around the coding agent.",
      ),
    ).toBeLessThan(markdown.indexOf("## What the weirdness looks like"));
    expect(markdown.indexOf("## What the weirdness looks like")).toBeLessThan(
      markdown.indexOf(
        "## The subjects vary. The passion for building is consistent.",
      ),
    );
    expect(
      markdown.indexOf(
        "## The subjects vary. The passion for building is consistent.",
      ),
    ).toBeLessThan(markdown.indexOf("### Outside the repository"));
    expect(markdown.indexOf("### Outside the repository")).toBeLessThan(
      markdown.indexOf(
        "## The culture I keep trying to build already exists here",
      ),
    );
    expect(markdown).not.toContain("## The loop");
    expect(markdown).toContain(
      "[pineapple-on-pizza telemetry](https://posthog.com/careers#pizza)",
    );
    expect(markdown).toContain(
      "[even though better commercial products will eventually replace some of them](/blog/2026-08-18-crossing-the-chasm-with-ai-platform-teams)",
    );
    expect(markdown).toContain(
      "![PostHog's muscular cracked-engineer hedgehog labelled PostHog/posthog with 39,817 GitHub stars beside the smaller also-cracked hedgehog labelled Robbie-Palmer/hq with zero stars](/images/posthog/cracked-engineer-repositories.png)",
    );
    expect(markdown).toContain(
      "[Read the AI Research Team's Q3 2026 plan](https://github.com/PostHog/posthog.com/blob/master/contents/teams/ai-research/objectives.mdx#q3-2026-objectives)",
    );
    expect(markdown).toContain("- Train the end-to-end agent");
    expect(markdown).toContain("### 01 · Persistent K3s workspaces");
    expect(markdown).toContain("- Data labelling suite");
    expect(markdown).not.toContain("—");
    expect(markdown).not.toContain("–");
    expect(markdown).toContain("I do not have a PhD");
  });
});
