const pluralCollections = (path, options = {}) => {
  if (typeof path !== "string") return [];

  const singletons = new Set(options.singletons ?? []);
  const segments = path.split("/").filter(Boolean);
  const results = [];

  segments.forEach((segment, index) => {
    const next = segments[index + 1];
    const isCollection = Boolean(next?.startsWith("{"));
    if (!isCollection || segment.startsWith("{")) return;
    if (singletons.has(segment) || segment.endsWith("s")) return;
    results.push({ message: `collection '${segment}' should be plural` });
  });

  return results;
};

export default pluralCollections;
