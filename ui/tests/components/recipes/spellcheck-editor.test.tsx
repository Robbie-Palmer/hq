import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({
  dictionary: null as Map<string, string[]> | null,
  ready: true,
  retry: vi.fn(),
}));

vi.mock("@/hooks/use-typo-dictionary", () => ({
  useTypoDictionary: () => ({
    dictionary: mocks.dictionary,
    ready: mocks.ready,
    retry: mocks.retry,
  }),
}));

import { SpellcheckEditor } from "@/components/recipes/spellcheck-editor";

beforeEach(() => {
  mocks.dictionary = new Map<string, string[]>([
    ["teh", ["the"]],
    ["tomatoe", ["tomato"]],
    ["cofee", ["coffee"]],
  ]);
  mocks.ready = true;
  mocks.retry = vi.fn();
});

function ControlledEditor({
  initial,
  maxLength,
}: {
  initial: string;
  maxLength?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SpellcheckEditor
        value={value}
        onChange={setValue}
        maxLength={maxLength}
        ariaLabel="Recipe text"
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("SpellcheckEditor", () => {
  it("highlights Cooklang without adding another editing surface", () => {
    const { container } = render(
      <ControlledEditor initial="Mix @bread flour{500%g} in #mixing bowl{} and wait ~rest{10%minutes}." />,
    );

    const textFor = (token: string) =>
      [...container.querySelectorAll(`[data-cooklang-token="${token}"]`)]
        .map((element) => element.textContent)
        .join("");

    expect(textFor("ingredient")).toBe("bread flour");
    expect(textFor("cookware")).toBe("mixing bowl");
    expect(textFor("timer")).toBe("~rest");
    expect(textFor("quantity")).toBe("50010");
    expect(textFor("instruction")).toBe("Mix  in  and wait .");
    const quantity = container.querySelector(
      '[data-cooklang-token="quantity"]',
    );
    expect(quantity).toHaveClass(
      "font-semibold",
      "text-[var(--cooklang-value)]",
    );
    expect(quantity?.className).not.toContain("bg-");
    expect(
      container.querySelector('[data-cooklang-token="punctuation"]'),
    ).toHaveClass("text-[var(--cooklang-structure)]");
    expect(
      container.querySelector('[data-cooklang-token="timer"]'),
    ).not.toHaveClass("underline");
    expect(
      screen.getAllByRole("textbox", { name: "Recipe text" }),
    ).toHaveLength(1);
    expect(container.querySelector("[contenteditable]")).toBeNull();
  });

  it("hides the duplicate highlighted text from assistive technology", () => {
    const { container } = render(
      <ControlledEditor initial="Add @salt{1%tsp} to #pan{}." />,
    );

    const backdrop = container.querySelector(
      "[data-cooklang-highlight-backdrop]",
    );
    expect(backdrop).toHaveTextContent("Add @salt{1%tsp} to #pan{}.");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(
      backdrop?.querySelectorAll("[data-cooklang-token]"),
    ).not.toHaveLength(0);
    expect(screen.getByRole("textbox", { name: "Recipe text" })).toHaveValue(
      "Add @salt{1%tsp} to #pan{}.",
    );
  });

  it("preserves focus and selection when highlighting rerenders", () => {
    const source = "Mix @tomato{2} in #pan{}.";
    const { rerender } = render(<ControlledEditor initial={source} />);
    const textarea = screen.getByRole("textbox", {
      name: "Recipe text",
    }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(4, 14);

    rerender(<ControlledEditor initial={source} />);

    expect(textarea).toHaveFocus();
    expect(textarea).toHaveProperty("selectionStart", 4);
    expect(textarea).toHaveProperty("selectionEnd", 14);
  });

  it("accepts keyboard typing, paste, and native undo input unchanged", async () => {
    const user = userEvent.setup();
    render(<ControlledEditor initial="Mix" />);
    const textarea = screen.getByRole("textbox", { name: "Recipe text" });

    await user.click(textarea);
    await user.type(textarea, " @salt");
    await user.paste(" in #pan");
    expect(textarea).toHaveValue("Mix @salt in #pan");

    const undoKey = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "z",
    });
    textarea.dispatchEvent(undoKey);
    expect(undoKey.defaultPrevented).toBe(false);

    fireEvent.input(textarea, {
      inputType: "historyUndo",
      target: { value: "Mix @salt" },
    });
    expect(textarea).toHaveValue("Mix @salt");
  });

  it("passes mobile IME composition through the native textarea", () => {
    const { container } = render(<ControlledEditor initial="Add " />);
    const textarea = screen.getByRole("textbox", { name: "Recipe text" });

    fireEvent.compositionStart(textarea);
    fireEvent.input(textarea, {
      isComposing: true,
      target: { value: "Add @塩" },
    });
    fireEvent.compositionEnd(textarea, { data: "塩" });

    expect(textarea).toHaveValue("Add @塩");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(
      container.querySelector('[data-cooklang-token="ingredient"]'),
    ).toHaveTextContent("塩");
  });

  it("keeps partial syntax editable and synchronizes scrolling", () => {
    const { container } = render(
      <ControlledEditor initial="Stir @broken{2%cup and ?unknown" />,
    );
    const textarea = screen.getByRole("textbox", { name: "Recipe text" });
    const backdrop = container.querySelector<HTMLElement>(
      "[data-cooklang-highlight-backdrop]",
    );

    expect(textarea).toHaveValue("Stir @broken{2%cup and ?unknown");
    expect(backdrop).toHaveTextContent("Stir @broken{2%cup and ?unknown");
    textarea.scrollTop = 36;
    textarea.scrollLeft = 12;
    fireEvent.scroll(textarea);
    expect(backdrop?.scrollTop).toBe(36);
    expect(backdrop?.scrollLeft).toBe(12);
  });

  it("summarises the number of issues and underlines each in the backdrop", () => {
    const { container } = render(<ControlledEditor initial="teh @tomatoe{}" />);

    expect(screen.getByText("2 possible spelling issues")).toBeInTheDocument();
    const marks = container.querySelectorAll("[data-spellcheck-mark]");
    expect([...marks].map((mark) => mark.textContent)).toEqual([
      "teh",
      "tomatoe",
    ]);
  });

  it("accepts a suggestion from the issues list, rewriting the source", async () => {
    const user = userEvent.setup();
    render(<ControlledEditor initial="teh onion" />);

    await user.click(screen.getByText("1 possible spelling issue"));
    const popover = await screen.findByRole("list");
    await user.click(within(popover).getByRole("button", { name: /the/ }));

    expect(screen.getByTestId("value")).toHaveTextContent("the onion");
  });

  it("accepts a correction by clicking the highlighted word", async () => {
    const user = userEvent.setup();
    const { container } = render(<ControlledEditor initial="teh onion" />);

    const mark = container.querySelector("[data-spellcheck-mark]");
    expect(mark).not.toBeNull();
    await user.click(mark as HTMLElement);
    await user.click(await screen.findByRole("button", { name: "the" }));

    expect(screen.getByTestId("value")).toHaveTextContent("the onion");
  });

  it("fixes every issue at once", async () => {
    const user = userEvent.setup();
    render(<ControlledEditor initial="teh @tomatoe{}" />);

    await user.click(screen.getByRole("button", { name: /fix all/i }));

    expect(screen.getByTestId("value")).toHaveTextContent("the @tomato{}");
  });

  it("does not apply a correction that would exceed maxLength", async () => {
    const user = userEvent.setup();
    render(<ControlledEditor initial="cofee" maxLength={5} />);

    await user.click(screen.getByText("1 possible spelling issue"));
    const popover = await screen.findByRole("list");
    await user.click(within(popover).getByRole("button", { name: "coffee" }));

    // "coffee" (6) exceeds the 5-char limit, so the source is left unchanged.
    expect(screen.getByTestId("value")).toHaveTextContent("cofee");
  });

  it("stops flagging a word once ignored", async () => {
    const user = userEvent.setup();
    render(<ControlledEditor initial="teh onion" />);

    await user.click(screen.getByText("1 possible spelling issue"));
    const popover = await screen.findByRole("list");
    await user.click(within(popover).getByRole("button", { name: /ignore/i }));

    expect(screen.getByText("No spelling issues")).toBeInTheDocument();
  });

  it("offers a retry when the dictionary is unavailable", async () => {
    mocks.dictionary = null;
    const user = userEvent.setup();
    render(<ControlledEditor initial="teh onion" />);

    expect(screen.getByText("Spell-check unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });
});
