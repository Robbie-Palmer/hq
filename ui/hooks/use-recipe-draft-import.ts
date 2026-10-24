import { useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api/http";

export type RecipeAddMethod = "write" | "url" | "photo" | "file";

export type ImportedRecipeDraft = {
  title: string;
  description: string;
  cuisine: string;
  servings: number;
  prepTime?: number;
  cookTime?: number;
  source: string;
  url?: string;
};

type ImportRequest = {
  id: number;
  controller: AbortController;
};

const MAX_RECIPE_FILE_LENGTH = 100_000;

class RecipeFileImportError extends Error {}

function isImportedRecipe(value: unknown): value is ImportedRecipeDraft {
  if (!value || typeof value !== "object") return false;
  const recipe = value as Record<string, unknown>;
  return (
    typeof recipe.title === "string" &&
    typeof recipe.description === "string" &&
    typeof recipe.cuisine === "string" &&
    typeof recipe.servings === "number" &&
    (recipe.prepTime === undefined || typeof recipe.prepTime === "number") &&
    (recipe.cookTime === undefined || typeof recipe.cookTime === "number") &&
    typeof recipe.source === "string" &&
    (recipe.url === undefined || typeof recipe.url === "string")
  );
}

function requestIsStale(
  current: ImportRequest | null,
  request: ImportRequest,
): boolean {
  return request.controller.signal.aborted || current?.id !== request.id;
}

async function fetchUrlRecipeDraft(
  url: string,
  signal: AbortSignal,
): Promise<ImportedRecipeDraft> {
  const body = await apiRequest<unknown>("/api/recipe-drafts/url", {
    method: "POST",
    json: { url },
    signal,
    fallbackMessage: "The recipe could not be imported.",
  });
  if (!isImportedRecipe(body)) {
    throw new Error("The recipe could not be imported.");
  }
  return body;
}

async function fetchFileRecipeDraft(
  file: File,
  signal: AbortSignal,
): Promise<ImportedRecipeDraft> {
  if (file.size > MAX_RECIPE_FILE_LENGTH) {
    throw new RecipeFileImportError(
      "Choose a recipe file smaller than 100 KB.",
    );
  }
  const content = await file.text();
  const body = await apiRequest<unknown>("/api/recipe-drafts/file", {
    method: "POST",
    json: { filename: file.name, content },
    signal,
    fallbackMessage: "The recipe file could not be imported.",
  });
  if (!isImportedRecipe(body)) {
    throw new RecipeFileImportError("The recipe file could not be imported.");
  }
  return body;
}

function fileImportErrorMessage(error: unknown): string {
  return error instanceof RecipeFileImportError || error instanceof ApiError
    ? error.message
    : "The recipe file could not be imported.";
}

export function useRecipeDraftImport(
  applyImportedRecipe: (recipe: ImportedRecipeDraft) => void,
) {
  const [method, setMethod] = useState<RecipeAddMethod>("write");
  const [recipeUrl, setRecipeUrl] = useState("");
  const [recipeFile, setRecipeFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [urlImportSuccess, setUrlImportSuccess] = useState(false);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const requestRef = useRef<ImportRequest | null>(null);
  const nextRequestIdRef = useRef(0);

  function invalidateRequest() {
    requestRef.current?.controller.abort();
    requestRef.current = null;
    setImporting(false);
  }

  function beginRequest(): ImportRequest {
    invalidateRequest();
    const request = {
      id: ++nextRequestIdRef.current,
      controller: new AbortController(),
    };
    requestRef.current = request;
    setImporting(true);
    setImportError(null);
    return request;
  }

  function finishRequest(request: ImportRequest) {
    if (requestRef.current?.id !== request.id) return;
    requestRef.current = null;
    setImporting(false);
  }

  async function importRecipeUrl() {
    const url = recipeUrl.trim();
    if (!url || importing) return;
    const request = beginRequest();
    setUrlImportSuccess(false);
    try {
      const recipe = await fetchUrlRecipeDraft(url, request.controller.signal);
      if (requestIsStale(requestRef.current, request)) return;
      applyImportedRecipe(recipe);
      setRecipeUrl(recipe.url ?? url);
      setUrlImportSuccess(true);
      setImportedFileName(null);
    } catch (error) {
      if (requestIsStale(requestRef.current, request)) return;
      setImportError(
        error instanceof Error
          ? error.message
          : "The recipe could not be imported.",
      );
    } finally {
      finishRequest(request);
    }
  }

  async function importRecipeFile() {
    if (!recipeFile || importing) return;
    const request = beginRequest();
    setImportedFileName(null);
    try {
      const recipe = await fetchFileRecipeDraft(
        recipeFile,
        request.controller.signal,
      );
      if (requestIsStale(requestRef.current, request)) return;
      applyImportedRecipe(recipe);
      setImportedFileName(recipeFile.name);
      setUrlImportSuccess(false);
    } catch (error) {
      if (requestIsStale(requestRef.current, request)) return;
      setImportError(fileImportErrorMessage(error));
    } finally {
      finishRequest(request);
    }
  }

  function selectMethod(nextMethod: RecipeAddMethod) {
    invalidateRequest();
    setImportError(null);
    setImportedFileName(null);
    setUrlImportSuccess(false);
    setMethod(nextMethod);
  }

  function updateRecipeFile(file: File | null) {
    invalidateRequest();
    setRecipeFile(file);
    setImportError(null);
    setImportedFileName(null);
  }

  function updateRecipeUrl(url: string) {
    invalidateRequest();
    setRecipeUrl(url);
    setImportError(null);
  }

  function resetImportResult() {
    setUrlImportSuccess(false);
    setImportedFileName(null);
  }

  return {
    cancelImport: invalidateRequest,
    importError,
    importedFileName,
    importing,
    importRecipeFile,
    importRecipeUrl,
    method,
    recipeFile,
    recipeUrl,
    resetImportResult,
    selectMethod,
    setRecipeFile: updateRecipeFile,
    setRecipeUrl: updateRecipeUrl,
    urlImportSuccess,
  };
}
