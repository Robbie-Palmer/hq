import {
  configureStore,
  createListenerMiddleware,
  createSlice,
  type Middleware,
  type UnknownAction,
} from "@reduxjs/toolkit";
import {
  type CookingTimerEffectAdapters,
  CookingTimerRuntime,
  createBrowserCookingTimerEffectAdapters,
  registerCookingTimerListeners,
} from "./cookingTimerEffects";
import {
  type CookingTimerPersistence,
  createCookingTimerPersistence,
} from "./cookingTimerPersistence";
import {
  type CustomTimerInput,
  cookingTimerEvents,
  cookingTimersSlice,
  type StartTimerInput,
} from "./cookingTimersSlice";

type RecipeSessionState = { userId: string | null };
const MAX_REPLAY_ACTIONS = 500;

export const recipeSessionSlice = createSlice({
  name: "recipeSession",
  initialState: { userId: null } as RecipeSessionState,
  reducers: {
    ownerChanged(state, { payload }: { payload: { userId: string | null } }) {
      state.userId = payload.userId;
    },
  },
});

export type RecipeClientState = {
  cookingTimers: ReturnType<typeof cookingTimersSlice.reducer>;
  recipeSession: RecipeSessionState;
};

function createUnavailablePersistence(): CookingTimerPersistence {
  return {
    clearAll() {},
    keyFor: (userId) => `cooking-timers:v2:${encodeURIComponent(userId)}`,
    load: () => [],
    removeLegacy() {},
    save() {},
  };
}

function createDefaultAdapters(): CookingTimerEffectAdapters {
  let persistence: CookingTimerPersistence;
  try {
    persistence = globalThis.localStorage
      ? createCookingTimerPersistence(globalThis.localStorage)
      : createUnavailablePersistence();
  } catch {
    persistence = createUnavailablePersistence();
  }
  return createBrowserCookingTimerEffectAdapters(persistence);
}

function cloneAction(action: UnknownAction): UnknownAction {
  return JSON.parse(JSON.stringify(action)) as UnknownAction;
}

export function createRecipeClientStore(
  adapters: CookingTimerEffectAdapters = createDefaultAdapters(),
) {
  const actionLog: UnknownAction[] = [];
  const actionLogMiddleware: Middleware<object, RecipeClientState> =
    (api) => (next) => (action) => {
      if (
        typeof action === "object" &&
        action !== null &&
        "type" in action &&
        typeof action.type === "string" &&
        (action.type.startsWith("cookingTimers/") ||
          action.type.startsWith("recipeSession/"))
      ) {
        if (actionLog.length >= MAX_REPLAY_ACTIONS) {
          const state = api.getState();
          actionLog.splice(
            0,
            actionLog.length,
            recipeSessionSlice.actions.ownerChanged({
              userId: state.recipeSession.userId,
            }),
            cookingTimerEvents.timerStateHydrated({
              timers: state.cookingTimers.timers,
            }),
          );
        }
        actionLog.push(cloneAction(action as UnknownAction));
      }
      return next(action);
    };
  const listener = createListenerMiddleware<RecipeClientState>();
  const runtime = new CookingTimerRuntime(adapters);
  registerCookingTimerListeners(
    listener,
    adapters,
    runtime,
    recipeSessionSlice.actions.ownerChanged,
  );

  const store = configureStore({
    reducer: {
      cookingTimers: cookingTimersSlice.reducer,
      recipeSession: recipeSessionSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(listener.middleware, actionLogMiddleware),
    devTools:
      process.env.NODE_ENV === "production"
        ? false
        : { name: "Recipe Site", trace: true },
  });

  const start = (input: StartTimerInput) => {
    store.dispatch(
      cookingTimerEvents.timerStarted({
        input,
        nowMs: adapters.clock.now(),
      }),
    );
  };
  const commands = {
    clearAll() {
      store.dispatch(cookingTimerEvents.allTimersCleared());
    },
    dismiss(id: string) {
      store.dispatch(cookingTimerEvents.timerDismissed({ id }));
    },
    extend(id: string, seconds = 60) {
      store.dispatch(
        cookingTimerEvents.timerExtended({
          id,
          seconds,
          nowMs: adapters.clock.now(),
        }),
      );
    },
    pause(id: string) {
      store.dispatch(
        cookingTimerEvents.timerPaused({ id, nowMs: adapters.clock.now() }),
      );
    },
    resume(id: string) {
      store.dispatch(
        cookingTimerEvents.timerResumed({ id, nowMs: adapters.clock.now() }),
      );
    },
    start,
    startCustom(input: CustomTimerInput): string {
      const id = `custom:${adapters.ids.next()}`;
      start({ ...input, id });
      return id;
    },
  };

  return {
    actionLog: {
      clear: () => {
        actionLog.length = 0;
      },
      read: (): readonly UnknownAction[] => actionLog.map(cloneAction),
    },
    adapters,
    commands,
    runtime,
    store,
  };
}

export type RecipeClientStoreBundle = ReturnType<
  typeof createRecipeClientStore
>;
export type RecipeClientStore = RecipeClientStoreBundle["store"];
export type RecipeClientDispatch = RecipeClientStore["dispatch"];
export type CookingTimerCommands = RecipeClientStoreBundle["commands"];

export function dispatchRequiredCookingTimerEvent(
  bundle: RecipeClientStoreBundle,
  action: UnknownAction,
  accepted: (state: RecipeClientState) => boolean,
): void {
  bundle.store.dispatch(action);
  if (accepted(bundle.store.getState())) return;
  throw new Error(
    `Cooking timer event was rejected. Replayable action sequence:\n${JSON.stringify(
      bundle.actionLog.read(),
      null,
      2,
    )}`,
  );
}
