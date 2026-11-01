import { describe, expect, it } from "vitest";
import {
  type CooklangTokenKind,
  tokenizeCooklang,
} from "../src/cooklang-highlighting";

function textByKind(source: string, kind: CooklangTokenKind) {
  return tokenizeCooklang(source)
    .filter((token) => token.kind === kind)
    .map((token) => source.slice(token.start, token.end))
    .join("");
}

describe("tokenizeCooklang", () => {
  it("separates instructions, entities, quantities, and units", () => {
    const source =
      "Mix @bread flour{500%g} in #mixing bowl{} and wait ~rest{10%minutes}.";

    expect(textByKind(source, "instruction")).toBe("Mix  in  and wait .");
    expect(textByKind(source, "ingredient")).toBe("bread flour");
    expect(textByKind(source, "cookware")).toBe("mixing bowl");
    expect(textByKind(source, "timer")).toBe("~rest");
    expect(textByKind(source, "quantity")).toBe("50010");
    expect(textByKind(source, "unit")).toBe("gminutes");
    expect(textByKind(source, "punctuation")).toBe("@{%}#{}{%}");
  });

  it("supports short entities and unnamed timers", () => {
    const source = "Add @salt to #pan, then hold ~{5%minutes}.";

    expect(textByKind(source, "ingredient")).toBe("salt");
    expect(textByKind(source, "cookware")).toBe("pan");
    expect(textByKind(source, "timer")).toBe("~");
    expect(textByKind(source, "quantity")).toBe("5");
  });

  it("keeps malformed and partial source lossless and editable", () => {
    const source =
      "Stir @broken{2%cup and ?unknown, then add @salt{1%tsp}.\nNext @";
    const tokens = tokenizeCooklang(source);

    expect(
      tokens.map((token) => source.slice(token.start, token.end)).join(""),
    ).toBe(source);
    expect(textByKind(source, "ingredient")).toContain("broken");
    expect(textByKind(source, "ingredient")).toContain("salt");
    expect(source.slice(tokens.at(-1)?.start)).toBe(".\nNext @");
    expect(tokens.at(-1)?.kind).toBe("instruction");
  });

  it("handles empty source without manufacturing a token", () => {
    expect(tokenizeCooklang("")).toEqual([]);
  });
});
