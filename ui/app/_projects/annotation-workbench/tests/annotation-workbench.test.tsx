import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationWorkbench } from "../components/annotation-workbench";
import type { ReviewEvent, ReviewSession } from "../domain/review-contract";

const CREATED_AT = "2026-11-10T00:00:00Z";

function reviewSession(): ReviewSession {
  return {
    bundle: {
      schema_version: "1.0.0",
      batch_id: "synthetic-batch",
      created_at: CREATED_AT,
      provenance: {
        producer: "test-adapter",
        producer_version: "1",
        producer_revision: "a".repeat(64),
        dataset_id: "synthetic",
        dataset_revision: "fixture-1",
        derivation: "Synthetic browser fixture",
      },
      assets: [
        {
          id: "source:item-1",
          kind: "source",
          path: "assets/source-1.png",
          media_type: "image/png",
          sha256: "b".repeat(64),
          width: 32,
          height: 32,
        },
        {
          id: "proposal:item-1:model-a",
          kind: "proposal",
          path: "assets/proposal-1.png",
          media_type: "image/png",
          sha256: "c".repeat(64),
          width: 32,
          height: 32,
        },
        {
          id: "reference:item-1",
          kind: "reference",
          path: "assets/reference-1.png",
          media_type: "image/png",
          sha256: "d".repeat(64),
          width: 32,
          height: 32,
        },
        {
          id: "source:item-2",
          kind: "source",
          path: "assets/source-2.png",
          media_type: "image/png",
          sha256: "e".repeat(64),
          width: 32,
          height: 32,
        },
        {
          id: "proposal:item-2:model-b",
          kind: "proposal",
          path: "assets/proposal-2.png",
          media_type: "image/png",
          sha256: "f".repeat(64),
          width: 32,
          height: 32,
        },
      ],
      items: [
        {
          id: "item-1",
          source_asset_id: "source:item-1",
          reference_asset_id: "reference:item-1",
          proposals: [
            {
              id: "item-1:model-a",
              asset_id: "proposal:item-1:model-a",
              role: "primary",
              model_name: "Model A",
              model_revision: "v1",
              model_license: "Apache-2.0",
              source_box_clipped: false,
            },
          ],
          context: {
            dataset_id: "synthetic",
            source_item_id: "image-1",
            source_annotation_id: "annotation-1",
            split: "validation",
            site_id: "site-a",
            class_name: "tumor_anysite",
            bbox_xyxy: [4, 5, 20, 22],
            coordinate_space: "source_pixel_xyxy_inclusive",
          },
        },
        {
          id: "item-2",
          source_asset_id: "source:item-2",
          proposals: [
            {
              id: "item-2:model-b",
              asset_id: "proposal:item-2:model-b",
              role: "alternative",
              model_name: "Model B",
              model_revision: "v2",
              model_license: "Apache-2.0",
              source_box_clipped: true,
            },
          ],
          context: {
            dataset_id: "synthetic",
            source_item_id: "image-2",
            source_annotation_id: "annotation-2",
            split: "train",
            site_id: "site-b",
            class_name: "stromal",
            bbox_xyxy: [2, 3, 18, 19],
            coordinate_space: "source_pixel_xyxy_inclusive",
          },
        },
      ],
    },
    latest_reviews: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installReviewService(session = reviewSession()) {
  const saved: ReviewEvent[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/session")) return jsonResponse(session);
      if (url.endsWith("/api/v1/reviews") && init?.method === "POST") {
        const event = JSON.parse(String(init.body)) as ReviewEvent;
        saved.push(event);
        return jsonResponse(event, 201);
      }
      return jsonResponse({ error: "not found" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, saved };
}

describe("Annotation Workbench browser workflow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("connects, compares proposals, saves both items, and shows the summary", async () => {
    const user = userEvent.setup();
    const { saved } = installReviewService();
    render(<AnnotationWorkbench />);

    const connect = await screen.findByRole("button", {
      name: "Open review batch",
    });
    await user.click(connect);

    expect(
      await screen.findByRole("heading", { name: "Compare boundaries" }),
    ).toBeVisible();
    expect(screen.getByText("Item 1 of 2")).toBeVisible();
    expect(screen.getByText("0 reviewed")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Show reference" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Show reference" }));
    expect(
      screen.getByRole("button", { name: "Hide reference" }),
    ).toBeVisible();
    expect(screen.getByText("Reference")).toBeVisible();

    const proposal = screen.getByRole("button", {
      name: "Choose Model A as the best boundary",
    });
    await user.click(proposal);
    expect(proposal).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Selected as best")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Use as-is" }));
    await user.click(screen.getByText("Add note"));
    await user.type(
      screen.getByRole("textbox", { name: "Review note" }),
      "Looks correct",
    );
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    expect(await screen.findByText("Item 2 of 2")).toBeVisible();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      item_id: "item-1",
      reviewer_kind: "human",
      mask_decision: "accept",
      selected_proposal_id: "item-1:model-a",
      notes: "Looks correct",
    });

    await user.keyboard("2");
    expect(screen.getByRole("button", { name: /^No/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Save and finish" }));

    expect(
      await screen.findByRole("heading", { name: "Review complete" }),
    ).toBeVisible();
    expect(screen.getByText("All 2 of 2 decisions are saved.")).toBeVisible();
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({
      item_id: "item-2",
      object_decision: "non_nucleus",
      mask_decision: "not_applicable",
      selected_proposal_id: null,
    });

    await user.click(
      screen.getByRole("button", { name: "Review all decisions" }),
    );
    expect(screen.getByText("Item 1 of 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("shows connection and save failures without discarding the active item", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "offline" }, 503))
      .mockResolvedValueOnce(jsonResponse(reviewSession()))
      .mockResolvedValueOnce(jsonResponse({ error: "stale review" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    render(<AnnotationWorkbench />);

    await user.click(
      await screen.findByRole("button", { name: "Open review batch" }),
    );
    expect(
      await screen.findByText("Review service returned 503"),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Open review batch" }));
    await screen.findByRole("heading", { name: "Compare boundaries" });
    await user.click(
      screen.getByRole("button", {
        name: "Choose Model A as the best boundary",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Needs correction" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    expect(await screen.findByText("stale review")).toBeVisible();
    expect(screen.getByText("Item 1 of 2")).toBeVisible();
  });

  it("persists valid settings and blocks an invalid reviewer name", async () => {
    const user = userEvent.setup();
    installReviewService();
    render(<AnnotationWorkbench />);

    const serviceUrl = await screen.findByLabelText("Review service URL");
    await user.clear(serviceUrl);
    await user.type(serviceUrl, "http://127.0.0.1:8765");
    await user.click(screen.getByRole("button", { name: "Open review batch" }));
    await screen.findByRole("heading", { name: "Compare boundaries" });
    expect(
      window.localStorage.getItem("annotation-workbench:service-url"),
    ).toBe("http://127.0.0.1:8765");

    const reviewer = screen.getByRole("textbox", { name: "Reviewer name" });
    await user.clear(reviewer);
    await user.type(reviewer, "invalid reviewer");
    await user.tab();
    expect(screen.getByText(/Reviewer name may contain letters/)).toBeVisible();
    expect(
      window.localStorage.getItem("annotation-workbench:reviewer-id"),
    ).toBe("reviewer-a");
  });
});
