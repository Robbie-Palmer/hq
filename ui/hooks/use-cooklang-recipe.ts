"use client";

import type { CooklangParser, CooklangRecipe } from "@cooklang/cooklang";
import { useEffect, useState } from "react";

type ParsedRecipe = CooklangRecipe;

export interface ParsedRecipeSource {
  cookBody: string;
  scale: number | undefined;
}

export interface UseCooklangRecipeState {
  recipe: ParsedRecipe | null;
  /** Inputs that produced `recipe`. May lag behind the current request while a
   * new parse is in flight — callers that overlay results onto downstream
   * state must check this before using `recipe`. */
  source: ParsedRecipeSource | null;
  loading: boolean;
  error: Error | null;
}

let parserPromise: Promise<CooklangParser> | null = null;
const MAX_PARSE_CACHE_SIZE = 50;
const parsePromiseCache = new Map<string, Promise<ParsedRecipe>>();

function getCacheKey(cookBody: string, scale?: number): string {
  return `${scale ?? "default"}::${cookBody}`;
}

async function getParser(): Promise<CooklangParser> {
  if (parserPromise) {
    return parserPromise;
  }

  parserPromise = (async () => {
    try {
      const module = await import("@cooklang/cooklang");
      return new module.CooklangParser();
    } catch (error) {
      parserPromise = null;
      throw error;
    }
  })();

  return parserPromise;
}

function getMemoizedParsePromise(
  cookBody: string,
  scale?: number,
): Promise<ParsedRecipe> {
  const cacheKey = getCacheKey(cookBody, scale);
  const existingPromise = parsePromiseCache.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const parsePromise = (async () => {
    try {
      const parser = await getParser();
      const [recipe] = parser.parse(cookBody, scale);
      return recipe;
    } catch (error) {
      parsePromiseCache.delete(cacheKey);
      throw error;
    }
  })();

  parsePromiseCache.set(cacheKey, parsePromise);
  if (parsePromiseCache.size > MAX_PARSE_CACHE_SIZE) {
    parsePromiseCache.delete(parsePromiseCache.keys().next().value!);
  }
  return parsePromise;
}

export function useCooklangRecipe(
  cookBody: string,
  scale?: number,
): UseCooklangRecipeState {
  const [state, setState] = useState<UseCooklangRecipeState>({
    recipe: null,
    source: null,
    loading: Boolean(cookBody),
    error: null,
  });

  useEffect(() => {
    if (!cookBody) {
      setState({ recipe: null, source: null, loading: false, error: null });
      return;
    }

    let isActive = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    void (async () => {
      try {
        const recipe = await getMemoizedParsePromise(cookBody, scale);
        if (!isActive) {
          return;
        }

        setState({
          recipe,
          source: { cookBody, scale },
          loading: false,
          error: null,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }

        setState({
          recipe: null,
          source: null,
          loading: false,
          error:
            error instanceof Error
              ? error
              : new Error("Failed to parse Cooklang recipe"),
        });
      }
    })();

    return () => {
      isActive = false;
    };
  }, [cookBody, scale]);

  return state;
}
