import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/catalog.json/route";

const repository = vi.hoisted(() => ({ id: "repository" }));
const catalog = vi.hoisted(() => ({ schemaVersion: 1, records: [] }));
const buildCatalogDocument = vi.hoisted(() => vi.fn(() => catalog));
const loadDomainRepository = vi.hoisted(() => vi.fn(() => repository));

vi.mock("@/lib/domain", () => ({
  buildCatalogDocument,
  loadDomainRepository,
}));

describe("catalog data route", () => {
  it("returns the derived repository catalog", async () => {
    const response = GET();

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(catalog);
    expect(buildCatalogDocument).toHaveBeenCalledWith(repository);
  });
});
