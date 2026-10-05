import type { BatchDraft } from "recipe-domain/batch-import";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/http";
import { fireEvent, render, screen, waitFor } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), useSession: vi.fn() }));
vi.mock("@/lib/api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/http")>()),
  apiRequest: mocks.apiRequest,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: mocks.useSession },
}));
vi.mock("@/components/recipes/add-recipe-view", () => ({
  AddRecipeView: ({
    batchImport,
  }: {
    batchImport: {
      draft: BatchDraft;
      onChange: (draft: BatchDraft) => void;
      onSave: (recipe: unknown, next: boolean) => Promise<void>;
    };
  }) => (
    <div>
      <label>
        Editor title
        <input
          defaultValue={batchImport.draft.title}
          onChange={(event) =>
            batchImport.onChange({
              ...batchImport.draft,
              title: event.target.value,
            })
          }
        />
      </label>
      <button
        type="button"
        onClick={() =>
          void batchImport
            .onSave({ title: batchImport.draft.title }, true)
            .catch(() => undefined)
        }
      >
        Save and next
      </button>
    </div>
  ),
}));

import { BatchRecipeImport } from "@/components/recipes/batch-recipe-import";

const batchId = "00000000-0000-4000-8000-000000000001";
const draft = {
  title: "Soup",
  description: "Soup recipe",
  cuisine: "",
  servings: 2,
  source: "Mix @salt{1%tsp}.",
};
function batch() {
  return {
    id: batchId,
    createdAt: "2026-09-30T00:00:00Z",
    visibility: "private",
    counts: { processing: 0, ready: 2, failed: 0, accepted: 0, skipped: 0 },
    items: [
      {
        id: "item-1",
        sourceLabel: "soup.cook",
        status: "succeeded",
        reviewState: "ready",
        draft,
        draftVersion: 1,
      },
      {
        id: "item-2",
        sourceLabel: "bread.json",
        status: "succeeded",
        reviewState: "ready",
        draft: { ...draft, title: "Bread" },
        draftVersion: 1,
      },
    ],
  };
}
function batchWithReviewState(state: string) {
  const value = batch();
  const first = value.items[0];
  if (first)
    Object.assign(first, {
      reviewState: state,
      status: state === "needs_attention" ? "failed" : "succeeded",
      errorMessage: state === "needs_attention" ? "Network unavailable" : null,
    });
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/recipes/import");
  mocks.useSession.mockReturnValue({
    data: { user: { id: "cook-1" } },
    isPending: false,
  });
});

function undoFixture(started: boolean) {
  return {
    state: started ? "completed" : "preview",
    items: [
      {
        itemId: "item-1",
        label: "soup.cook",
        outcome: started ? "deleted" : "eligible",
        message: started ? "Imported recipe deleted" : "Ready to delete",
      },
      {
        itemId: "item-2",
        label: "bread.cook",
        outcome: "preserved",
        message: "Recipe has been forked",
      },
    ],
  };
}

