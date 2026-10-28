const checks = [
  "The shared Next.js application mounted this project-owned UI.",
  "The fixture stays out of the public project catalog and knowledge graph.",
  "The disposable provider preview uses synthetic data only.",
];

export function PlatformBootstrapCanaryApp() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Incubation route
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Platform bootstrap canary
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          This small application proves that a Copier-managed project can mount
          inside the shared site without becoming a knowledge-graph project.
        </p>
      </div>

      <ul className="space-y-3" aria-label="Canary guarantees">
        {checks.map((check) => (
          <li
            key={check}
            className="rounded-lg border border-border bg-card px-4 py-3 text-card-foreground"
          >
            {check}
          </li>
        ))}
      </ul>
    </main>
  );
}
