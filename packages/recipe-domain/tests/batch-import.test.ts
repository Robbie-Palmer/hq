import { describe, expect, it } from "vitest";
import { CreateBatchSchema } from "../src/batch-import";

const source = { type: "archive", filename: "recipes.zip", content: "UEsDBA==" };
const input = { idempotencyKey: "00000000-0000-4000-8000-000000000001", sources: [source] };
describe("collection batch requests", () => {
  it("defaults to private reviewed imports that skip duplicate recipes", () => {
    expect(CreateBatchSchema.parse(input)).toMatchObject({ visibility: "private", duplicatePolicy: "skip", sources: [source] });
    expect(CreateBatchSchema.parse({ ...input, visibility: "public", duplicatePolicy: "allow" })).toMatchObject({ visibility: "public", duplicatePolicy: "allow" });
  });
  it.each([{ ...source, filename: "recipes.rar" }, { ...source, content: "invalid!" }, { ...source, content: "" }, { ...source, content: "A".repeat(1_400_001) }])("rejects invalid archive input", value => {
    expect(CreateBatchSchema.safeParse({ ...input, sources: [value] }).success).toBe(false);
  });
});
