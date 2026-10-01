import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { expandCooklangArchive } from "../src/collection-archive";

function archive(files: Record<string, Uint8Array>, level: 0 | 6 = 6) {
  return { type: "archive" as const, filename: "recipes.zip", content: Buffer.from(zipSync(files, { level })).toString("base64") };
}
describe("Cooklang collection archives", () => {
  it("expands ordered recipes with checksummed provenance and ignores attachments", async () => {
    const entries = await expandCooklangArchive(archive({ "collection/soup.cook": strToU8("Mix @salt{1%tsp}."), "bread.cooklang": strToU8("Bake @flour{100%g}."), "photo.jpg": new Uint8Array([1, 2]) }));
    expect(entries.map(entry => entry.entryPath)).toEqual(["collection/soup.cook", "bread.cooklang"]);
    expect(entries[0]?.source).toEqual({ type: "file", filename: "collection/soup.cook", content: "Mix @salt{1%tsp}." });
    expect(entries[0]?.archiveChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(entries[0]?.archiveChecksum).toBe(entries[1]?.archiveChecksum);
    expect(entries[0]?.contentChecksum).not.toBe(entries[1]?.contentChecksum);
  });
  it.each(["../soup.cook", "/soup.cook", "folder/../soup.cook", "C:/soup.cook", "folder\\soup.cook"])("rejects unsafe path %s", async path => {
    await expect(expandCooklangArchive(archive({ [path]: strToU8("Mix @salt.") }))).rejects.toThrow("Unsafe");
  });
  it("rejects paths that normalize to the same entry", async () => {
    await expect(expandCooklangArchive(archive({ "SOUP.cook": strToU8("Mix @salt."), "soup.cook": strToU8("Mix @salt.") }))).rejects.toThrow("Duplicate archive entry path");
  });
  it("keeps good siblings when an entry exceeds its limit or is not UTF-8", async () => {
    const entries = await expandCooklangArchive(archive({ "large.cook": strToU8("a".repeat(100001)), "invalid.cook": new Uint8Array([255]), "good.cook": strToU8("Mix @salt.") }, 0));
    expect(entries.map(entry => entry.error)).toEqual(["Archive recipe exceeds 100 KB", "Archive recipe is not UTF-8 text", undefined]);
  });
  it("rejects excessive compression before retaining the expanded text", async () => {
    await expect(expandCooklangArchive(archive({ "bomb.cook": strToU8("a".repeat(100000)) }))).rejects.toThrow("expansion limit");
  });
  it("rejects too many recipes and empty or incomplete archives", async () => {
    const files = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`${i}.cook`, strToU8("Mix @salt.")]));
    await expect(expandCooklangArchive(archive(files))).rejects.toThrow("50 recipes");
    await expect(expandCooklangArchive(archive({}))).rejects.toThrow("no Cooklang");
    const input = archive({ "soup.cook": strToU8("Mix @salt.") });
    input.content = Buffer.from(Buffer.from(input.content, "base64").subarray(0, 30)).toString("base64");
    await expect(expandCooklangArchive(input)).rejects.toThrow();
  });
});
