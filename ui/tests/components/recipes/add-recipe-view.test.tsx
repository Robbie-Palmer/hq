import { CooklangParser } from "@cooklang/cooklang";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({
  getHouseholds: vi.fn(),
  navigateToRecipePage: vi.fn(),
  routerPush: vi.fn(),
  useCooklangRecipe: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: mocks.useSession },
}));

vi.mock("@/lib/api/households", () => ({
  getHouseholds: mocks.getHouseholds,
}));

vi.mock("@/components/recipes/recipe-page-link", () => ({
  navigateToRecipePage: mocks.navigateToRecipePage,
}));

vi.mock("@/hooks/use-cooklang-recipe", () => ({
  useCooklangRecipe: mocks.useCooklangRecipe,
}));

// The editor's spell-checker lazily fetches its dictionary on mount; stub it so
// these tests don't add an extra fetch call or hit the network.
vi.mock("@/hooks/use-typo-dictionary", () => ({
  useTypoDictionary: () => ({ dictionary: null, ready: true }),
}));

vi.mock("@/components/recipes/recipe-content", () => ({
  RecipeContent: ({ recipe }: { recipe: { title: string } }) => (
    <div>{recipe.title}</div>
  ),
}));

import { AddRecipeView } from "@/components/recipes/add-recipe-view";

