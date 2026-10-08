import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PhotoRecipeImport,
  type PhotoRecipeImportDraft,
} from "@/components/recipes/photo-recipe-import";

const draft: PhotoRecipeImportDraft = {
  cooklang: {
    frontmatter: { title: "Tomato pasta" },
    body: "Cook @pasta{200%g}.",
  },
  recipe: {
    title: "Tomato pasta",
    description: "A quick pasta",
    cuisine: ["Italian"],
    servings: 2,
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

describe("PhotoRecipeImport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reapply a completed job when the tab is reactivated", async () => {
    const onDraftReady = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "job-1",
          status: "queued",
          currentStage: null,
          progressLabel: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "job-1", status: "succeeded", draft }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <PhotoRecipeImport active onDraftReady={onDraftReady} />,
    );
    const input = screen.getByLabelText("Choose recipe photos");
    fireEvent.change(input, {
      target: {
        files: [new File(["photo"], "recipe.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import from photos" }));

    await waitFor(() => expect(onDraftReady).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(2);

    rerender(<PhotoRecipeImport active={false} onDraftReady={onDraftReady} />);
    rerender(<PhotoRecipeImport active onDraftReady={onDraftReady} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(onDraftReady).toHaveBeenCalledOnce();
  });

  it("rejects an imported draft that is too long to save", async () => {
    const onDraftReady = vi.fn();
    const oversizedDraft: PhotoRecipeImportDraft = {
      ...draft,
      cooklang: { ...draft.cooklang, body: "a".repeat(10_001) },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "job-1", status: "queued" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "job-1",
          status: "succeeded",
          draft: oversizedDraft,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PhotoRecipeImport active onDraftReady={onDraftReady} />);
    fireEvent.change(screen.getByLabelText("Choose recipe photos"), {
      target: {
        files: [new File(["photo"], "recipe.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import from photos" }));

    expect(
      await screen.findByText(
        "The imported recipe is too long to save. Try fewer photos or import the recipe in sections.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Imported recipe is too long")).toBeInTheDocument();
    expect(onDraftReady).not.toHaveBeenCalled();
  });

  it("recovers after a transient polling failure", async () => {
    const onDraftReady = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "job-1", status: "queued" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Temporary status failure" }), {
          status: 502,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "job-1", status: "succeeded", draft }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PhotoRecipeImport active onDraftReady={onDraftReady} />);
    fireEvent.change(screen.getByLabelText("Choose recipe photos"), {
      target: {
        files: [new File(["photo"], "recipe.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import from photos" }));

    expect(
      await screen.findByText("Temporary status failure Retrying…"),
    ).toBeInTheDocument();
    await waitFor(() => expect(onDraftReady).toHaveBeenCalledOnce(), {
      timeout: 3_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("allows a new import after repeated polling failures", async () => {
    const failedStatusResponse = () =>
      new Response(JSON.stringify({ error: "Status unavailable" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "job-1", status: "queued" }))
      .mockResolvedValueOnce(failedStatusResponse())
      .mockResolvedValueOnce(failedStatusResponse())
      .mockResolvedValueOnce(failedStatusResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<PhotoRecipeImport active onDraftReady={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Choose recipe photos"), {
      target: {
        files: [new File(["photo"], "recipe.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import from photos" }));

    expect(
      await screen.findByText(
        "Status unavailable Start the import again to retry.",
        undefined,
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import from photos" }),
    ).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("rejects a status response for a different job", async () => {
    const onDraftReady = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "job-1", status: "queued" }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "job-2", status: "succeeded", draft }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PhotoRecipeImport active onDraftReady={onDraftReady} />);
    fireEvent.change(screen.getByLabelText("Choose recipe photos"), {
      target: {
        files: [new File(["photo"], "recipe.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import from photos" }));

    expect(
      await screen.findByText(
        "We couldn't check the photo import status. Retrying…",
      ),
    ).toBeInTheDocument();
    expect(onDraftReady).not.toHaveBeenCalled();
  });

  it("cancels polling when the photo importer becomes inactive", async () => {
    const onDraftReady = vi.fn();
    const pollAborted = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "job-1", status: "queued" }))
      .mockImplementationOnce((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            pollAborted();
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <PhotoRecipeImport active onDraftReady={onDraftReady} />,
    );
    fireEvent.change(screen.getByLabelText("Choose recipe photos"), {
      target: {
        files: [new File(["photo"], "recipe.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import from photos" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    rerender(<PhotoRecipeImport active={false} onDraftReady={onDraftReady} />);

    await waitFor(() => expect(pollAborted).toHaveBeenCalledOnce());
    expect(onDraftReady).not.toHaveBeenCalled();
  });

  it("rejects photo selections over the combined size limit", () => {
    render(<PhotoRecipeImport active onDraftReady={vi.fn()} />);
    const files = ["first", "second", "third", "fourth"].map((name) => {
      const file = new File(["photo"], `${name}.jpg`, { type: "image/jpeg" });
      Object.defineProperty(file, "size", { value: 8 * 1024 * 1024 });
      return file;
    });

    fireEvent.change(screen.getByLabelText("Choose recipe photos"), {
      target: { files },
    });

    expect(
      screen.getByText("Selected photos must total 30 MB or less."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import from photos" }),
    ).toBeDisabled();
  });

  it("keeps the hidden file inputs out of sequential keyboard navigation", () => {
    render(<PhotoRecipeImport active onDraftReady={vi.fn()} />);

    expect(screen.getByLabelText("Take a recipe photo")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByLabelText("Choose recipe photos")).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });
});
