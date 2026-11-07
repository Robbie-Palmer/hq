import { describe, expect, it, vi } from "vitest";
import {
  type AssetTrackerApi,
  AssetTrackerStorageError,
} from "@/app/_projects/personal-finance-app/api/assettracker";
import { selectAssetTrackerViews } from "@/app/_projects/personal-finance-app/components/asset-tracker-provider";
import { getDemoAssetTrackerData } from "@/app/_projects/personal-finance-app/lib";
import { createAssetTrackerCommandAdapter } from "@/app/_projects/personal-finance-app/state/asset-tracker-command-adapter";
import {
  assetTrackerEvents,
  createAssetTrackerStore,
  replayAssetTrackerActions,
  selectAssetTrackerData,
  selectHasLocalChanges,
  selectLocalDataError,
  selectLocalDataStatus,
} from "@/app/_projects/personal-finance-app/state/asset-tracker-store";

function euroDemoData() {
  const data = getDemoAssetTrackerData();
  return {
    ...data,
    settings: { ...data.settings, baseCurrency: "EUR" as const },
  };
}

describe("Asset Tracker reducers and selectors", () => {
  it("accepts the current persisted load and derives financial views", () => {
    const store = createAssetTrackerStore();
    const data = euroDemoData();

    store.dispatch(assetTrackerEvents.localDataLoadStarted({ requestId: 12 }));
    store.dispatch(
      assetTrackerEvents.localDataLoadAccepted({
        requestId: 12,
        data,
        persisted: true,
      }),
    );

    expect(selectAssetTrackerData(store.getState())).toEqual(data);
    expect(selectHasLocalChanges(store.getState())).toBe(true);
    expect(selectLocalDataStatus(store.getState())).toBe("ready");
    expect(selectAssetTrackerViews(store.getState()).baseCurrency).toBe("EUR");
  });

  it("rejects stale load events", () => {
    const store = createAssetTrackerStore();
    const initial = selectAssetTrackerData(store.getState());

    store.dispatch(assetTrackerEvents.localDataLoadStarted({ requestId: 1 }));
    store.dispatch(assetTrackerEvents.localDataLoadStarted({ requestId: 2 }));
    store.dispatch(
      assetTrackerEvents.localDataLoadAccepted({
        requestId: 1,
        data: euroDemoData(),
        persisted: true,
      }),
    );
    store.dispatch(
      assetTrackerEvents.localDataLoadRejected({
        requestId: 1,
        message: "stale failure",
      }),
    );

    expect(selectAssetTrackerData(store.getState())).toBe(initial);
    expect(selectLocalDataStatus(store.getState())).toBe("loading");
    expect(selectLocalDataError(store.getState())).toBeNull();
  });

  it("does not replace data when a command started before loading completed", () => {
    const store = createAssetTrackerStore();
    const initial = selectAssetTrackerData(store.getState());

    store.dispatch(assetTrackerEvents.localDataLoadStarted({ requestId: 4 }));
    store.dispatch(
      assetTrackerEvents.commandStarted({ operation: "account created" }),
    );
    store.dispatch(
      assetTrackerEvents.localDataLoadAccepted({
        requestId: 4,
        data: euroDemoData(),
        persisted: true,
      }),
    );

    expect(selectAssetTrackerData(store.getState())).toBe(initial);
    expect(selectHasLocalChanges(store.getState())).toBe(false);
    expect(selectLocalDataStatus(store.getState())).toBe("ready");
  });

  it("keeps domain rejections out of storage recovery state", () => {
    const store = createAssetTrackerStore();
    const data = selectAssetTrackerData(store.getState());
    store.dispatch(
      assetTrackerEvents.commandCommitted({
        operation: "initial load",
        data,
        hasLocalChanges: false,
      }),
    );

    store.dispatch(
      assetTrackerEvents.commandRejected({
        operation: "invalid salary rejected",
        storageFailure: false,
        message: null,
      }),
    );

    expect(selectLocalDataStatus(store.getState())).toBe("ready");
    expect(selectLocalDataError(store.getState())).toBeNull();
  });

  it("moves storage rejections into a replayable recovery state", () => {
    const store = createAssetTrackerStore();
    store.dispatch(
      assetTrackerEvents.commandRejected({
        operation: "balance recording rejected",
        storageFailure: true,
        message: "storage unavailable",
      }),
    );

    const replayed = replayAssetTrackerActions(store.getActionLog());

    expect(selectLocalDataStatus(store.getState())).toBe("error");
    expect(selectLocalDataError(store.getState())).toBe("storage unavailable");
    expect(replayed).toEqual(store.getState());
  });
});

