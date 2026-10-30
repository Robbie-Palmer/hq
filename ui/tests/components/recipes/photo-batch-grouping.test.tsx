import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoBatchGrouping } from "@/components/recipes/photo-batch-grouping";
import type { ImportBatch } from "@/lib/api/recipe-import-batches";
import { fireEvent, render, screen, waitFor } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/http")>()),
  apiRequest: mocks.apiRequest,
}));

const batchId = "00000000-0000-4000-8000-000000000010";
const firstImageId = "00000000-0000-4000-8000-000000000001";
const secondImageId = "00000000-0000-4000-8000-000000000002";
const thirdImageId = "00000000-0000-4000-8000-000000000003";
const imageIds = [firstImageId, secondImageId, thirdImageId];
const imageNames = ["one.png", "two.png", "three.png"];

function photoBatch(imageCount = imageIds.length): ImportBatch {
  const images = Array.from({ length: imageCount }, (_, position) => ({
    id: `00000000-0000-4000-8000-${String(position + 1).padStart(12, "0")}`,
    position,
    filename: imageNames[position] ?? `page-${position + 1}.png`,
    contentType: "image/png",
    byteSize: 100,
  }));
  return {
    id: batchId,
    kind: "photo",
    createdAt: "2026-10-30T00:00:00.000Z",
    visibility: "private",
    status: "preparing",
    counts: { processing: 0, ready: 0, failed: 0, accepted: 0, skipped: 0 },
    items: [],
    photoManifest: null,
    photoImages: images,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiRequest.mockResolvedValue(photoBatch());
});

describe("photo batch grouping", () => {
  it("keeps every image once while grouping and ordering pages", async () => {
    const onConfirmed = vi.fn().mockResolvedValue(undefined);
    render(
      <PhotoBatchGrouping batch={photoBatch()} onConfirmed={onConfirmed} />,
    );

    expect(screen.getAllByRole("group")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Recipe group for two.png"), {
      target: { value: "0" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Move two.png earlier" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm grouping and start" }),
    );

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(batchId));
    const confirmation = mocks.apiRequest.mock.calls.find(
      ([url]) => typeof url === "string" && url.endsWith("/photo-manifests"),
    );
    expect(confirmation?.[1]).toMatchObject({
      method: "POST",
      json: {
        expectedVersion: 0,
        groups: [
          { imageIds: [imageIds[1], imageIds[0]] },
          { imageIds: [imageIds[2]] },
        ],
      },
    });
    const submittedIds = confirmation?.[1].json.groups.flatMap(
      (group: { imageIds: string[] }) => group.imageIds,
    );
    expect(new Set(submittedIds)).toEqual(new Set(imageIds));
  });

  it("labels thumbnail controls and locks successful siblings during regrouping", () => {
    const batch = photoBatch();
    batch.status = "awaiting_review";
    batch.counts = {
      processing: 0,
      ready: 1,
      failed: 1,
      accepted: 0,
      skipped: 0,
    };
    batch.items = [
      {
        id: "00000000-0000-4000-8000-000000000101",
        sourceLabel: "Soup",
        status: "succeeded",
        reviewState: "ready",
        draftVersion: 1,
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        sourceLabel: "Bread",
        status: "failed",
        reviewState: "needs_attention",
        draftVersion: 1,
      },
    ];
    const successfulJobId = batch.items[0]?.id;
    const failedJobId = batch.items[1]?.id;
    if (!successfulJobId || !failedJobId) throw new Error("Missing test jobs");
    batch.photoManifest = {
      version: 1,
      checksum: "a".repeat(64),
      confirmedAt: "2026-10-30T00:01:00.000Z",
      groups: [
        {
          position: 0,
          title: "Soup",
          jobId: successfulJobId,
          imageIds: [firstImageId, secondImageId],
        },
        {
          position: 1,
          title: "Bread",
          jobId: failedJobId,
          imageIds: [thirdImageId],
        },
      ],
    };

    render(<PhotoBatchGrouping batch={batch} onConfirmed={vi.fn()} />);

    expect(
      screen.getByText(
        "Draft ready. This group will be reused without another extraction.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Page 1: one.png" }),
    ).toHaveAttribute("src", expect.stringContaining(firstImageId));
    expect(
      screen.getByRole("button", { name: "Move one.png later" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Recipe group for three.png")).toBeEnabled();
  });

  it("supports the grouping fast paths and explains the six-page limit", () => {
    const { unmount } = render(
      <PhotoBatchGrouping batch={photoBatch(7)} onConfirmed={vi.fn()} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Group editable pages" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A recipe group can contain at most six pages.",
    );
    expect(screen.getAllByRole("group")).toHaveLength(7);

    unmount();
    render(<PhotoBatchGrouping batch={photoBatch()} onConfirmed={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Group editable pages" }),
    );
    expect(screen.getAllByRole("group")).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Each image is a recipe" }),
    );
    expect(screen.getAllByRole("group")).toHaveLength(3);
  });

  it("submits trimmed titles and the selected recipe order", async () => {
    render(<PhotoBatchGrouping batch={photoBatch()} onConfirmed={vi.fn()} />);

    const firstTitle = screen.getAllByLabelText("Optional title").at(0);
    if (!firstTitle) throw new Error("Missing first title input");
    fireEvent.change(firstTitle, {
      target: { value: "  Supper  " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Move recipe 1 later" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm grouping and start" }),
    );

    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalled());
    const confirmation = mocks.apiRequest.mock.calls.at(-1)?.[1];
    expect(confirmation?.json.groups).toEqual([
      { imageIds: [secondImageId] },
      { title: "Supper", imageIds: [firstImageId] },
      { imageIds: [thirdImageId] },
    ]);
  });

  it("disables confirmation for an empty group and reports API failures", async () => {
    render(<PhotoBatchGrouping batch={photoBatch()} onConfirmed={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add recipe group" }));
    expect(
      screen.getByRole("button", { name: "Confirm grouping and start" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Recipe group for three.png"), {
      target: { value: "3" },
    });
    mocks.apiRequest.mockRejectedValueOnce(new Error("Manifest changed"));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm grouping and start" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Manifest changed",
    );
    expect(
      screen.getByRole("button", { name: "Confirm grouping and start" }),
    ).toBeEnabled();
  });
});
