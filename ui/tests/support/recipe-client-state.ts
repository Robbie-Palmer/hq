import type { CookingTimerEffectAdapters } from "@/lib/cooking/cookingTimerEffects";
import { createCookingTimerPersistence } from "@/lib/cooking/cookingTimerPersistence";
import {
  createRecipeClientStore,
  type RecipeClientStoreBundle,
  recipeSessionSlice,
} from "@/lib/cooking/recipeClientStore";

export function createTestRecipeClientStore() {
  let idSequence = 0;
  const adapters: CookingTimerEffectAdapters = {
    analytics: { timerStarted() {} },
    audio: { playAlert() {}, unlock() {} },
    clock: { now: () => Date.now() },
    ids: {
      next() {
        idSequence += 1;
        return `test-${idSequence}`;
      },
    },
    persistence: createCookingTimerPersistence(localStorage),
    scheduler: {
      clearInterval: (handle) => globalThis.clearInterval(handle),
      setInterval: (callback, delayMs) =>
        globalThis.setInterval(callback, delayMs),
    },
    wakeLock: { release() {}, retain() {} },
  };
  return createRecipeClientStore(adapters);
}

export function changeTestRecipeOwner(
  bundle: RecipeClientStoreBundle,
  userId: string | undefined,
): void {
  bundle.store.dispatch(
    recipeSessionSlice.actions.ownerChanged({ userId: userId ?? null }),
  );
}
