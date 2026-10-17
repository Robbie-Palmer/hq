import {
  getAllProductDecisions as getAllProductDecisionEntities,
  getProductDecisionBacklinks,
  getProductDecision as getProductDecisionEntity,
  loadDomainRepository,
} from "@/lib/domain";
import { ProductDecisionRefSchema } from "@/lib/domain/slugs";

const repository = loadDomainRepository();

export function getAllProductDecisions() {
  return getAllProductDecisionEntities(repository);
}

export function getProductDecisionsForProject(projectSlug: string) {
  return getAllProductDecisions().filter(
    (decision) => decision.projectSlug === projectSlug,
  );
}

export function getProductDecision(ref: string) {
  const parsed = ProductDecisionRefSchema.safeParse(ref);
  if (!parsed.success) return null;
  const decision = getProductDecisionEntity(repository, parsed.data);
  if (!decision) return null;
  return {
    ...decision,
    projectTitle:
      repository.projects.get(decision.projectSlug)?.title ??
      decision.projectSlug,
    backlinks: getProductDecisionBacklinks(repository, parsed.data),
    supersededBy: repository.graph.reverse.productDecisionSupersededBy.get(
      parsed.data,
    ),
  };
}
