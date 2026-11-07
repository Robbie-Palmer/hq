"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";
import { Provider } from "react-redux";
import {
  createRecipeClientStore,
  type RecipeClientStoreBundle,
} from "@/lib/cooking/recipeClientStore";

const RecipeClientStateContext = createContext<RecipeClientStoreBundle | null>(
  null,
);

export function createRecipeClientStateProvider(
  createStore: () => RecipeClientStoreBundle = createRecipeClientStore,
) {
  return function RecipeClientStateProvider({
    children,
    bundle,
  }: Readonly<{
    children: ReactNode;
    bundle?: RecipeClientStoreBundle;
  }>) {
    const bundleRef = useRef<RecipeClientStoreBundle | null>(null);
    bundleRef.current ??= bundle ?? createStore();
    const activeBundle = bundleRef.current;

    useEffect(() => {
      activeBundle.runtime.start(activeBundle.store);
      return () => activeBundle.runtime.stop();
    }, [activeBundle]);

    return (
      <RecipeClientStateContext.Provider value={activeBundle}>
        <Provider store={activeBundle.store}>{children}</Provider>
      </RecipeClientStateContext.Provider>
    );
  };
}

export const RecipeClientStateProvider = createRecipeClientStateProvider();

export function useRecipeClientState(): RecipeClientStoreBundle {
  const bundle = useContext(RecipeClientStateContext);
  if (!bundle) {
    throw new Error(
      "Recipe client state is only available inside RecipeClientStateProvider",
    );
  }
  return bundle;
}
