"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { isAbortError } from "browser-base/errors";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  FileText,
  FileUp,
  Globe2,
  Home,
  Loader2,
  LockKeyhole,
  PenLine,
  Save,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RecipeVisibility } from "recipe-domain/visibility";
import {
  PhotoRecipeImport,
  type PhotoRecipeImportDraft,
} from "@/components/recipes/photo-recipe-import";
import { RecipeContent } from "@/components/recipes/recipe-content";
import { RecipeLoadError } from "@/components/recipes/recipe-load-state";
import { navigateToRecipePage } from "@/components/recipes/recipe-page-link";
import { SpellcheckEditor } from "@/components/recipes/spellcheck-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCooklangRecipe } from "@/hooks/use-cooklang-recipe";
import { getHouseholds } from "@/lib/api/households";
import { ApiError, apiRequest } from "@/lib/api/http";
import { authClient } from "@/lib/auth-client";
import {
  buildRecipeDraft,
  normalizeRecipeSource,
  parseSavedRecipePayload,
  type SavedRecipeApiRecord,
  serializeSavedRecipe,
} from "@/lib/domain/recipe/recipeDraft";
import { recipeSaveReturnPath } from "@/lib/generic/safe-return-path";
import { normalizeSlug } from "@/lib/generic/slugs";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

const EXAMPLE_RECIPE = `Bring a large #pot{} of salted water to the boil. Add @dried pasta{200%g} and cook for ~{10%minutes}.

Meanwhile, warm @olive oil{2%tbsp} in a #frying pan{}. Add @garlic{2%cloves} and cook for ~{2%minutes}.

Stir in @chopped tomatoes{400%g} and simmer for ~{15%minutes}. Drain the pasta, toss it through the sauce, and serve.`;

type AddMethod = "write" | "url" | "photo" | "file";

type ImportedRecipe = {
  title: string;
  description: string;
  cuisine: string;
  servings: number;
  prepTime?: number;
  cookTime?: number;
  source: string;
  url?: string;
};

function isImportedRecipe(value: unknown): value is ImportedRecipe {
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

async function invalidateSavedRecipeQueries({
  queryClient,
  userId,
  slug,
  visibility,
  previousVisibility,
}: {
  queryClient: QueryClient;
  userId: string | null;
  slug: string;
  visibility: RecipeVisibility;
  previousVisibility?: RecipeVisibility;
}) {
  if (!userId) return;
  const invalidations = [
    queryClient.invalidateQueries({
      queryKey: recipeQueryKeys.bootstrap(userId),
    }),
    queryClient.invalidateQueries({
      queryKey: recipeQueryKeys.savedRecipe(userId, slug),
    }),
    queryClient.invalidateQueries({
      queryKey: recipeQueryKeys.publicRecipes(),
    }),
  ];
  if (visibility === "public" || previousVisibility === "public") {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.publicDiscoverFeed(),
      }),
    );
  }
  if (
    visibility !== "private" ||
    (previousVisibility !== undefined && previousVisibility !== "private")
  ) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.followingDiscoverFeed(userId),
      }),
    );
  }
  await Promise.all(invalidations);
}

const MAX_RECIPE_FILE_LENGTH = 100_000;

class RecipeFileImportError extends Error {}

type ImportRequest = {
  id: number;
  controller: AbortController;
};

function importRequestIsStale(
  current: ImportRequest | null,
  request: ImportRequest,
): boolean {
  return request.controller.signal.aborted || current?.id !== request.id;
}

function finishImportRequest(
  requestRef: { current: ImportRequest | null },
  request: ImportRequest,
  setImporting: (importing: boolean) => void,
) {
  if (requestRef.current?.id !== request.id) return;
  requestRef.current = null;
  setImporting(false);
}

async function fetchUrlRecipeDraft(
  url: string,
  signal: AbortSignal,
): Promise<ImportedRecipe> {
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
): Promise<ImportedRecipe> {
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

function recipeSaveErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "A recipe with this name already exists. Choose a different name.";
  }
  return error instanceof Error
    ? error.message
    : "The recipe could not be saved.";
}

