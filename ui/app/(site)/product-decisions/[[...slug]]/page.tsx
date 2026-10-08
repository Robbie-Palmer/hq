import { Calendar, ExternalLink, FileCheck2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getAllProductDecisions,
  getProductDecision,
} from "@/lib/api/product-decisions";
import { siteConfig } from "@/lib/config/site-config";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

type ProductDecisionView = NonNullable<ReturnType<typeof getProductDecision>>;

interface RelatedRecord {
  external?: boolean;
  href: string;
  key: string;
  label: string;
  title: string;
}

export function generateStaticParams() {
  return [
    { slug: [] },
    ...getAllProductDecisions().map(({ slug }) => ({ slug: [slug] })),
  ];
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const decisionSlug = slug?.[0];
  if (!decisionSlug) {
    return {
      title: "Product decisions",
      description:
        "Durable choices about product behaviour, scope, and policy.",
      alternates: { canonical: "/product-decisions" },
    };
  }
  const decision = getProductDecision(decisionSlug);
  if (!decision) return { title: "Product decision not found" };
  const url = `${siteConfig.url}/product-decisions/${decisionSlug}`;
  return {
    title: `${decision.title} - Product decision`,
    description: `Product Decision Record: ${decision.title}`,
    alternates: { canonical: url },
  };
}

function ProductDecisionIndex() {
  const decisions = getAllProductDecisions();
  return (
    <div className="container mx-auto max-w-6xl px-4 py-12">
      <header className="mb-10 max-w-3xl space-y-4">
        <div className="flex items-center gap-3">
          <FileCheck2 className="size-8 text-primary" />
          <h1 className="text-4xl font-bold md:text-5xl">Product decisions</h1>
        </div>
        <p className="text-xl leading-relaxed text-muted-foreground">
          Durable choices about who a product is for, what it promises, and how
          its scope and policies change over time.
        </p>
      </header>
      {decisions.length === 0 ? (
        <p className="rounded-lg border bg-muted/30 p-4 text-muted-foreground">
          No product decisions have been published yet.
        </p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {decisions.map((decision) => (
            <Link
              key={decision.slug}
              href={`/product-decisions/${decision.slug}`}
            >
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>{decision.title}</CardTitle>
                    <Badge variant="secondary">{decision.status}</Badge>
                  </div>
                  <CardDescription>
                    Opened {decision.date} · {decision.readingTime}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductDecisionHeader({
  decision,
}: Readonly<{ decision: ProductDecisionView }>) {
  return (
    <header className="space-y-4">
      <h1 className="text-3xl font-bold md:text-4xl">{decision.title}</h1>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Badge variant="secondary">{decision.status}</Badge>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Calendar className="size-4" /> {decision.date}
        </span>
        <span className="text-muted-foreground">{decision.readingTime}</span>
      </div>
      {decision.supersedes && (
        <p className="rounded-lg border bg-muted/30 p-4 text-sm">
          Supersedes{" "}
          <Link
            className="font-medium underline underline-offset-4"
            href={`/product-decisions/${decision.supersedes}`}
          >
            {decision.supersedes}
          </Link>
        </p>
      )}
      {decision.supersededBy && (
        <p className="rounded-lg border bg-muted/30 p-4 text-sm">
          Superseded by{" "}
          <Link
            className="font-medium underline underline-offset-4"
            href={`/product-decisions/${decision.supersededBy}`}
          >
            {decision.supersededBy}
          </Link>
        </p>
      )}
    </header>
  );
}

function relatedRecords(decision: ProductDecisionView): RelatedRecord[] {
  return [
    ...decision.backlinks.projects.map((project) => ({
      key: `project:${project.slug}`,
      label: "Project",
      href: `/projects/${project.slug}`,
      title: project.title,
    })),
    ...decision.backlinks.ideas.map((idea) => ({
      key: `idea:${idea.slug}`,
      label: "Idea",
      href: `/ideas/${idea.slug}`,
      title: idea.title,
    })),
    ...decision.backlinks.informedByADRs.map((adr) => ({
      key: `informed:${adr.adrRef}`,
      label: "Informed by",
      href: `/projects/${adr.projectSlug}/adrs/${adr.slug}`,
      title: adr.title,
    })),
    ...decision.backlinks.implementingADRs.map((adr) => ({
      key: `implemented:${adr.adrRef}`,
      label: "Implemented by",
      href: `/projects/${adr.projectSlug}/adrs/${adr.slug}`,
      title: adr.title,
    })),
    ...decision.backlinks.blogs.map((blog) => ({
      key: `blog:${blog.slug}`,
      label: "Blog post",
      href: `/blog/${blog.slug}`,
      title: blog.title,
    })),
    ...decision.backlinks.evidence.map((evidence) => ({
      key: `evidence:${evidence.url}`,
      label: "Evidence",
      href: evidence.url,
      title: evidence.title,
      external: true,
    })),
  ];
}

function RelatedRecords({
  decision,
}: Readonly<{ decision: ProductDecisionView }>) {
  return (
    <section className="space-y-4" aria-labelledby="decision-links">
      <h2 id="decision-links" className="text-2xl font-semibold">
        Related records
      </h2>
      <ul className="space-y-2 text-sm">
        {relatedRecords(decision).map((record) => (
          <li key={record.key}>
            {record.label}:{" "}
            {record.external ? (
              <a
                className="inline-flex items-center gap-1 underline"
                href={record.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {record.title}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <Link className="underline" href={record.href}>
                {record.title}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function ProductDecisionPage({
  params,
}: Readonly<PageProps>) {
  const { slug } = await params;
  const decisionSlug = slug?.[0];
  if (!decisionSlug) return <ProductDecisionIndex />;
  if (slug.length !== 1) notFound();
  const decision = getProductDecision(decisionSlug);
  if (!decision) notFound();
  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <nav
        className="mb-8 text-sm text-muted-foreground"
        aria-label="Breadcrumb"
      >
        <Link href="/product-decisions" className="hover:underline">
          Product decisions
        </Link>
      </nav>
      <ProductDecisionHeader decision={decision} />
      <Separator className="my-8" />
      <Markdown source={decision.content} />
      <Separator className="my-8" />
      <RelatedRecords decision={decision} />
    </div>
  );
}
