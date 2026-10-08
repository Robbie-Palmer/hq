import {
  getAllProductDecisions as getAllProductDecisionEntities,
  getProductDecisionBacklinks,
  getProductDecision as getProductDecisionEntity,
  loadDomainRepository,
} from "@/lib/domain";
import { ProductDecisionSlugSchema } from "@/lib/domain/slugs";

const repository = loadDomainRepository();

export function getAllProductDecisions() {
  return getAllProductDecisionEntities(repository);
}

export function getProductDecision(slug: string) {
  const parsed = ProductDecisionSlugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const decision = getProductDecisionEntity(repository, parsed.data);
  if (!decision) return null;
  return {
    ...decision,
    backlinks: getProductDecisionBacklinks(repository, parsed.data),
    supersededBy: repository.graph.reverse.productDecisionSupersededBy.get(
      parsed.data,
    ),
  };
}
