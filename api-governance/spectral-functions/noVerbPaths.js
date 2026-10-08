const DEFAULT_VERB_PREFIXES = [
  "import",
  "restore",
  "recommend",
  "generate",
  "validate",
  "sync",
  "create",
  "update",
  "delete",
  "fetch",
  "send",
];

const noVerbPaths = (path, options = {}) => {
  if (typeof path !== "string") return [];

  const allowedSegments = new Set(options.allowedSegments ?? []);
  const verbPrefixes = new Set(
    options.verbPrefixes ?? DEFAULT_VERB_PREFIXES,
  );
  const results = [];

  for (const segment of path.split("/")) {
    if (!segment || segment.startsWith("{") || allowedSegments.has(segment)) {
      continue;
    }
    if (verbPrefixes.has(segment.split("-")[0])) {
      results.push({
        message: `path segment '${segment}' is a verb; model it as a resource`,
      });
    }
  }

  return results;
};

export default noVerbPaths;
