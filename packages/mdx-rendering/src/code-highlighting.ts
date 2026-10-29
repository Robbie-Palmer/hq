import rehypePrettyCode, { type Options } from "rehype-pretty-code";
import { createHighlighter, type LanguageRegistration } from "shiki";
import {
  COOKLANG_HIGHLIGHT_PATTERNS,
  type CooklangTokenKind,
} from "@/lib/domain/recipe/cooklangHighlighting";

const tokenScopes = {
  ingredient: "string.quoted.other.ingredient.cooklang",
  cookware: "entity.name.type.cookware.cooklang",
  timer: "keyword.control.timer.cooklang",
  quantity: "constant.numeric.quantity.cooklang",
  unit: "support.type.unit.cooklang",
  punctuation: "punctuation.definition.cooklang",
  instruction: "source.cooklang",
} satisfies Record<CooklangTokenKind, string>;

const cooklangLanguage: LanguageRegistration = {
  name: "cooklang",
  displayName: "Cooklang",
  scopeName: "source.cooklang",
  aliases: ["cook"],
  repository: {},
  patterns: COOKLANG_HIGHLIGHT_PATTERNS.map((pattern) => ({
    name: `meta.${pattern.name}.cooklang`,
    match: pattern.source,
    captures: Object.fromEntries(
      Object.entries(pattern.captures).map(([index, token]) => [
        index,
        { name: tokenScopes[token] },
      ]),
    ),
  })),
};

const getMarkdownHighlighter: NonNullable<Options["getHighlighter"]> = (
  options,
) =>
  createHighlighter({
    ...options,
    langs: [...options.langs, cooklangLanguage],
  });

export const markdownCodeHighlighting = [
  rehypePrettyCode,
  {
    theme: {
      dark: "github-dark",
      light: "github-light",
    },
    keepBackground: false,
    getHighlighter: getMarkdownHighlighter,
  },
] satisfies [typeof rehypePrettyCode, Options];
