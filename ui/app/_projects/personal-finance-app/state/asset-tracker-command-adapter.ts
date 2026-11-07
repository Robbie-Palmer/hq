import type { UnknownAction } from "@reduxjs/toolkit";
import {
  type AssetTrackerApi,
  AssetTrackerStorageError,
  createLocalAssetTrackerApi,
} from "@/app/_projects/personal-finance-app/api/assettracker";
import type { AssetTrackerData } from "@/app/_projects/personal-finance-app/domain";
import {
  type AssetTrackerStore,
  assetTrackerEvents,
} from "./asset-tracker-store";

const LOAD_ERROR =
  "Asset Tracker could not read this browser's saved data. Nothing has been changed. Check that browser storage is available, then try again.";
const SAVE_ERROR =
  "Asset Tracker could not save the last change in this browser. The change was not applied. Check that browser storage is available, then try again.";
const RESET_ERROR =
  "Asset Tracker could not reset data in this browser. Nothing has been changed. Check that browser storage is available, then try again.";

type ApiCommand = (api: AssetTrackerApi) => Promise<AssetTrackerData>;

export interface AssetTrackerCommandAdapter {
  load(): Promise<void>;
  run(operation: string, command: ApiCommand): Promise<void>;
  reset(command: ApiCommand): Promise<void>;
  getApi(): AssetTrackerApi;
  dispose(): void;
}

export function formatAssetTrackerTransitionFailure(
  operation: string,
  error: unknown,
  actions: readonly UnknownAction[],
): string {
  const reason = error instanceof Error ? error.message : String(error);
  return [
    `Asset Tracker transition "${operation}" failed: ${reason}`,
    "Replay with replayAssetTrackerActions(actionSequence):",
    JSON.stringify(actions),
  ].join("\n");
}

export function createAssetTrackerCommandAdapter(
  store: AssetTrackerStore,
  createApi: () => AssetTrackerApi = () =>
    createLocalAssetTrackerApi(window.localStorage),
): AssetTrackerCommandAdapter {
  let api: AssetTrackerApi | null = null;
  let loadRequest = 0;
  const getApi = () => {
    api ??= createApi();
    return api;
  };
  const reportFailure = (operation: string, error: unknown) => {
    console.error(
      formatAssetTrackerTransitionFailure(
        operation,
        error,
        store.getActionLog(),
      ),
    );
  };

  return {
    getApi,
    async load() {
      const requestId = ++loadRequest;
      store.dispatch(assetTrackerEvents.localDataLoadStarted({ requestId }));
      try {
        const result = await getApi().load();
        if (requestId !== loadRequest) return;
        store.dispatch(
          assetTrackerEvents.localDataLoadAccepted({ requestId, ...result }),
        );
      } catch (error) {
        if (requestId !== loadRequest) return;
        console.warn("AssetTracker: failed to load stored data", error);
        store.dispatch(
          assetTrackerEvents.localDataLoadRejected({
            requestId,
            message: LOAD_ERROR,
          }),
        );
        reportFailure("local data load", error);
      }
    },
    async run(operation, command) {
      store.dispatch(assetTrackerEvents.commandStarted({ operation }));
      try {
        const data = await command(getApi());
        store.dispatch(
          assetTrackerEvents.commandCommitted({
            operation,
            data,
            hasLocalChanges: true,
          }),
        );
      } catch (error) {
        const storageFailure = error instanceof AssetTrackerStorageError;
        store.dispatch(
          assetTrackerEvents.commandRejected({
            operation,
            storageFailure,
            message: storageFailure ? SAVE_ERROR : null,
          }),
        );
        reportFailure(operation, error);
        throw error;
      }
    },
    async reset(command) {
      const operation = "data reset";
      store.dispatch(assetTrackerEvents.commandStarted({ operation }));
      try {
        const data = await command(getApi());
        store.dispatch(
          assetTrackerEvents.commandCommitted({
            operation,
            data,
            hasLocalChanges: false,
          }),
        );
      } catch (error) {
        store.dispatch(
          assetTrackerEvents.commandRejected({
            operation,
            storageFailure: true,
            message: RESET_ERROR,
          }),
        );
        reportFailure(operation, error);
        throw error;
      }
    },
    dispose() {
      loadRequest += 1;
    },
  };
}
