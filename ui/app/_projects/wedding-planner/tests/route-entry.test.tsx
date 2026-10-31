import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  pathname: "/wedding-planner/readiness",
  push: vi.fn(),
  redirect: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams("guest=casey"),
}));
vi.mock(
  "@/app/_projects/wedding-planner/components/accommodation-editor",
  () => ({
    AccommodationEditor: ({
      onGuestChange,
      onNavigate,
      routeView,
      selectedGuestId,
    }: {
      onGuestChange?(guestId: string | null): void;
      onNavigate?(view: string, targetId?: string): void;
      routeView: string;
      selectedGuestId?: string | null;
    }) => (
      <section>
        <h1>{routeView}</h1>
        <output>{selectedGuestId ?? "no guest"}</output>
        <button type="button" onClick={() => onNavigate?.("readiness")}>
          Open readiness
        </button>
        <button type="button" onClick={() => onGuestChange?.(null)}>
          Clear guest
        </button>
      </section>
    ),
  }),
);
vi.mock("@/app/_projects/wedding-planner/routes/feature-workflows", () => ({
  ExportsWorkflow: () => <h1>Exports workflow</h1>,
  MusicWorkflow: () => <h1>Music workflow</h1>,
  ReadinessWorkflow: () => <h1>Readiness workflow</h1>,
  SeatingWorkflow: () => <h1>Seating workflow</h1>,
}));

import { WeddingPlannerLayout as ProjectLayout } from "@/app/_projects/wedding-planner/routes/layout";
import WeddingAccommodationStepPage, {
  generateStaticParams,
} from "@/app/wedding-planner/accommodation/[step]/page";
import WeddingAccommodationPage from "@/app/wedding-planner/accommodation/page";
import WeddingPlannerRouteError from "@/app/wedding-planner/error";
import WeddingExportsPage from "@/app/wedding-planner/exports/page";
import WeddingGuestsPage from "@/app/wedding-planner/guests/page";
import WeddingPlannerLoading from "@/app/wedding-planner/loading";
import WeddingMusicPage from "@/app/wedding-planner/music/page";
import WeddingPlannerPage from "@/app/wedding-planner/page";
import WeddingReadinessPage from "@/app/wedding-planner/readiness/page";
import WeddingSeatingPage from "@/app/wedding-planner/seating/page";

describe("Wedding Planner route entries", () => {
  beforeEach(() => {
    mocks.pathname = "/wedding-planner/readiness";
    vi.clearAllMocks();
  });

  it("redirects the planner root and renders the shared route shell", () => {
    WeddingPlannerPage();
    expect(mocks.redirect).toHaveBeenCalledWith("/wedding-planner/readiness");

    render(
      <ProjectLayout>
        <main id="wedding-planner-content">Route content</main>
      </ProjectLayout>,
    );
    expect(screen.getByText("Route content")).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "Readiness", current: "page" }),
    ).toHaveLength(2);
  });

  it("renders loading and error boundaries", () => {
    const { rerender } = render(<WeddingPlannerLoading />);
    expect(screen.getByLabelText("Loading saved wedding plan")).toBeVisible();
    rerender(
      <WeddingPlannerRouteError
        error={new Error("Storage unavailable")}
        reset={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Storage unavailable");
  });

  it("connects retained feature pages to their workflows", () => {
    const { rerender } = render(<WeddingReadinessPage />);
    expect(screen.getByText("Readiness workflow")).toBeVisible();
    const pages = [
      <WeddingSeatingPage key="seating" />,
      <WeddingMusicPage key="music" />,
      <WeddingExportsPage key="exports" />,
    ];
    for (const page of pages) rerender(page);
    expect(screen.getByText("Exports workflow")).toBeVisible();
  });

  it("keeps guest selection and workflow navigation in the URL", () => {
    const { rerender } = render(<WeddingGuestsPage />);
    expect(screen.getByText("casey")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open readiness" }));
    expect(mocks.push).toHaveBeenCalledWith("/wedding-planner/readiness");
    fireEvent.click(screen.getByRole("button", { name: "Clear guest" }));
    expect(mocks.replace).toHaveBeenCalledWith("/wedding-planner/guests");

    rerender(<WeddingAccommodationPage />);
    fireEvent.click(screen.getByRole("button", { name: "Clear guest" }));
    expect(mocks.replace).toHaveBeenCalledOnce();
  });

  it("publishes and validates every static accommodation step", async () => {
    expect(generateStaticParams()).toEqual([
      { step: "sharing" },
      { step: "inventory" },
      { step: "rooms" },
      { step: "result" },
    ]);
    const page = await WeddingAccommodationStepPage({
      params: Promise.resolve({ step: "result" }),
    });
    render(page);
    expect(screen.getByRole("heading", { name: "result" })).toBeVisible();

    await expect(
      WeddingAccommodationStepPage({
        params: Promise.resolve({ step: "missing" }),
      }),
    ).rejects.toThrow("not found");
  });
});
