import { compile } from "@mdx-js/mdx";
import { describe, expect, it } from "vitest";
import { remarkRestrictMdxExpressions } from "../src/index";

function compileUntrusted(source: string) {
  return compile(source, { remarkPlugins: [remarkRestrictMdxExpressions] });
}

describe("remarkRestrictMdxExpressions", () => {
  it("allows nested static literal component properties", async () => {
    await expect(
      compileUntrusted(
        '<Callout config={{tone: "info", count: 2, values: [1, null, -2]}}>{`Safe content`}</Callout>',
      ),
    ).resolves.toBeDefined();
  });

  it.each([
    ["function calls", "{globalThis.attack() }"],
    ["assignments", "{globalThis.__mdx_attack__ = true}"],
    ["property access", "{process.env}"],
    ["identifiers", "{globalThis}"],
    ["interpolated templates", "{`value $" + "{globalThis}`}"],
    ["spread attributes", "<span {...globalThis} />"],
    ["regular expressions", "{/attack/}"],
    ["computed object properties", '<span data={{["key"]: 1}} />'],
    ["object spreads", "<span data={{...globalThis}} />"],
    ["object shorthand", "<span data={{globalThis}} />"],
    ["object methods", "<span data={{method() { return 1 }}} />"],
    ["non-numeric unary expressions", '{-"unsafe"}'],
    ["other unary expressions", "{!true}"],
  ])("rejects %s", async (_name, source) => {
    await expect(compileUntrusted(source)).rejects.toThrow(
      "MDX JavaScript expressions must contain only static literal values",
    );
  });

  it.each(["base", "embed", "iframe", "link", "meta", "object", "script"])(
    "rejects active <%s> elements",
    async (element) => {
      await expect(compileUntrusted(`<${element} />`)).rejects.toThrow(
        "is not allowed",
      );
    },
  );

  it("rejects active element names without case sensitivity", async () => {
    await expect(compileUntrusted("<IFRAME />")).rejects.toThrow(
      "is not allowed",
    );
  });

  it.each([
    ["HTML injection", '<div dangerouslySetInnerHTML={{__html: "bad"}} />'],
    ["event handlers", '<img src="safe.png" onerror="alert(1)" />'],
    ["mixed-case event handlers", '<img src="safe.png" onClick="bad" />'],
    ["form actions", '<button formAction="https://example.com" />'],
    ["inline documents", '<div srcDoc="bad" />'],
    ["JavaScript URLs", '<a href="JaVaScRiPt :alert(1)">click</a>'],
    ["VBScript URLs", '<img src="vbscript:attack" />'],
    ["HTML data URLs", '<form action="data : text/html,bad" />'],
  ])("rejects %s", async (_name, source) => {
    await expect(compileUntrusted(source)).rejects.toThrow("is not allowed");
  });
});
