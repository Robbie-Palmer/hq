import matter from "gray-matter";

// gray-matter's JavaScript engines use eval, so override every alias.
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
