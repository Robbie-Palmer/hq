import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PostHogApplicationPage, { metadata } from "@/app/(site)/posthog/page";

vi.mock("@/app/(site)/posthog/posthog.module.css", () => ({
  default: {
    artefactCard: "artefactCard",
    artefactImage: "artefactImage",
    evidenceCard: "evidenceCard",
    heroTeaser: "heroTeaser",
    heroTeaserItem: "heroTeaserItem",
    hoggie: "hoggie",
    page: "page",
    paperPanel: "paperPanel",
    personalityCard: "personalityCard",
    scribble: "scribble",
    terminalPanel: "terminalPanel",
    thread: "thread",
    weirdQuote: "weirdQuote",
  },
}));

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "roundhog-variable" }),
}));

describe("PostHog application page", () => {
  it("addresses PostHog with inspectable evidence", () => {
    render(<PostHogApplicationPage />);

    expect(screen.getByText("Dear")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "I want to help products drive themselves.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /See where I might fit/i }),
    ).toHaveAttribute("href", "#fit");
    expect(
      screen.getByText(/cancer diagnostics, logistics yards/i),
    ).toBeVisible();
    expect(screen.getByText(/Gödel → data mesh/i)).toBeVisible();
    expect(screen.getByText(/Shrek through Marx/i)).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "The work is public. You can inspect it.",
      }),
    ).toBeVisible();
    expect(screen.getByText(/coordinate the work on this page/i)).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "The subjects vary. The passion for building is consistent.",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/What hooks me is finding a new angle/i),
    ).toBeVisible();
    expect(screen.getByText(/DeskHog is a developer toy/i)).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: /PostHog's turquoise DeskHog developer toy/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Outside the repository",
      }),
    ).toBeVisible();
    const workWeirdnessHeading = screen.getByRole("heading", {
      name: "What the weirdness looks like.",
    });
    const throughLineHeading = screen.getByRole("heading", {
      name: "The subjects vary. The passion for building is consistent.",
    });
    const personalWeirdnessHeading = screen.getByRole("heading", {
      name: "Outside the repository",
    });
    const agentPlatformHeading = screen.getByRole("heading", {
      name: /I was already building the machine around the coding agent/i,
    });
    const sectionHeadings = screen.getAllByRole("heading");
    expect(sectionHeadings.indexOf(agentPlatformHeading)).toBeLessThan(
      sectionHeadings.indexOf(workWeirdnessHeading),
    );
    expect(sectionHeadings.indexOf(workWeirdnessHeading)).toBeLessThan(
      sectionHeadings.indexOf(throughLineHeading),
    );
    expect(sectionHeadings.indexOf(throughLineHeading)).toBeLessThan(
      sectionHeadings.indexOf(personalWeirdnessHeading),
    );
    expect(
      screen.queryByRole("heading", {
        name: "Same destination, different starting point.",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /I connected the philosophy of mathematics/i,
      }),
    ).toHaveAttribute(
      "href",
      "/blog/2022-03-02-the-philosophy-of-data-science",
    );
    expect(screen.getByText("I perform jazz dance")).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: /Flying Feet Jazz Dance Collective logo/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /I perform jazz dance/i }),
    ).toHaveAttribute(
      "href",
      "https://linktr.ee/flyingfeetjazzdancecollective",
    );
    expect(
      screen.getByText("I watch Marxist analyses of Shrek for fun."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Watch the Shrek analysis/i }),
    ).toHaveAttribute("href", "https://youtu.be/V9NlA628lRw");
    expect(
      screen.getByRole("link", { name: /Watch the Barbie essay/i }),
    ).toHaveAttribute("href", "https://youtu.be/DqIYPCemZ38");
    expect(
      screen.getByRole("link", { name: /pineapple-on-pizza telemetry/i }),
    ).toHaveAttribute("href", "https://posthog.com/careers#pizza");
    expect(
      screen.getByRole("link", {
        name: /A preview of the weirdness.*See the through-line/i,
      }),
    ).toHaveAttribute("href", "#specific-weirdness");
    expect(
      screen.getByRole("link", { name: /^See the PostHog parallel$/i }),
    ).toHaveAttribute("href", "#agent-platform");
    expect(
      screen.getByRole("link", { name: /^Satellite swarm$/i }),
    ).toHaveAttribute("href", "/projects/autonomic-satellite-swarm");
    expect(
      screen.getByRole("img", {
        name: /whole-slide pathology viewer showing/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: /site's knowledge graph with hundreds/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: /Terminal Industries computer vision identifying a truck/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: /Home lab topology connecting a phone and router/i,
      }),
    ).toBeVisible();
    expect(screen.getByText("01 · Physical topology")).toBeVisible();
    expect(screen.getByText("02 · Inside the Mac mini")).toBeVisible();
    const physicalTab = screen.getByRole("tab", {
      name: "01 · Physical topology",
    });
    const servicesTab = screen.getByRole("tab", {
      name: "02 · Inside the Mac mini",
    });
    const physicalPanel = document.getElementById(
      physicalTab.getAttribute("aria-controls") ?? "",
    );
    const servicesPanel = document.getElementById(
      servicesTab.getAttribute("aria-controls") ?? "",
    );

    expect(physicalPanel).toBeVisible();
    expect(servicesPanel).not.toBeVisible();
    fireEvent.click(servicesTab);
    expect(physicalPanel).not.toBeVisible();
    expect(servicesPanel).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: /Mac mini container topology showing DNS/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: /The home lab that runs my projects/i,
      }),
    ).toHaveAttribute("href", "/projects/homelab");
    expect(
      screen.getByRole("link", { name: /A yard that sees what is moving/i }),
    ).toHaveAttribute(
      "href",
      "/projects/real-time-multi-camera-video-analytics",
    );
    expect(
      screen.getByText(/Public product footage · Terminal Industries/i),
    ).toBeVisible();
    expect(screen.getByText(/Belfast is home/i)).toBeVisible();
    expect(screen.getByText(/cat who would object to the move/i)).toBeVisible();
    expect(
      screen.getByText(/I love getting together in person/i),
    ).toBeVisible();
    expect(screen.getByText(/^Remote role$/i)).toBeVisible();
    expect(screen.getByText(/producing more code than ever/i)).toBeVisible();
    expect(
      screen.queryByText(/I still want to write code/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/I cannot stop building products/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: /Max the PostHog hedgehog holding a heart/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Inspect the Work Graph/i }),
    ).toHaveAttribute("href", "/projects/work-graph");
    expect(
      screen.getByRole("heading", {
        name: /I was already building the machine around the coding agent/i,
      }),
    ).toBeVisible();
    expect(screen.getByText("Codex × 2")).toBeVisible();
    expect(screen.getByText("GLM 5.3 Flash")).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: /See the PostHog Desktop parallel/i,
      }),
    ).toHaveAttribute("href", "https://posthog.com/desktop");
    expect(
      screen.getByRole("link", {
        name: /Inspect the remote development project/i,
      }),
    ).toHaveAttribute("href", "/projects/agent-friendly-remote-development");
    expect(
      screen.getByRole("link", { name: /Agent-first Writing Editor/i }),
    ).toHaveAttribute("href", "/projects/agent-first-writing");
    expect(
      screen.getByRole("heading", {
        name: "The culture I keep trying to build already exists here",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: /I argued against Kubernetes/i,
      }),
    ).toBeVisible();
    expect(screen.getByText(/He proved me wrong/i)).toBeVisible();
    expect(screen.getByText(/lowest morale in the company/i)).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Cracked engineers",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "I build in public" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: /Read PostHog's cracked-engineer essay/i,
      }),
    ).toHaveAttribute(
      "href",
      "https://newsletter.posthog.com/p/hiring-and-managing-cracked-engineers",
    );
    expect(
      screen.getByRole("img", {
        name: /PostHog's muscular cracked-engineer hedgehog/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: /even though better commercial products will eventually replace/i,
      }),
    ).toHaveAttribute(
      "href",
      "/blog/2026-08-18-crossing-the-chasm-with-ai-platform-teams",
    );
    expect(
      screen.getByRole("link", {
        name: /Read the AI Research Team's Q3 2026 plan/i,
      }),
    ).toHaveAttribute(
      "href",
      "https://github.com/PostHog/posthog.com/blob/master/contents/teams/ai-research/objectives.mdx#q3-2026-objectives",
    );
    expect(screen.getByText("Data labelling suite")).toBeVisible();
    expect(screen.getByText("Train the end-to-end agent.")).toBeVisible();
    expect(screen.getByText(/I do not have a PhD/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /View the mobile layout/i }),
    ).toHaveClass("hidden", "lg:inline-flex");
    expect(
      screen.getByRole("button", { name: /View the desktop layout/i }),
    ).toHaveClass("inline-flex", "lg:hidden");
    expect(
      screen.getByRole("link", { name: /Read the agent-friendly Markdown/i }),
    ).toHaveAttribute("href", "/posthog.md");
    expect(
      screen.getByRole("link", { name: /CV and experience/i }),
    ).toHaveAttribute("href", "/experience");
  });

  it("publishes canonical and Markdown alternates", () => {
    expect(metadata.alternates).toEqual({
      canonical: "/posthog",
      types: { "text/markdown": "/posthog.md" },
    });
  });
});
