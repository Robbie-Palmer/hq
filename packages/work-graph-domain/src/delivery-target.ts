import { WorkGraphError } from "./errors";

export type DeliverySourcePathMode = "exclusive" | "shared";

export interface GeneratedDeliverySourcePath {
  readonly path: string;
  readonly mode: DeliverySourcePathMode;
  readonly subjects: readonly string[];
}

export interface GeneratedDeliveryTarget {
  readonly id: string;
  readonly projectId: string;
  readonly repository: string;
  readonly sourcePaths: readonly GeneratedDeliverySourcePath[];
  readonly subjects: readonly string[];
  readonly sharedHostId: string | null;
  readonly requiredCiNames: readonly string[];
  readonly productionEnvironments: readonly string[];
}

export interface GeneratedDeliveryMetadataRevision {
  readonly repository: string;
  readonly sourceRevision: string;
  readonly targets: readonly GeneratedDeliveryTarget[];
}

export interface ResolvedDeliveryTargetSnapshot {
  readonly id: string;
  readonly projectId: string;
  readonly subjects: readonly string[];
  readonly sharedHostId: string | null;
  readonly matchedPaths: readonly string[];
  readonly requiredCiNames: readonly string[];
  readonly productionEnvironments: readonly string[];
}

export interface DeliveryTargetResolution {
  readonly repository: string;
  readonly sourceRevision: string;
  readonly changedPaths: readonly string[];
  readonly targets: readonly ResolvedDeliveryTargetSnapshot[];
  readonly subjects: readonly string[];
  readonly overrideTargetIds: readonly string[];
}

export interface ResolveDeliveryTargetsInput {
  readonly metadata: GeneratedDeliveryMetadataRevision;
  readonly repository: string;
  readonly ticketProjectId: string | null;
  readonly changedPaths: readonly string[];
  readonly overrideTargetIds?: readonly string[];
}

const repositoryPattern = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new WorkGraphError(
      "invalid_delivery_metadata",
      `${field} must not be blank.`,
    );
  }
  return normalized;
};