async function persistRecipe({
  description,
  initialRecipe,
  preview,
  source,
  title,
  visibility,
}: {
  description: string;
  initialRecipe?: SavedRecipeApiRecord;
  preview: ReturnType<typeof buildRecipeDraft>;
  source: string;
  title: string;
  visibility: RecipeVisibility;
}): Promise<{ slug: string }> {
  const endpoint = initialRecipe
    ? `/api/recipes/${encodeURIComponent(initialRecipe.slug)}`
    : "/api/recipes";
  const recipeBody = {
    title: title.trim(),
    description: description.trim(),
    body: serializeSavedRecipe(source, preview),
    visibility,
  };
  return apiRequest<{ slug: string }>(endpoint, {
    method: initialRecipe ? "PATCH" : "POST",
    json: initialRecipe
      ? recipeBody
      : { ...recipeBody, slug: normalizeSlug(title) },
    fallbackMessage: "The recipe could not be saved.",
  });
}

function RecipeEditorGate({
  unreadable,
  pending,
  authenticated,
  children,
}: Readonly<{
  unreadable: boolean;
  pending: boolean;
  authenticated: boolean;
  children: ReactNode;
}>) {
  if (unreadable) {
    return (
      <RecipeLoadError
        title="Recipe unavailable"
        message="This recipe's saved content could not be read. Editing is disabled to avoid overwriting it."
      />
    );
  }
  if (pending) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (!authenticated) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <FileText className="mx-auto size-10 text-[var(--terracotta)]" />
        <h1 className="rt-display mt-4 text-5xl">Log in to save a recipe</h1>
        <p className="rt-body mt-3 text-[var(--ink-2)]">
          Use the log-in button above, then come back to add recipes to your
          private recipe box.
        </p>
        <Button asChild variant="outline" className="mt-6 rounded-full">
          <Link href="/recipes">
            <ArrowLeft /> Back to recipes
          </Link>
        </Button>
      </div>
    );
  }
  return children;
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
}: Readonly<{
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
}>) {
  const id = useId();
  return (
    <label htmlFor={id} className="grid gap-1.5">
      <span className="rt-mono text-[var(--ink-3)]">{label}</span>
      <Input
        id={id}
        type="number"
        min={min}
        value={value ?? ""}
        onChange={(event) => {
          if (!event.target.value) {
            onChange(undefined);
            return;
          }
          const nextValue = Number(event.target.value);
          onChange(
            Number.isInteger(nextValue) && nextValue >= min
              ? nextValue
              : undefined,
          );
        }}
        className="border-[var(--line-strong)] bg-[var(--card)]"
      />
    </label>
  );
}

function recipeEditorCopy(editing: boolean) {
  return editing
    ? {
        action: "Save changes",
        description:
          "Update the Cooklang recipe and review every change in the live preview.",
        heading: "Edit",
      }
    : {
        action: "Save recipe",
        description:
          "Enter a recipe manually, import a webpage or local file, or scan a recipe photo. Every method feeds the same editable preview.",
        heading: "Add a",
      };
}

const ADD_METHODS = [
  ["write", PenLine, "Manual entry", "px-3"],
  ["url", Globe2, "Import URL", "px-3"],
  ["photo", Camera, "Scan photo", "px-2"],
  ["file", FileUp, "Upload file", "px-2"],
] as const;

