import rehypePrettyCode, { type Options } from "rehype-pretty-code";
import { createHighlighter, type LanguageRegistration } from "shiki";

const punctuation = { name: "punctuation.definition.cooklang" };
const quantity = { name: "constant.numeric.quantity.cooklang" };
const timer = { name: "keyword.control.timer.cooklang" };
const unit = { name: "support.type.unit.cooklang" };

const cooklangLanguage: LanguageRegistration = {
  name: "cooklang",
  displayName: "Cooklang",
  scopeName: "source.cooklang",
  aliases: ["cook"],
  repository: {},
  patterns: [
    {
      name: "meta.ingredient.cooklang",
      match: "(@)([^@#~{}\\n]+?)(\\{)([^%{}\\n]+)(%)([^{}\\n]+)(\\})",
      captures: {
        1: punctuation,
        2: { name: "string.quoted.other.ingredient.cooklang" },
        3: punctuation,
        4: quantity,
        5: punctuation,
        6: unit,
        7: punctuation,
      },
    },
    {
      name: "meta.ingredient.cooklang",
      match: "(@)([^@#~{}\\n]+?)(\\{)([^{}\\n]+)(\\})",
      captures: {
        1: punctuation,
        2: { name: "string.quoted.other.ingredient.cooklang" },
        3: punctuation,
        4: quantity,
        5: punctuation,
      },
    },
    {
      name: "meta.ingredient.cooklang",
      match: "(@)([^@#~{}\\n]+?)(\\{\\})",
      captures: {
        1: punctuation,
        2: { name: "string.quoted.other.ingredient.cooklang" },
        3: punctuation,
      },
    },
    {
      name: "meta.ingredient.cooklang",
      match: "(@)([\\p{L}\\p{N}_'-]+)",
      captures: {
        1: punctuation,
        2: { name: "string.quoted.other.ingredient.cooklang" },
      },
    },
    {
      name: "meta.cookware.cooklang",
      match: "(#)([^@#~{}\\n]+?)(\\{\\})",
      captures: {
        1: punctuation,
        2: { name: "entity.name.type.cookware.cooklang" },
        3: punctuation,
      },
    },
    {
      name: "meta.cookware.cooklang",
      match: "(#)([\\p{L}\\p{N}_'-]+)",
      captures: {
        1: punctuation,
        2: { name: "entity.name.type.cookware.cooklang" },
      },
    },
    {
      name: "meta.timer.cooklang",
      match: "(~)([^@#~{}\\n]*?)(\\{)([^%{}\\n]+)(%)([^{}\\n]+)(\\})",
      captures: {
        1: timer,
        2: timer,
        3: punctuation,
        4: quantity,
        5: punctuation,
        6: unit,
        7: punctuation,
      },
    },
    {
      name: "meta.timer.cooklang",
      match: "(~)([^@#~{}\\n]*?)(\\{)([^{}\\n]+)(\\})",
      captures: {
        1: timer,
        2: timer,
        3: punctuation,
        4: quantity,
        5: punctuation,
      },
    },
  ],
};

const getMarkdownHighlighter: NonNullable<Options["getHighlighter"]> = async (
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
