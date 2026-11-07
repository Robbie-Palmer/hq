import {
  configureStore,
  createSlice,
  type Middleware,
  type PayloadAction,
  type UnknownAction,
} from "@reduxjs/toolkit";
import { useDispatch, useSelector, useStore } from "react-redux";
import type { AssetTrackerData } from "@/app/_projects/personal-finance-app/domain";
import { getDemoAssetTrackerData } from "@/app/_projects/personal-finance-app/lib";

export type LocalDataStatus = "loading" | "ready" | "error";

interface AssetDataState {
  value: AssetTrackerData;
  activeLoadRequest: number | null;
  hasMutationStarted: boolean;
  hasLocalChanges: boolean;
}

interface LocalDataState {
  activeLoadRequest: number | null;
  status: LocalDataStatus;
  error: string | null;
}

export interface LoadStartedPayload {
  requestId: number;
}

export interface LoadAcceptedPayload extends LoadStartedPayload {
  data: AssetTrackerData;
  persisted: boolean;
}

export interface LoadRejectedPayload extends LoadStartedPayload {
  message: string;
}

export interface CommandEventPayload {
  operation: string;
}

export interface CommandCommittedPayload extends CommandEventPayload {
  data: AssetTrackerData;
  hasLocalChanges: boolean;
}

export interface CommandRejectedPayload extends CommandEventPayload {
  storageFailure: boolean;
  message: string | null;
}

const initialAssetDataState = (): AssetDataState => ({
  value: getDemoAssetTrackerData(),
  activeLoadRequest: null,
  hasMutationStarted: false,
  hasLocalChanges: false,
});

const assetDataSlice = createSlice({
  name: "assetTracker/data",
  initialState: initialAssetDataState,
  reducers: {
    localDataLoadStarted(state, action: PayloadAction<LoadStartedPayload>) {
      state.activeLoadRequest = action.payload.requestId;
    },
    localDataLoadAccepted(state, action: PayloadAction<LoadAcceptedPayload>) {
      if (state.activeLoadRequest !== action.payload.requestId) return;
      state.activeLoadRequest = null;
      if (!state.hasMutationStarted && action.payload.persisted) {
        state.value = action.payload.data;
        state.hasLocalChanges = true;
      }
    },
    localDataLoadRejected(state, action: PayloadAction<LoadRejectedPayload>) {
      if (state.activeLoadRequest !== action.payload.requestId) return;
      state.activeLoadRequest = null;
    },
    commandStarted(state, _action: PayloadAction<CommandEventPayload>) {
      state.hasMutationStarted = true;
    },
    commandCommitted(state, action: PayloadAction<CommandCommittedPayload>) {
      state.value = action.payload.data;
      state.hasLocalChanges = action.payload.hasLocalChanges;
    },
    commandRejected(_state, _action: PayloadAction<CommandRejectedPayload>) {},
  },
});

const initialLocalDataState = (): LocalDataState => ({
  activeLoadRequest: null,
  status: "loading",
  error: null,
});

const localDataSlice = createSlice({
  name: "assetTracker/localData",
  initialState: initialLocalDataState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(assetDataSlice.actions.localDataLoadStarted, (state, action) => {
        state.activeLoadRequest = action.payload.requestId;
        state.status = "loading";
        state.error = null;
      })
      .addCase(
        assetDataSlice.actions.localDataLoadAccepted,
        (state, action) => {
          if (state.activeLoadRequest !== action.payload.requestId) return;
          state.activeLoadRequest = null;
          state.status = "ready";
          state.error = null;
        },
      )
      .addCase(
        assetDataSlice.actions.localDataLoadRejected,
        (state, action) => {
          if (state.activeLoadRequest !== action.payload.requestId) return;
          state.activeLoadRequest = null;
          state.status = "error";
          state.error = action.payload.message;
        },
      )
      .addCase(assetDataSlice.actions.commandCommitted, (state) => {
        state.status = "ready";
        state.error = null;
      })
      .addCase(assetDataSlice.actions.commandRejected, (state, action) => {
        if (!action.payload.storageFailure) return;
        state.status = "error";
        state.error = action.payload.message;
      });
  },
});

export const assetTrackerEvents = assetDataSlice.actions;

export const assetDataReducer = assetDataSlice.reducer;
export const localDataReducer = localDataSlice.reducer;

function createActionRecorder() {
  const actions: UnknownAction[] = [];
  const middleware: Middleware = () => (next) => (action) => {
    const result = next(action);
    if (typeof action === "object" && action !== null && "type" in action) {
      actions.push(action as UnknownAction);
    }
    return result;
  };
  return {
    middleware,
    read: () => actions.map((action) => structuredClone(action)),
  };
}

export function createAssetTrackerStore() {
  const recorder = createActionRecorder();
  const store = configureStore({
    reducer: {
      assetData: assetDataReducer,
      localData: localDataReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        immutableCheck: true,
        serializableCheck: true,
      }).concat(recorder.middleware),
    devTools:
      process.env.NODE_ENV === "production"
        ? false
        : { name: "Personal Finance Asset Tracker", trace: true },
  });
  return Object.assign(store, { getActionLog: recorder.read });
}

export type AssetTrackerStore = ReturnType<typeof createAssetTrackerStore>;
export type AssetTrackerState = ReturnType<AssetTrackerStore["getState"]>;
export type AssetTrackerDispatch = AssetTrackerStore["dispatch"];

export const useAssetTrackerDispatch =
  useDispatch.withTypes<AssetTrackerDispatch>();
export const useAssetTrackerSelector =
  useSelector.withTypes<AssetTrackerState>();
export const useAssetTrackerStore = useStore.withTypes<AssetTrackerStore>();

export const selectAssetTrackerData = (state: AssetTrackerState) =>
  state.assetData.value;
export const selectHasLocalChanges = (state: AssetTrackerState) =>
  state.assetData.hasLocalChanges;
export const selectLocalDataStatus = (state: AssetTrackerState) =>
  state.localData.status;
export const selectLocalDataError = (state: AssetTrackerState) =>
  state.localData.error;

export function replayAssetTrackerActions(actions: readonly UnknownAction[]) {
  return actions.reduce(
    (state, action) => ({
      assetData: assetDataReducer(state.assetData, action),
      localData: localDataReducer(state.localData, action),
    }),
    {
      assetData: initialAssetDataState(),
      localData: initialLocalDataState(),
    },
  );
}