const uniqueSorted = (values: readonly string[], field: string): string[] => {
  const normalized = values.map((value) => text(value, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new WorkGraphError(
      "invalid_delivery_metadata",
      `${field} must not contain duplicates.`,
    );
  }
  return normalized.toSorted((left, right) => left.localeCompare(right));
};

const normalizePath = (value: string, field: string): string => {
  const normalized = text(value, field).replace(/^\.\//u, "").replace(/\/$/u, "");
  if (
    normalized.startsWith("/") ||
    normalized === "." ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new WorkGraphError(
      "invalid_delivery_metadata",
      `${field} must be a repository-relative path.`,
    );
  }
  return normalized;
};

const pathMatches = (changedPath: string, sourcePath: string): boolean =>
  changedPath === sourcePath || changedPath.startsWith(`${sourcePath}/`);

export const normalizeGeneratedDeliveryMetadata = (
  input: GeneratedDeliveryMetadataRevision,
): GeneratedDeliveryMetadataRevision => {
  const repository = text(input.repository, "repository").toLowerCase();
  if (!repositoryPattern.test(repository)) {
    throw new WorkGraphError(
      "invalid_delivery_metadata",
      "Delivery metadata needs a canonical owner/repository identity.",
    );
  }
  const sourceRevision = text(input.sourceRevision, "sourceRevision");
  if (input.targets.length === 0) {
    throw new WorkGraphError(
      "invalid_delivery_metadata",
      "Delivery metadata needs at least one target.",
    );
  }
  const targets = input.targets.map((target) => {
    const targetRepository = text(target.repository, "target.repository").toLowerCase();
    if (targetRepository !== repository) {
      throw new WorkGraphError(
        "invalid_delivery_metadata",
        `Delivery target ${target.id} belongs to another repository.`,
      );
    }
    if (target.sourcePaths.length === 0) {
      throw new WorkGraphError(
        "invalid_delivery_metadata",
        `Delivery target ${target.id} needs at least one source path.`,
      );
    }
    const requiredCiNames = uniqueSorted(
      target.requiredCiNames,
      "target.requiredCiNames",
    );
    const productionEnvironments = uniqueSorted(
      target.productionEnvironments,
      "target.productionEnvironments",
    );
    if (requiredCiNames.length === 0 || productionEnvironments.length === 0) {
      throw new WorkGraphError(
        "invalid_delivery_metadata",
        `Delivery target ${target.id} needs CI and production-environment evidence bindings.`,
      );
    }
    return {
      id: text(target.id, "target.id"),
      projectId: text(target.projectId, "target.projectId"),
      repository: targetRepository,
      sourcePaths: target.sourcePaths
        .map((binding) => {
          if (binding.mode !== "exclusive" && binding.mode !== "shared") {
            throw new WorkGraphError(
              "invalid_delivery_metadata",
              `Delivery target ${target.id} has an invalid source-path mode.`,
            );
          }
          return {
            path: normalizePath(binding.path, "target.sourcePath.path"),
            mode: binding.mode,
            subjects: uniqueSorted(
              binding.subjects,
              "target.sourcePath.subjects",
            ),
          };
        })
        .toSorted((left, right) => left.path.localeCompare(right.path)),
      subjects: uniqueSorted(target.subjects, "target.subjects"),
      sharedHostId:
        target.sharedHostId === null
          ? null
          : text(target.sharedHostId, "target.sharedHostId"),
      requiredCiNames,
      productionEnvironments,
    };
  });
  const ids = targets.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new WorkGraphError(
      "invalid_delivery_metadata",
      "Delivery target IDs must be unique within a metadata revision.",
    );
  }
  return {
    repository,
    sourceRevision,
    targets: targets.toSorted((left, right) => left.id.localeCompare(right.id)),
  };
};

const projectIdentity = (ticketProjectId: string): string =>
  ticketProjectId.startsWith("project:")
    ? ticketProjectId
    : `project:${ticketProjectId}`;

interface MatchedDeliveryTarget {
  readonly target: GeneratedDeliveryTarget;
  readonly bindings: readonly {
    readonly binding: GeneratedDeliverySourcePath;
    readonly changedPath: string;
  }[];
}

const matchDeliveryTargets = (
  metadata: GeneratedDeliveryMetadataRevision,
  projectTargets: readonly GeneratedDeliveryTarget[],
  changedPaths: readonly string[],
): MatchedDeliveryTarget[] => {
  const matched = projectTargets.flatMap((target) => {
    const bindings = target.sourcePaths.flatMap((binding) =>
      changedPaths
        .filter((changedPath) => pathMatches(changedPath, binding.path))
        .map((changedPath) => ({ binding, changedPath })),
    );
    return bindings.length === 0 ? [] : [{ target, bindings }];
  });
  if (matched.length > 0) return matched;
  const fallbackTarget = projectTargets[0];
  if (metadata.targets.length === 1 && fallbackTarget) {
    return [{ target: fallbackTarget, bindings: [] }];
  }
  throw new WorkGraphError(
    "delivery_paths_unmapped",
    "Changed paths do not identify a delivery target within the ticket project.",
  );
};

const validateExclusivePathOwnership = (
  matched: readonly MatchedDeliveryTarget[],
  changedPaths: readonly string[],
): void => {
  for (const changedPath of changedPaths) {
    const exact = matched.flatMap(({ target, bindings }) =>
      bindings
        .filter(({ changedPath: candidate }) => candidate === changedPath)
        .map(({ binding }) => ({ target, binding })),
    );
    const exclusiveProjectIds = new Set(
      exact
        .filter(({ binding }) => binding.mode === "exclusive")
        .map(({ target }) => target.projectId),
    );
    if (exclusiveProjectIds.size > 1) {
      throw new WorkGraphError(
        "delivery_paths_ambiguous",
        `Changed path ${changedPath} matches several exclusive delivery targets.`,
      );
    }
  }
};

const selectDeliveryTargetOverride = (
  matched: readonly MatchedDeliveryTarget[],
  overrideTargetIds: readonly string[],
): readonly MatchedDeliveryTarget[] => {
  const matchedIds = new Set(matched.map(({ target }) => target.id));
  if (overrideTargetIds.some((id) => !matchedIds.has(id))) {
    throw new WorkGraphError(
      "delivery_override_outside_policy",
      "A delivery-target override may only narrow targets selected by project owner policy.",
    );
  }
  return overrideTargetIds.length === 0
    ? matched
    : matched.filter(({ target }) => overrideTargetIds.includes(target.id));
};

export const resolveDeliveryTargets = (
  input: ResolveDeliveryTargetsInput,
): DeliveryTargetResolution => {
  const metadata = normalizeGeneratedDeliveryMetadata(input.metadata);
  const repository = text(input.repository, "repository").toLowerCase();
  if (repository !== metadata.repository) {
    throw new WorkGraphError(
      "delivery_metadata_missing",
      `No generated delivery metadata is available for ${repository}.`,
    );
  }
  const changedPaths = uniqueSorted(
    input.changedPaths.map((path) => normalizePath(path, "changedPath")),
    "changedPaths",
  );
  if (changedPaths.length === 0) {
    throw new WorkGraphError(
      "delivery_paths_missing",
      "A pull request needs changed paths before delivery targets can be resolved.",
    );
  }

  const projectTargets =
    input.ticketProjectId === null
      ? metadata.targets
      : metadata.targets.filter(
          ({ projectId }) => projectId === projectIdentity(input.ticketProjectId ?? ""),
        );
  if (projectTargets.length === 0) {
    throw new WorkGraphError(
      "delivery_project_missing",
      `Generated delivery metadata has no targets for project ${input.ticketProjectId ?? "(unscoped)"}.`,
    );
  }

  const matched = matchDeliveryTargets(metadata, projectTargets, changedPaths);
  validateExclusivePathOwnership(matched, changedPaths);

  const overrideTargetIds = uniqueSorted(
    input.overrideTargetIds ?? [],
    "overrideTargetIds",
  );
  const selected = selectDeliveryTargetOverride(matched, overrideTargetIds);
  const targets = selected
    .map(({ target, bindings }) => ({
      id: target.id,
      projectId: target.projectId,
      subjects: uniqueSorted(
        [
          ...new Set([
            ...target.subjects,
            ...bindings.flatMap(({ binding }) => binding.subjects),
          ]),
        ],
        `resolved subjects for ${target.id}`,
      ),
      sharedHostId: target.sharedHostId,
      matchedPaths: [
        ...new Set(bindings.map(({ changedPath }) => changedPath)),
      ].toSorted((left, right) => left.localeCompare(right)),
      requiredCiNames: target.requiredCiNames,
      productionEnvironments: target.productionEnvironments,
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  return {
    repository,
    sourceRevision: metadata.sourceRevision,
    changedPaths,
    targets,
    subjects: [
      ...new Set(targets.flatMap(({ subjects }) => subjects)),
    ].toSorted((left, right) => left.localeCompare(right)),
    overrideTargetIds,
  };
};