describe("Asset Tracker failure diagnostics", () => {
  it("loads persisted data through the browser API adapter", async () => {
    const store = createAssetTrackerStore();
    const data = euroDemoData();
    const adapter = createAssetTrackerCommandAdapter(
      store,
      () =>
        ({
          load: vi.fn().mockResolvedValue({ data, persisted: true }),
        }) as unknown as AssetTrackerApi,
    );

    await adapter.load();

    expect(adapter.getApi().load).toHaveBeenCalledOnce();
    expect(selectAssetTrackerData(store.getState())).toEqual(data);
    expect(selectLocalDataStatus(store.getState())).toBe("ready");
  });

  it("reports load failures and cancels results after disposal", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});
    const failedStore = createAssetTrackerStore();
    const failedAdapter = createAssetTrackerCommandAdapter(
      failedStore,
      () =>
        ({
          load: vi.fn().mockRejectedValue(new Error("read failed")),
        }) as unknown as AssetTrackerApi,
    );

    await failedAdapter.load();

    expect(selectLocalDataStatus(failedStore.getState())).toBe("error");
    expect(selectLocalDataError(failedStore.getState())).toContain(
      "could not read",
    );
    expect(warning).toHaveBeenCalledOnce();
    expect(errorOutput).toHaveBeenCalledOnce();

    const cancelledStore = createAssetTrackerStore();
    let resolveLoad:
      | ((value: {
          data: ReturnType<typeof euroDemoData>;
          persisted: boolean;
        }) => void)
      | undefined;
    const cancelledAdapter = createAssetTrackerCommandAdapter(
      cancelledStore,
      () =>
        ({
          load: () =>
            new Promise((resolve) => {
              resolveLoad = resolve;
            }),
        }) as unknown as AssetTrackerApi,
    );
    const loading = cancelledAdapter.load();
    cancelledAdapter.dispose();
    resolveLoad?.({ data: euroDemoData(), persisted: true });
    await loading;

    expect(selectLocalDataStatus(cancelledStore.getState())).toBe("loading");
    warning.mockRestore();
    errorOutput.mockRestore();
  });

  it("commits successful commands and reports storage failures", async () => {
    const store = createAssetTrackerStore();
    const adapter = createAssetTrackerCommandAdapter(
      store,
      () => ({}) as AssetTrackerApi,
    );
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = euroDemoData();

    await adapter.run("currency changed", async () => data);

    expect(selectAssetTrackerData(store.getState())).toEqual(data);
    expect(selectHasLocalChanges(store.getState())).toBe(true);

    await expect(
      adapter.run("balance recording rejected", async () => {
        throw new AssetTrackerStorageError("write failed");
      }),
    ).rejects.toThrow("write failed");

    expect(selectLocalDataStatus(store.getState())).toBe("error");
    expect(selectLocalDataError(store.getState())).toContain("could not save");
    errorOutput.mockRestore();
  });

  it("resets to demo data and reports reset failures", async () => {
    const store = createAssetTrackerStore();
    const adapter = createAssetTrackerCommandAdapter(
      store,
      () => ({}) as AssetTrackerApi,
    );
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});

    await adapter.reset(async () => getDemoAssetTrackerData());
    expect(selectHasLocalChanges(store.getState())).toBe(false);
    expect(selectLocalDataStatus(store.getState())).toBe("ready");

    await expect(
      adapter.reset(async () => {
        throw new Error("remove failed");
      }),
    ).rejects.toThrow("remove failed");
    expect(selectLocalDataError(store.getState())).toContain("could not reset");
    errorOutput.mockRestore();
  });

  it("prints an action sequence that reproduces a rejected transition", async () => {
    const store = createAssetTrackerStore();
    const data = selectAssetTrackerData(store.getState());
    store.dispatch(
      assetTrackerEvents.commandCommitted({
        operation: "local data loaded",
        data,
        hasLocalChanges: false,
      }),
    );
    const adapter = createAssetTrackerCommandAdapter(
      store,
      () => ({}) as AssetTrackerApi,
    );
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      adapter.run("invalid salary rejected", async () => {
        throw new Error("salary predecessor was not found");
      }),
    ).rejects.toThrow("salary predecessor was not found");

    const output = String(errorOutput.mock.calls[0]?.[0]);
    const actionSequence = JSON.parse(output.split("\n").at(-1) ?? "[]");
    const replayed = replayAssetTrackerActions(actionSequence);

    expect(output).toContain('transition "invalid salary rejected" failed');
    expect(actionSequence.at(-1)).toMatchObject({
      type: "assetTracker/data/commandRejected",
      payload: {
        operation: "invalid salary rejected",
        storageFailure: false,
      },
    });
    expect(replayed).toEqual(store.getState());
    errorOutput.mockRestore();
  });
});
