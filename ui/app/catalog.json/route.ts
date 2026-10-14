import { buildCatalogDocument, loadDomainRepository } from "@/lib/domain";

export const dynamic = "force-static";

export function GET() {
  const catalog = buildCatalogDocument(loadDomainRepository());
  if (!catalog) {
    return Response.json({ error: "Catalog unavailable" }, { status: 404 });
  }
  return Response.json(catalog);
}
