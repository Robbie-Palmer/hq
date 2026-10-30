import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/index";

describe("parseFrontmatter", () => {
  it("parses standard YAML frontmatter", () => {
    const { data, content } = parseFrontmatter(
      "---\ntitle: Soup\nservings: 4\ntags:\n  - quick\n  - vegan\n---\n@onion{1}",
    );
    expect(data).toEqual({
      title: "Soup",
      servings: 4,
      tags: ["quick", "vegan"],
    });
    expect(content.trim()).toBe("@onion{1}");
  });

  it.each(["js", "javascript"])(
    "refuses to evaluate a `%s` frontmatter fence",
    (language) => {
      const marker = "__frontmatter_eval_marker__";
      const malicious = `---${language}\nmodule.exports = (() => { globalThis["${marker}"] = true; return {}; })()\n---\nbody`;
      expect(() => parseFrontmatter(malicious)).toThrow();
      expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
    },
  );

  it("fails closed for unknown and mixed-case language fences", () => {
    for (const language of [
      "JS",
      "Javascript",
      "node",
      "coffee",
      "cson",
      "wat",
    ]) {
      expect(() => parseFrontmatter(`---${language}\nx: 1\n---\nbody`)).toThrow();
    }
  });

  it("parses JSON without evaluating code", () => {
    const { data } = parseFrontmatter('---json\n{ "title": "X" }\n---\nbody');
    expect(data).toEqual({ title: "X" });
  });

  it("resolves ordinary YAML merge keys", () => {
    const { data } = parseFrontmatter(
      "---\ndefaults: &d\n  servings: 2\nmeal:\n  <<: *d\n  title: Soup\n---\nbody",
    );
    expect(data.meal).toEqual({ servings: 2, title: "Soup" });
  });
});
