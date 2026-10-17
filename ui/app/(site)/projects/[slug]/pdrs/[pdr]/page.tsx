import { Calendar, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  getAllProductDecisions,
  getProductDecision,
} from "@/lib/api/product-decisions";
import { siteConfig } from "@/lib/config/site-config";
import { productDecisionPath } from "@/lib/domain/product-decision";

interface PageProps {
  params: Promise<{ slug: string; pdr: string }>;
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
  return getAllProductDecisions().map((decision) => ({
    slug: decision.projectSlug,
    pdr: decision.slug,
  }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, pdr } = await params;
  const decision = getProductDecision(`${slug}:${pdr}`);
  if (!decision) return { title: "Product decision not found" };
  return {
    title: `${decision.title} - Product decision`,
    description: `Product Decision Record: ${decision.title}`,
    alternates: {
      canonical: `${siteConfig.url}${productDecisionPath(decision.pdrRef)}`,
    },
  };
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
            href={productDecisionPath(decision.supersedes)}
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
            href={productDecisionPath(decision.supersededBy)}
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
  const { slug, pdr } = await params;
  const decision = getProductDecision(`${slug}:${pdr}`);
  if (!decision) notFound();
  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <nav
        className="mb-8 text-sm text-muted-foreground"
        aria-label="Breadcrumb"
      >
        <Link
          href={`/projects/${decision.projectSlug}`}
          className="hover:underline"
        >
          {decision.projectTitle}
        </Link>
        {" / "}
        <Link
          href={`/projects/${decision.projectSlug}?tab=pdrs`}
          className="hover:underline"
        >
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
