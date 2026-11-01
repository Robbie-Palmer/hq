import { beforeEach, describe, expect, it, vi } from "vitest";
import { BatchImportCapture } from "@/components/recipes/batch-import-capture";
import type { ImportBatch } from "@/lib/api/recipe-import-batches";
import { fireEvent, render, screen, waitFor } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/http")>()),
  apiRequest: mocks.apiRequest,
}));

const batchId = "00000000-0000-4000-8000-000000000010";
const imageIds = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];

function photoBatch(): ImportBatch {
  return {
    id: batchId,
    kind: "photo",
    createdAt: "2026-10-30T00:00:00.000Z",
    visibility: "private",
    status: "preparing",
    counts: { processing: 0, ready: 0, failed: 0, accepted: 0, skipped: 0 },
    items: [],
    photoManifest: null,
    photoImages: imageIds.map((id, position) => ({
      id,
      position,
      filename: `${position + 1}.png`,
      contentType: "image/png",
      byteSize: 3,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiRequest.mockResolvedValue(photoBatch());
});

describe("photo batch capture", () => {
  it("validates the count and image type before upload", () => {
    render(<BatchImportCapture hasBatch={false} onStart={vi.fn()} />);
    const input = screen.getByLabelText("Recipe page photos");
    const image = new File([new Uint8Array([1])], "page.png", {
      type: "image/png",
    });

    fireEvent.change(input, { target: { files: Array(31).fill(image) } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose at most 30 photos.",
    );

    const text = new File(["recipe"], "recipe.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [text] } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "recipe.txt must be a JPEG, PNG, or WebP image.",
    );
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it("rejects oversized selections and reports upload failures", async () => {
    render(<BatchImportCapture hasBatch={false} onStart={vi.fn()} />);
    const input = screen.getByLabelText("Recipe page photos");
    const sizedImage = (name: string, size: number) => {
      const file = new File([new Uint8Array([1])], name, { type: "image/png" });
      Object.defineProperty(file, "size", { value: size });
      return file;
    };

    fireEvent.change(input, {
      target: { files: [sizedImage("large.png", 10 * 1024 * 1024 + 1)] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "large.png exceeds 10 MB.",
    );

    fireEvent.change(input, {
      target: {
        files: Array.from({ length: 4 }, (_, index) =>
          sizedImage(`${index}.png`, 8_000_000),
        ),
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Photo batches must total 30 MB or less.",
    );

    const valid = sizedImage("valid.png", 3);
    fireEvent.change(input, { target: { files: [valid] } });
    mocks.apiRequest.mockRejectedValueOnce(new Error("Upload unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Upload pages" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Upload unavailable",
    );
    expect(screen.getByRole("button", { name: "Upload pages" })).toBeEnabled();
  });

  it("uploads pages, confirms one ordered group, and starts that batch", async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    render(<BatchImportCapture hasBatch={false} onStart={onStart} />);
    const first = new File([new Uint8Array([1, 2, 3])], "1.png", {
      type: "image/png",
    });
    const second = new File([new Uint8Array([4, 5, 6])], "2.png", {
      type: "image/png",
    });

    fireEvent.change(screen.getByLabelText("Recipe page photos"), {
      target: { files: [first, second] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload pages" }));
    await screen.findByRole("heading", { name: "Group recipe pages" });

    const upload = mocks.apiRequest.mock.calls.find(([url]) =>
      String(url).endsWith("/recipe-import-batches/photos"),
    );
    const uploadOptions = upload?.[1];
    if (!uploadOptions) throw new Error("Missing photo upload request");
    expect(uploadOptions).toMatchObject({ method: "POST" });
    expect(uploadOptions.body).toBeInstanceOf(FormData);
    expect((uploadOptions.body as FormData).getAll("images")).toEqual([
      first,
      second,
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Group editable pages" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm grouping and start" }),
    );

    await waitFor(() => expect(onStart).toHaveBeenCalledWith(batchId));
    const confirmation = mocks.apiRequest.mock.calls.find(([url]) =>
      String(url).endsWith("/photo-manifests"),
    );
    expect(confirmation?.[1]).toMatchObject({
      method: "POST",
      json: {
        expectedVersion: 0,
        groups: [{ imageIds }],
      },
    });
  });
});
