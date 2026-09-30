import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useBatchDraftAutosave } from "@/hooks/use-batch-draft-autosave";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/api/http", () => ({ apiRequest: mocks.apiRequest }));

it("keeps a reverted edit dirty until the compensating save is confirmed", async () => {
  const draft = {
    title: "Soup",
    description: "A soup",
    cuisine: "",
    servings: 2,
    source: "Mix @salt{1%tsp}.",
  };
  let finishFirst: (value: unknown) => void = () => undefined;
  let finishSecond: (value: unknown) => void = () => undefined;
  mocks.apiRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
  );
  mocks.apiRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSecond = resolve;
      }),
  );
  const { result } = renderHook(() =>
    useBatchDraftAutosave("/api/item", draft, 1),
  );
  act(() => result.current.onChange({ ...draft, title: "Edited soup" }));
  act(() => result.current.onChange(draft));
  expect(result.current.dirty.current).toBe(true);
  await act(async () => finishFirst({ draftVersion: 2 }));
  expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, "/api/item/draft", {
    method: "PUT",
    json: { version: 2, draft },
  });
  expect(result.current.dirty.current).toBe(true);
  await act(async () => finishSecond({ draftVersion: 3 }));
  expect(result.current.dirty.current).toBe(false);
  expect(result.current.version.current).toBe(3);
  expect(result.current.status).toBe("All edits saved");
});