describe("batch workspace", () => {
  it("captures a mixed URL and file batch after preflight", async () => {
    mocks.apiRequest.mockImplementation(
      async (url: string, options?: { json: unknown }) => {
        if (options) return batch();
        if (url.endsWith(batchId)) return batch();
        return { batches: [] };
      },
    );
    render(<BatchRecipeImport />);
    fireEvent.change(screen.getByLabelText("Recipe URLs, one per line"), {
      target: { value: "https://example.test/soup" },
    });
    const file = new File([draft.source], "soup.cook");
    Object.defineProperty(file, "text", { value: async () => draft.source });
    fireEvent.change(
      screen.getByLabelText(
        "Cooklang, schema.org files, or Cooklang collection ZIP",
      ),
      {
        target: { files: [file] },
      },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Check sources" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check sources" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start batch" }));
    expect(await screen.findByLabelText("Editor title")).toHaveValue("Soup");
    const requests = mocks.apiRequest.mock.calls
      .filter(
        ([url]) => url.endsWith("/recipe-import-batches") && url !== undefined,
      )
      .filter(([, options]) => options?.method === "POST");
    expect(requests[0]?.[1].json.sources).toEqual([
      { type: "url", url: "https://example.test/soup" },
      { type: "file", filename: "soup.cook", content: draft.source },
    ]);
    expect(window.location.search).toContain(`batch=${batchId}`);
  });

  it("captures an archive with shared visibility and an explicit duplicate policy", async () => {
    mocks.apiRequest.mockImplementation(
      async (url: string, options?: { method: string }) =>
        options || url.endsWith(batchId) ? batch() : { batches: [] },
    );
    render(<BatchRecipeImport />);
    const file = new File(["ZIP"], "collection.zip");
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([80, 75, 3, 4]).buffer,
    });
    fireEvent.change(
      screen.getByLabelText(
        "Cooklang, schema.org files, or Cooklang collection ZIP",
      ),
      { target: { files: [file] } },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Check sources" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Default visibility"), {
      target: { value: "public" },
    });
    fireEvent.change(screen.getByLabelText("Duplicate archive recipes"), {
      target: { value: "allow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check sources" }));
    await screen.findByRole("button", { name: "Start batch" });
    const request = mocks.apiRequest.mock.calls.find(
      ([, options]) => options?.method === "POST",
    );
    expect(request?.[1].json).toMatchObject({
      sources: [
        { type: "archive", filename: "collection.zip", content: "UEsDBA==" },
      ],
      visibility: "public",
      duplicatePolicy: "allow",
    });
  });

  it("previews undo before confirmation and shows per-item outcomes", async () => {
    window.history.replaceState(null, "", `/recipes/import?batch=${batchId}`);
    let started = false;
    mocks.apiRequest.mockImplementation(
      async (url: string, options?: { method: string }) => {
        if (url.endsWith("/undo")) {
          if (options?.method === "PUT") started = true;
          return undoFixture(started);
        }
        if (url.endsWith(batchId)) {
          const value = batch();
          Object.assign(value.items[0]!, {
            reviewState: "accepted",
            archive: {
              archiveName: "collection.zip",
              archiveChecksum: "abc",
              entryPath: "soup.cook",
            },
          });
          return value;
        }
        return { batches: [] };
      },
    );
    render(<BatchRecipeImport />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview batch undo" }),
    );
    await screen.findByText("bread.cook: Recipe has been forked");
    expect(started).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm batch undo" }));
    await screen.findByText("soup.cook: Imported recipe deleted");
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      expect.stringContaining("/undo"),
      { method: "PUT", json: { state: "started" } },
    );
  });

  it("resumes a stable item URL and waits for autosave before switching", async () => {
    window.history.replaceState(
      null,
      "",
      `/recipes/import?batch=${batchId}&item=item-1`,
    );
    let finishSave: (value: unknown) => void = () => undefined;
    mocks.apiRequest.mockImplementation(
      async (url: string, options?: { method: string }) => {
        if (options?.method === "PUT")
          return new Promise((resolve) => {
            finishSave = resolve;
          });
        return url.endsWith(batchId) ? batch() : { batches: [] };
      },
    );
    render(<BatchRecipeImport />);
    fireEvent.change(await screen.findByLabelText("Editor title"), {
      target: { value: "Edited soup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "bread.json · ready" }));
    expect(screen.getByLabelText("Editor title")).toHaveValue("Edited soup");
    finishSave({ draftVersion: 2 });
    await waitFor(() =>
      expect(screen.getByLabelText("Editor title")).toHaveValue("Bread"),
    );
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      expect.stringContaining("/item-1/draft"),
      expect.objectContaining({
        json: { version: 1, draft: { ...draft, title: "Edited soup" } },
      }),
    );
  });

  it("keeps edited content selected when autosave fails", async () => {
    window.history.replaceState(
      null,
      "",
      `/recipes/import?batch=${batchId}&item=item-1`,
    );
    mocks.apiRequest.mockImplementation(
      async (url: string, options?: { method: string }) => {
        if (options?.method === "PUT")
          throw new Error("Draft changed. Reload before editing.");
        return url.endsWith(batchId) ? batch() : { batches: [] };
      },
    );
    render(<BatchRecipeImport />);
    fireEvent.change(await screen.findByLabelText("Editor title"), {
      target: { value: "My correction" },
    });
    await screen.findByText("Edits not saved");
    fireEvent.click(screen.getByRole("button", { name: "bread.json · ready" }));
    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0),
    );
    expect(screen.getByLabelText("Editor title")).toHaveValue("My correction");
    expect(window.location.search).toContain("item=item-1");
  });

  it("accepts one draft and selects the next review item", async () => {
    window.history.replaceState(
      null,
      "",
      `/recipes/import?batch=${batchId}&item=item-1`,
    );
    let accepted = false;
    mocks.apiRequest.mockImplementation(async (url: string) => {
      if (url.endsWith("/acceptance")) {
        accepted = true;
        return { recipeId: "recipe-1" };
      }
      if (url.endsWith(batchId)) {
        const result = batch();
        if (accepted && result.items[0])
          result.items[0].reviewState = "accepted";
        return result;
      }
      return { batches: [] };
    });
    render(<BatchRecipeImport />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Save and next" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Editor title")).toHaveValue("Bread"),
    );
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      expect.stringContaining("/item-1/acceptance"),
      expect.objectContaining({
        json: expect.objectContaining({
          version: 1,
          idempotencyKey: expect.any(String),
        }),
      }),
    );
  });

  it("replays the exact acceptance after a lost response", async () => {
    window.history.replaceState(
      null,
      "",
      `/recipes/import?batch=${batchId}&item=item-1`,
    );
    let attempts = 0;
    mocks.apiRequest.mockImplementation(async (url: string) => {
      if (url.endsWith("/acceptance")) {
        if (++attempts === 1) throw new Error("Response lost");
        return { recipeId: "recipe-1", replayed: true };
      }
      return url.endsWith(batchId) ? batch() : { batches: [] };
    });
    render(<BatchRecipeImport />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Save and next" }),
    );
    await waitFor(() => expect(attempts).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
    await waitFor(() => expect(attempts).toBe(2));
    const requests = mocks.apiRequest.mock.calls.filter(([url]) =>
      url.endsWith("/acceptance"),
    );
    expect(requests[1]?.[1]).toEqual(requests[0]?.[1]);
  });

  it("retries failed imports and skips ready items independently", async () => {
    window.history.replaceState(
      null,
      "",
      `/recipes/import?batch=${batchId}&item=item-1`,
    );
    let state = "needs_attention";
    mocks.apiRequest.mockImplementation(
      async (url: string, options?: { method: string }) => {
        if (url.endsWith("/attempts")) state = "ready";
        if (url.endsWith("/review") && options?.method === "PUT")
          state = "skipped";
        if (url.endsWith(batchId)) {
          return batchWithReviewState(state);
        }
        return { batches: [] };
      },
    );
    render(<BatchRecipeImport />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry import" }),
    );
    await screen.findByLabelText("Editor title");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Editor title")).not.toBeInTheDocument(),
    );
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      expect.stringContaining("/attempts"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      expect.stringContaining("/review"),
      expect.objectContaining({ method: "PUT", json: { state: "skipped" } }),
    );
  });

  it("allows a corrected title after a definitive acceptance rejection", async () => {
    window.history.replaceState(
      null,
      "",
      `/recipes/import?batch=${batchId}&item=item-1`,
    );
    let attempts = 0;
    mocks.apiRequest.mockImplementation(async (url: string) => {
      if (url.endsWith("/acceptance")) {
        if (++attempts === 1) throw new ApiError("Title already exists", 409);
        return { recipeId: "recipe-1" };
      }
      if (url.endsWith("/draft")) return { draftVersion: 2 };
      return url.endsWith(batchId) ? batch() : { batches: [] };
    });
    render(<BatchRecipeImport />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Save and next" }),
    );
    await waitFor(() => expect(attempts).toBe(1));
    fireEvent.change(screen.getByLabelText("Editor title"), {
      target: { value: "New title" },
    });
    await screen.findByText("All edits saved");
    fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
    await waitFor(() => expect(attempts).toBe(2));
    const requests = mocks.apiRequest.mock.calls.filter(([url]) =>
      url.endsWith("/acceptance"),
    );
    expect(requests[1]?.[1].json.idempotencyKey).not.toEqual(
      requests[0]?.[1].json.idempotencyKey,
    );
    expect(requests[1]?.[1].json.version).toBe(2);
  });
});
