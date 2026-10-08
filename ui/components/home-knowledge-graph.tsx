import { DeferredKnowledgeGraph } from "@/components/deferred-knowledge-graph";
import { extractGraphData } from "@/lib/api/graph-data";
import { loadDomainRepository } from "@/lib/domain";

export function HomeKnowledgeGraph() {
  const data = extractGraphData(loadDomainRepository());
  const contentTypeCount = new Set(data.nodes.map((node) => node.type)).size;

  const stats = [
    { label: "items", value: data.nodes.length },
    { label: "connections", value: data.edges.length },
    { label: "content types", value: contentTypeCount },
  ];

  return (
    <section
      className="relative isolate pb-16 sm:pb-20 lg:pb-24"
      aria-labelledby="knowledge-graph-heading"
    >
      <div
        className="pointer-events-none absolute inset-x-8 top-1/3 -z-10 h-2/3 rounded-full bg-primary/5 blur-3xl"
        aria-hidden="true"
      />

      <div className="mx-auto mb-8 grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-2xl">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Inside the site
          </p>
          <h2
            id="knowledge-graph-heading"
            className="text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Follow the connections
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg">
            The site is stored as connected data. Projects link to research
            papers, architecture decisions, the tools used to build them, and
            the ideas, writing, and roles that shaped them. Pick a node to
            follow those links.
          </p>
        </div>

        <dl className="grid grid-cols-3 divide-x overflow-hidden rounded-xl border bg-card/80 shadow-sm backdrop-blur-sm">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex min-w-0 flex-col px-3 py-3 text-center sm:px-6 sm:py-4"
            >
              <dt className="order-2 mt-0.5 truncate text-[0.6875rem] text-muted-foreground sm:text-xs">
                {stat.label}
              </dt>
              <dd className="order-1 text-xl font-bold tabular-nums sm:text-2xl">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="relative mx-auto max-w-6xl">
        <div
          className="absolute -inset-3 -z-10 rounded-[1.25rem] border border-primary/5 bg-card/30 sm:-inset-5"
          aria-hidden="true"
        />
        <DeferredKnowledgeGraph />
      </div>
    </section>
  );
}