function RecipeImportControls({
  editing,
  fileInputId,
  importError,
  importedFileName,
  importing,
  method,
  onFileChange,
  onFileImport,
  onMethodChange,
  onPhotoDraft,
  onUrlChange,
  onUrlImport,
  recipeFile,
  recipeUrl,
  urlImportSuccess,
}: Readonly<{
  editing: boolean;
  fileInputId: string;
  importError: string | null;
  importedFileName: string | null;
  importing: boolean;
  method: AddMethod;
  onFileChange: (file: File | null) => void;
  onFileImport: () => Promise<void>;
  onMethodChange: (method: AddMethod) => void;
  onPhotoDraft: (draft: PhotoRecipeImportDraft) => void;
  onUrlChange: (url: string) => void;
  onUrlImport: () => Promise<void>;
  recipeFile: File | null;
  recipeUrl: string;
  urlImportSuccess: boolean;
}>) {
  if (editing) return null;
  return (
    <>
      <fieldset
        className="grid grid-cols-2 rounded-lg border border-[var(--line-strong)] bg-[var(--paper-warm)] p-1 sm:grid-cols-4"
        aria-label="Choose how to add a recipe"
      >
        {ADD_METHODS.map(([value, Icon, label, padding]) => (
          <button
            key={value}
            type="button"
            onClick={() => onMethodChange(value)}
            aria-pressed={method === value}
            className={`rt-mono inline-flex items-center justify-center gap-2 rounded-md py-2 text-sm transition-colors ${padding} ${
              method === value
                ? "bg-[var(--card)] text-[var(--ink)] shadow-sm"
                : "text-[var(--ink-3)] hover:text-[var(--ink)]"
            }`}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </fieldset>
      {method === "url" && (
        <div className="grid gap-2 rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--paper-warm)] p-3">
          <label htmlFor="recipe-import-url" className="grid gap-1.5">
            <span className="rt-mono text-[var(--ink-3)]">
              Recipe webpage URL
            </span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="recipe-import-url"
                type="url"
                value={recipeUrl}
                onChange={(event) => onUrlChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void onUrlImport();
                  }
                }}
                placeholder="https://example.com/recipes/tomato-pasta"
                className="min-w-0 flex-1 border-[var(--line-strong)] bg-[var(--paper)]"
              />
              <Button
                type="button"
                onClick={() => void onUrlImport()}
                disabled={!recipeUrl.trim() || importing}
                className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
              >
                {importing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Globe2 className="size-4" />
                )}
                {importing ? "Importing…" : "Import recipe"}
              </Button>
            </div>
          </label>
          <p className="text-xs text-[var(--ink-3)]">
            The page must publish schema.org Recipe data with a name,
            ingredients and instructions.
          </p>
          {importError && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {importError}
            </p>
          )}
          {urlImportSuccess && !importError && (
            <output className="text-sm text-[var(--sage)]">
              Imported successfully. You can edit any field before saving.
            </output>
          )}
        </div>
      )}
      {method === "file" && (
        <div className="grid gap-2 rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--paper-warm)] p-3">
          <label htmlFor={fileInputId} className="grid gap-1.5">
            <span className="rt-mono text-[var(--ink-3)]">Recipe file</span>
            <Input
              id={fileInputId}
              type="file"
              accept=".cook,.cooklang,.json,.jsonld,application/json,application/ld+json"
              onChange={(event) =>
                onFileChange(event.target.files?.[0] ?? null)
              }
              className="border-[var(--line-strong)] bg-[var(--paper)] file:mr-3 file:font-medium"
            />
          </label>
          <Button
            type="button"
            onClick={() => void onFileImport()}
            disabled={!recipeFile || importing}
            className="justify-self-start bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
          >
            {importing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileUp className="size-4" />
            )}
            {importing ? "Importing…" : "Import recipe"}
          </Button>
          <p className="text-xs text-[var(--ink-3)]">
            Upload Cooklang (.cook or .cooklang) or schema.org Recipe JSON-LD
            (.json or .jsonld), up to 100 KB.
          </p>
          {importError && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {importError}
            </p>
          )}
          {importedFileName && !importError && (
            <output className="text-sm text-[var(--sage)]">
              Imported {importedFileName}. You can edit any field before saving.
            </output>
          )}
        </div>
      )}
      <div className={method === "photo" ? undefined : "hidden"}>
        <PhotoRecipeImport
          active={method === "photo"}
          onDraftReady={onPhotoDraft}
        />
      </div>
    </>
  );
}

const VISIBILITY_OPTIONS = [
  ["private", LockKeyhole, "Private"],
  ["household", Home, "Household"],
  ["public", Globe2, "Public"],
] as const;

function visibilityDescription(visibility: RecipeVisibility): string {
  if (visibility === "household") {
    return "Everyone in your household can open this recipe.";
  }
  if (visibility === "public") {
    return "Anyone can open this recipe from the public feed.";
  }
  return "Only you can open this recipe.";
}

