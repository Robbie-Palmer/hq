import matter from "gray-matter";

/**
 * gray-matter selects its parser from an inline language fence such as
 * `---js`, and its built-in JavaScript engine uses `eval`. Supplying engines
 * merges them over the built-ins, so this helper overrides every JavaScript
 * alias with a stub that refuses to run. Unknown engines already fail closed.
 * All untrusted frontmatter parsing must use this helper.
 */
const refuseEval = (): never => {
  throw new Error("Refusing to evaluate JavaScript front matter");
};

export function parseFrontmatter(content: string) {
  return matter(content, {
    language: "yaml",
    engines: {
      javascript: refuseEval,
      js: refuseEval,
    },
  });
}