const household = {
  id: "household-1",
  name: "Park Road kitchen",
  slug: "park-road",
  logo: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  membership: { id: "member-1", role: "owner" },
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("AddRecipeView visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useCooklangRecipe.mockReturnValue({
      recipe: null,
      loading: false,
      error: null,
    });
    mocks.useSession.mockReturnValue({
      data: { user: { id: "user-1", name: "Robbie" } },
      isPending: false,
    });
  });

  it("defaults to household sharing when membership is available", async () => {
    mocks.getHouseholds.mockResolvedValue([household]);

    render(<AddRecipeView />);

    expect(
      await screen.findByRole("button", { name: "Household", pressed: true }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Public" }));
    expect(
      screen.getByRole("button", { name: "Public", pressed: true }),
    ).toBeInTheDocument();
  });

  it("falls back to private when the user has no household", async () => {
    mocks.getHouseholds.mockResolvedValue([]);

    render(<AddRecipeView />);

    expect(
      await screen.findByRole("button", { name: "Private", pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Household" })).toBeDisabled();
  });

  it("falls back to private when household discovery fails", async () => {
    mocks.getHouseholds.mockRejectedValue(new Error("Households unavailable"));

    render(<AddRecipeView />);

    expect(
      await screen.findByText(
        /Join a household to share recipes with its members\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Private", pressed: true }),
    ).toBeInTheDocument();
  });

  it("quietly stops household discovery when the request is aborted", async () => {
    mocks.getHouseholds.mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    render(<AddRecipeView />);

    expect(
      await screen.findByText(
        /Join a household to share recipes with its members\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Private", pressed: true }),
    ).toBeInTheDocument();
  });

  it("preserves a visibility selected while household membership loads", async () => {
    let resolveHouseholds: (value: (typeof household)[]) => void = () => {};
    mocks.getHouseholds.mockReturnValue(
      new Promise((resolve) => {
        resolveHouseholds = resolve;
      }),
    );

    render(<AddRecipeView />);
    fireEvent.click(screen.getByRole("button", { name: "Public" }));
    resolveHouseholds([household]);

    expect(
      await screen.findByRole("button", { name: "Public", pressed: true }),
    ).toBeInTheDocument();
  });

  it("loads and updates an existing recipe without changing its slug", async () => {
    const source = "Cook @rice{200%g}.";
    const canonical = "https://example.test/weeknight-rice";
    const [parsedRecipe] = new CooklangParser().parse(source);
    mocks.useCooklangRecipe.mockReturnValue({
      recipe: parsedRecipe,
      loading: false,
      error: null,
    });
    mocks.getHouseholds.mockResolvedValue([]);
    globalThis.fetch = vi.fn(async () =>
      Response.json({ slug: "weeknight-rice" }),
    ) as typeof fetch;

    render(
      <AddRecipeView
        initialRecipe={{
          slug: "weeknight-rice",
          title: "Weeknight Rice",
          description: "A quick dinner.",
          body: JSON.stringify({
            version: 1,
            source,
            recipe: {
              title: "Weeknight Rice",
              description: "A quick dinner.",
              date: "2025-05-04",
              canonical,
              cuisine: ["Japanese"],
              servings: 2,
              tags: [],
              ingredientGroups: [
                {
                  items: [{ ingredient: "rice", amount: 200, unit: "g" }],
                },
              ],
              instructions: ["Cook the rice."],
              cookware: [],
              cookBody: source,
            },
          }),
          visibility: "private",
          createdAt: "2026-07-22T12:00:00.000Z",
          updatedAt: "2026-07-22T12:00:00.000Z",
          owned: true,
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Edit recipe" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Recipe name")).toHaveValue("Weeknight Rice");
    expect(screen.getByLabelText("Cuisine")).toHaveValue("Japanese");
    expect(screen.getByDisplayValue(source)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Private", pressed: true }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Import URL" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "Save changes" }),
    );

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/recipes/weeknight-rice",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const [, request] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    const requestBody = JSON.parse(String(request?.body));
    expect(Object.keys(requestBody).sort()).toEqual([
      "body",
      "description",
      "title",
      "visibility",
    ]);
    expect(JSON.parse(requestBody.body).recipe.canonical).toBe(canonical);
    expect(JSON.parse(requestBody.body).recipe.date).toBe("2025-05-04");
    expect(mocks.navigateToRecipePage).toHaveBeenCalledWith({
      slug: "weeknight-rice",
    });
  });

  it("disables editing when the saved recipe body is unreadable", () => {
    mocks.getHouseholds.mockResolvedValue([]);

    render(
      <AddRecipeView
        initialRecipe={{
          slug: "broken-recipe",
          title: "Broken Recipe",
          description: "This body cannot be parsed.",
          body: "{",
          visibility: "private",
          createdAt: "2026-07-22T12:00:00.000Z",
          updatedAt: "2026-07-22T12:00:00.000Z",
          owned: true,
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Recipe unavailable" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Editing is disabled to avoid overwriting it/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });

  it("imports a local schema.org file into the editable fields", async () => {
    mocks.getHouseholds.mockResolvedValue([]);
    const content = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Tomato pasta",
      recipeIngredient: ["200 g pasta"],
      recipeInstructions: ["Boil the pasta."],
    });
    const file = new File([content], "tomato-pasta.json", {
      type: "application/ld+json",
    });
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue(content),
    });
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) !== "/api/recipe-drafts/file") {
        throw new Error(`Unexpected request: ${String(input)}`);
      }
      return Response.json({
        title: "Tomato pasta",
        description: "A quick dinner.",
        cuisine: "Italian",
        servings: 2,
        prepTime: 5,
        cookTime: 20,
        source: "@pasta{200%g}\n\nBoil the pasta.",
      });
    }) as typeof fetch;

    render(<AddRecipeView />);
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    fireEvent.change(screen.getByLabelText("Recipe file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Recipe name")).toHaveValue("Tomato pasta"),
    );
    expect(screen.getByLabelText("Short description")).toHaveValue(
      "A quick dinner.",
    );
    expect(screen.getByLabelText("Cuisine")).toHaveValue("Italian");
    expect(screen.getByLabelText("Servings")).toHaveValue(2);
    expect(
      screen.getByText(
        "Imported tomato-pasta.json. You can edit any field before saving.",
      ),
    ).toBeInTheDocument();

    const [, request] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).toEqual({
      filename: "tomato-pasta.json",
      content,
    });
  });

  it("rejects a URL import missing a required recipe field", async () => {
    mocks.getHouseholds.mockResolvedValue([]);
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        description: "A quick dinner.",
        cuisine: "Italian",
        servings: 2,
        source: "@pasta{200%g}\n\nBoil the pasta.",
      }),
    ) as typeof fetch;

    render(<AddRecipeView />);
    fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
    fireEvent.change(screen.getByLabelText("Recipe webpage URL"), {
      target: { value: "https://example.test/tomato-pasta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));

    expect(
      await screen.findByText("The recipe could not be imported."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Recipe name")).toHaveValue("");
  });

  it("rejects a file import with an incorrectly typed recipe field", async () => {
    mocks.getHouseholds.mockResolvedValue([]);
    const file = new File(["recipe"], "recipe.cook");
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue("recipe"),
    });
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        title: "Tomato pasta",
        description: "A quick dinner.",
        cuisine: "Italian",
        servings: "2",
        source: "@pasta{200%g}\n\nBoil the pasta.",
      }),
    ) as typeof fetch;

    render(<AddRecipeView />);
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    fireEvent.change(screen.getByLabelText("Recipe file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));

    expect(
      await screen.findByText("The recipe file could not be imported."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Recipe name")).toHaveValue("");
  });

  it("rejects oversized files before reading or uploading them", async () => {
    mocks.getHouseholds.mockResolvedValue([]);
    const file = new File(["recipe"], "large.cook");
    const text = vi.fn();
    Object.defineProperties(file, {
      size: { value: 100_001 },
      text: { value: text },
    });
    globalThis.fetch = vi.fn();

    render(<AddRecipeView />);
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    fireEvent.change(screen.getByLabelText("Recipe file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));

    expect(
      await screen.findByText("Choose a recipe file smaller than 100 KB."),
    ).toBeInTheDocument();
    expect(text).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("clears file import feedback when switching methods", async () => {
    mocks.getHouseholds.mockResolvedValue([]);
    const file = new File(["@rice{1%cup}\n\nCook."], "rice.cook");
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue("@rice{1%cup}\n\nCook."),
    });
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        title: "Rice",
        description: "Rice.",
        cuisine: "",
        servings: 1,
        source: "@rice{1%cup}\n\nCook.",
      }),
    ) as typeof fetch;

    render(<AddRecipeView />);
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    fireEvent.change(screen.getByLabelText("Recipe file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));
    expect(await screen.findByText(/Imported rice\.cook/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    expect(screen.queryByText(/Imported rice\.cook/)).not.toBeInTheDocument();
  });

  it("cancels a pending URL import when switching methods", async () => {
    mocks.getHouseholds.mockResolvedValue([]);
    const requestAborted = vi.fn();
    globalThis.fetch = vi.fn((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          requestAborted();
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    render(<AddRecipeView />);
    fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
    fireEvent.change(screen.getByLabelText("Recipe webpage URL"), {
      target: { value: "https://example.test/tomato-pasta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));

    await waitFor(() => expect(requestAborted).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Recipe file")).toBeInTheDocument();
    expect(
      screen.queryByText("The recipe could not be imported."),
    ).not.toBeInTheDocument();
  });

  it("shows a generic message for unexpected file import failures", async () => {
    mocks.getHouseholds.mockResolvedValue([]);
    const file = new File(["recipe"], "recipe.cook");
    Object.defineProperty(file, "text", {
      value: vi.fn().mockRejectedValue(new Error("internal detail")),
    });

    render(<AddRecipeView />);
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    fireEvent.change(screen.getByLabelText("Recipe file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));

    expect(
      await screen.findByText("The recipe file could not be imported."),
    ).toBeInTheDocument();
    expect(screen.queryByText("internal detail")).not.toBeInTheDocument();
  });
});