function RecipeVisibilityPicker({
  hasHousehold,
  householdPending,
  onChange,
  visibility,
}: Readonly<{
  hasHousehold: boolean;
  householdPending: boolean;
  onChange: (visibility: RecipeVisibility) => void;
  visibility: RecipeVisibility;
}>) {
  return (
    <fieldset className="grid gap-2">
      <legend className="rt-mono text-[var(--ink-3)]">
        Who can see this recipe?
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {VISIBILITY_OPTIONS.map(([value, Icon, label]) => {
          const disabled =
            value === "household" && (householdPending || !hasHousehold);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={visibility === value}
              disabled={disabled}
              onClick={() => onChange(value)}
              className={`rt-body inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                visibility === value
                  ? "border-[var(--terracotta)] bg-[var(--butter-soft)] text-[var(--terracotta-deep)]"
                  : "border-[var(--line-strong)] bg-[var(--paper)] text-[var(--ink-3)] hover:text-[var(--ink)]"
              }`}
            >
              <Icon className="size-4" /> {label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[var(--ink-3)]">
        {visibilityDescription(visibility)}
        {!householdPending && !hasHousehold && (
          <> Join a household to share recipes with its members.</>
        )}
      </p>
    </fieldset>
  );
}

function RecipePreviewPanel({
  parseError,
  parseLoading,
  preview,
  previewError,
}: Readonly<{
  parseError: boolean;
  parseLoading: boolean;
  preview: ReturnType<typeof buildRecipeDraft> | null;
  previewError: boolean;
}>) {
  return (
    <section className="min-h-[600px] overflow-hidden rounded-xl border-[1.25px] border-[var(--line-strong)] bg-[var(--paper)]">
      <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper-warm)] px-4 py-3">
        <p className="rt-mono text-[var(--ink-3)]">Live preview</p>
        <div className="flex items-center gap-2">
          <span className="rt-mono text-[var(--ink-4)]">
            Timers activate after saving
          </span>
          {parseLoading && (
            <Loader2 className="size-4 animate-spin text-[var(--terracotta)]" />
          )}
        </div>
      </div>
      {preview ? (
        <div className="px-4 py-6 md:px-8">
          <RecipeContent
            recipe={preview}
            timersEnabled={false}
            shoppingListEnabled={false}
          />
        </div>
      ) : (
        <div className="flex min-h-[540px] flex-col items-center justify-center px-6 text-center">
          <FileText className="size-12 text-[var(--terracotta)]/50" />
          <h2 className="rt-display mt-4 text-4xl">
            Your recipe will appear here
          </h2>
          <p className="rt-body mt-2 max-w-md text-[var(--ink-3)]">
            Add a name and write your steps with inline Cooklang—or use the
            example, URL importer, local file importer, or a recipe photo to see
            ingredients and timers come alive.
          </p>
          {(parseError || previewError) && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              We couldn&apos;t read that recipe yet. Check the Cooklang syntax
              and try again.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function AddRecipeView({
  initialRecipe,
}: Readonly<{ initialRecipe?: SavedRecipeApiRecord }>) {
  const initialPayload = useMemo(
    () => (initialRecipe ? parseSavedRecipePayload(initialRecipe) : null),
    [initialRecipe],
  );
  const editing = Boolean(initialRecipe);
  const editorCopy = recipeEditorCopy(editing);
  const unreadableRecipe = editing && !initialPayload;
  const titleId = useId();
  const descriptionId = useId();
  const cuisineId = useId();
  const recipeFileId = useId();
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const sessionUserId = session?.user.id;
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<AddMethod>("write");
  const [recipeUrl, setRecipeUrl] = useState("");
  const [recipeFile, setRecipeFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [urlImportSuccess, setUrlImportSuccess] = useState(false);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [importedUrl, setImportedUrl] = useState<string | null>(
    initialPayload?.recipe.canonical ?? null,
  );
  const [title, setTitle] = useState(initialRecipe?.title ?? "");
  const [description, setDescription] = useState(
    initialRecipe?.description ?? "",
  );
  const [cuisine, setCuisine] = useState(
    initialPayload?.recipe.cuisine.join(", ") ?? "",
  );
  const [servings, setServings] = useState<number | undefined>(
    initialPayload?.recipe.servings ?? 2,
  );
  const [prepTime, setPrepTime] = useState<number | undefined>(
    initialPayload?.recipe.prepTime,
  );
  const [cookTime, setCookTime] = useState<number | undefined>(
    initialPayload?.recipe.cookTime,
  );
  const [source, setSource] = useState(initialPayload?.source ?? "");
  const [visibility, setVisibility] = useState<RecipeVisibility>(
    initialRecipe?.visibility ?? "private",
  );
  const [householdPending, setHouseholdPending] = useState(true);
  const [hasHousehold, setHasHousehold] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const visibilityTouchedRef = useRef(editing);
  const importRequestRef = useRef<ImportRequest | null>(null);
  const nextImportRequestIdRef = useRef(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cooklang = useMemo(() => normalizeRecipeSource(source), [source]);
  const parse = useCooklangRecipe(cooklang);

  useEffect(() => {
    if (sessionPending) return;
    if (!sessionUserId) {
      visibilityTouchedRef.current = false;
      setHouseholdPending(false);
      setHasHousehold(false);
      setVisibility("private");
      return;
    }

    const controller = new AbortController();
    visibilityTouchedRef.current = editing;
    setHouseholdPending(true);
    void getHouseholds(controller.signal)
      .then((households) => {
        const available = households.length > 0;
        setHasHousehold(available);
        if (!visibilityTouchedRef.current) {
          setVisibility(available ? "household" : "private");
        }
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        setHasHousehold(false);
        if (!visibilityTouchedRef.current) setVisibility("private");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHouseholdPending(false);
      });
    return () => controller.abort();
  }, [editing, sessionPending, sessionUserId]);

  const previewResult = useMemo(() => {
    if (!parse.recipe || !title.trim() || !description.trim() || !servings)
      return { recipe: null, error: false };
    try {
      return {
        recipe: buildRecipeDraft(
          parse.recipe,
          {
            title,
            description,
            date: initialPayload?.recipe.date,
            cuisine,
            servings,
            prepTime,
            cookTime,
            canonical: importedUrl ?? undefined,
          },
          source,
        ),
        error: false,
      };
    } catch {
      return { recipe: null, error: true };
    }
  }, [
    parse.recipe,
    title,
    description,
    initialPayload?.recipe.date,
    cuisine,
    servings,
    prepTime,
    cookTime,
    importedUrl,
    source,
  ]);
  const preview = previewResult.recipe;

  const applyImportedRecipe = useCallback((recipe: ImportedRecipe) => {
    setTitle(recipe.title);
    setDescription(recipe.description);
    setCuisine(recipe.cuisine);
    setServings(recipe.servings);
    setPrepTime(recipe.prepTime);
    setCookTime(recipe.cookTime);
    setSource(recipe.source);
    setImportedUrl(recipe.url ?? null);
  }, []);

  async function importRecipeUrl() {
    if (!recipeUrl.trim() || importing) return;
    importRequestRef.current?.controller.abort();
    const request = {
      id: ++nextImportRequestIdRef.current,
      controller: new AbortController(),
    };
    importRequestRef.current = request;
    setImporting(true);
    setImportError(null);
    setUrlImportSuccess(false);
    try {
      const importedRecipe = await fetchUrlRecipeDraft(
        recipeUrl.trim(),
        request.controller.signal,
      );
      if (importRequestIsStale(importRequestRef.current, request)) return;
      applyImportedRecipe(importedRecipe);
      setRecipeUrl(importedRecipe.url ?? recipeUrl.trim());
      setUrlImportSuccess(true);
      setImportedFileName(null);
    } catch (error) {
      if (importRequestIsStale(importRequestRef.current, request)) return;
      setImportError(
        error instanceof Error
          ? error.message
          : "The recipe could not be imported.",
      );
    } finally {
      finishImportRequest(importRequestRef, request, setImporting);
    }
  }

  async function importRecipeFile() {
    if (!recipeFile || importing) return;
    importRequestRef.current?.controller.abort();
    const request = {
      id: ++nextImportRequestIdRef.current,
      controller: new AbortController(),
    };
    importRequestRef.current = request;
    setImporting(true);
    setImportError(null);
    setImportedFileName(null);
    try {
      const importedRecipe = await fetchFileRecipeDraft(
        recipeFile,
        request.controller.signal,
      );
      if (importRequestIsStale(importRequestRef.current, request)) return;
      applyImportedRecipe(importedRecipe);
      setImportedFileName(recipeFile.name);
      setUrlImportSuccess(false);
    } catch (error) {
      if (importRequestIsStale(importRequestRef.current, request)) return;
      setImportError(fileImportErrorMessage(error));
    } finally {
      finishImportRequest(importRequestRef, request, setImporting);
    }
  }

  function invalidateImportRequest() {
    importRequestRef.current?.controller.abort();
    importRequestRef.current = null;
    setImporting(false);
  }

  function selectMethod(nextMethod: AddMethod) {
    invalidateImportRequest();
    setImportError(null);
    setImportedFileName(null);
    setUrlImportSuccess(false);
    setMethod(nextMethod);
  }

  const applyPhotoDraft = useCallback((draft: PhotoRecipeImportDraft) => {
    const { frontmatter, body } = draft.cooklang;
    setTitle(frontmatter.title ?? draft.recipe.title);
    setDescription(frontmatter.description ?? draft.recipe.description);
    setCuisine((frontmatter.cuisine ?? draft.recipe.cuisine ?? []).join(", "));
    setServings(frontmatter.servings ?? draft.recipe.servings);
    setPrepTime(draft.recipe.prepTime);
    setCookTime(draft.recipe.cookTime);
    setSource(body);
    setImportedUrl(null);
    setUrlImportSuccess(false);
    setImportedFileName(null);
  }, []);

  async function saveRecipe() {
    if (!preview || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await persistRecipe({
        description,
        initialRecipe,
        preview,
        source,
        title,
        visibility,
      });
      await invalidateSavedRecipeQueries({
        queryClient,
        userId: sessionUserId ?? null,
        slug: initialRecipe?.slug ?? saved.slug,
        visibility,
        previousVisibility: initialRecipe?.visibility,
      });
      if (initialRecipe) {
        navigateToRecipePage(saved);
        return;
      }
      const returnTo = new URLSearchParams(window.location.search).get(
        "returnTo",
      );
      const safeReturnTo = recipeSaveReturnPath(
        returnTo,
        saved.slug,
        window.location.origin,
      );
      if (safeReturnTo) {
        router.push(safeReturnTo);
      } else {
        navigateToRecipePage(saved);
      }
    } catch (error) {
      setSaveError(recipeSaveErrorMessage(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const editor = (
    <div className="container mx-auto max-w-[1600px] px-4 py-6 md:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/recipes"
            className="rt-mono inline-flex items-center gap-1 text-[var(--ink-3)] hover:text-[var(--terracotta)]"
          >
            <ArrowLeft className="size-3.5" /> Recipe box
          </Link>
          <h1 className="rt-display mt-2 text-5xl sm:text-6xl">
            {editorCopy.heading}{" "}
            <span className="text-[var(--terracotta)]">recipe</span>
          </h1>
          <p className="rt-body mt-2 text-[var(--ink-2)]">
            {editorCopy.description}
          </p>
        </div>
        <Button
          onClick={saveRecipe}
          disabled={!preview || saving || householdPending}
          className="rounded-full bg-[var(--ink)] px-5 text-[var(--paper)] hover:bg-[var(--terracotta-deep)]"
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}{" "}
          {editorCopy.action}
        </Button>
      </div>

      {saveError && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="size-4" />
          {saveError}
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(380px,0.8fr)_minmax(540px,1.2fr)]">
        <section className="rounded-xl border-[1.25px] border-[var(--line-strong)] bg-[var(--card)] p-4 shadow-[var(--paper-shadow)] xl:sticky xl:top-24">
          <div className="grid gap-4">
            <RecipeImportControls
              editing={editing}
              fileInputId={recipeFileId}
              importError={importError}
              importedFileName={importedFileName}
              importing={importing}
              method={method}
              onFileChange={(file) => {
                invalidateImportRequest();
                setRecipeFile(file);
                setImportError(null);
                setImportedFileName(null);
              }}
              onFileImport={importRecipeFile}
              onMethodChange={selectMethod}
              onPhotoDraft={applyPhotoDraft}
              onUrlChange={(url) => {
                invalidateImportRequest();
                setRecipeUrl(url);
                setImportError(null);
              }}
              onUrlImport={importRecipeUrl}
              recipeFile={recipeFile}
              recipeUrl={recipeUrl}
              urlImportSuccess={urlImportSuccess}
            />

            <label htmlFor={titleId} className="grid gap-1.5">
              <span className="rt-mono text-[var(--ink-3)]">Recipe name</span>
              <Input
                id={titleId}
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Weeknight tomato pasta"
                className="border-[var(--line-strong)] bg-[var(--paper)] text-lg"
              />
            </label>
            <label htmlFor={descriptionId} className="grid gap-1.5">
              <span className="rt-mono text-[var(--ink-3)]">
                Short description
              </span>
              <Input
                id={descriptionId}
                value={description}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="A quick, cosy pasta for busy evenings"
                className="border-[var(--line-strong)] bg-[var(--paper)]"
              />
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
              <NumberField
                label="Servings"
                value={servings}
                min={1}
                onChange={setServings}
              />
              <NumberField
                label="Prep minutes"
                value={prepTime}
                onChange={setPrepTime}
              />
              <NumberField
                label="Cook minutes"
                value={cookTime}
                onChange={setCookTime}
              />
              <label htmlFor={cuisineId} className="grid gap-1.5">
                <span className="rt-mono text-[var(--ink-3)]">Cuisine</span>
                <Input
                  id={cuisineId}
                  value={cuisine}
                  onChange={(event) => setCuisine(event.target.value)}
                  placeholder="Italian"
                  className="border-[var(--line-strong)] bg-[var(--card)]"
                />
              </label>
            </div>
            <RecipeVisibilityPicker
              hasHousehold={hasHousehold}
              householdPending={householdPending}
              onChange={(nextVisibility) => {
                visibilityTouchedRef.current = true;
                setVisibility(nextVisibility);
              }}
              visibility={visibility}
            />
            <div className="flex items-center justify-between gap-3 border-t border-dashed border-[var(--line-strong)] pt-3">
              <div>
                <p className="rt-mono text-[var(--ink-3)]">Recipe text</p>
                <p className="text-xs text-[var(--ink-3)]">
                  {method === "url" || method === "photo" || method === "file"
                    ? "Imported as editable Cooklang. Adjust anything before saving."
                    : "Use @ingredients, #cookware and ~timers directly in each step."}
                </p>
              </div>
              {!editing && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => {
                    invalidateImportRequest();
                    setTitle("Weeknight tomato pasta");
                    setDescription("A quick, cosy pasta for busy evenings.");
                    setCuisine("Italian");
                    setPrepTime(5);
                    setCookTime(25);
                    setSource(EXAMPLE_RECIPE);
                    setImportedUrl(null);
                    setUrlImportSuccess(false);
                    setImportedFileName(null);
                  }}
                >
                  <Sparkles /> Try example
                </Button>
              )}
            </div>
            <SpellcheckEditor
              value={source}
              onChange={setSource}
              placeholder={EXAMPLE_RECIPE}
              maxLength={10000}
              ariaLabel="Recipe text"
            />
          </div>
        </section>

        <RecipePreviewPanel
          parseError={Boolean(parse.error)}
          parseLoading={parse.loading}
          preview={preview}
          previewError={previewResult.error}
        />
      </div>
    </div>
  );

  return (
    <RecipeEditorGate
      unreadable={unreadableRecipe}
      pending={sessionPending}
      authenticated={Boolean(session)}
    >
      {editor}
    </RecipeEditorGate>
  );
}
