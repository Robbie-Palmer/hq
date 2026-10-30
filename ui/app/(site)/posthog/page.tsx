import hedgehogDeskWizardPng from "@posthog/brand/hoggies/png/desk-wizard";
import hedgehogHeartPng from "@posthog/brand/hoggies/png/heart";
import { Logo } from "@posthog/brand/logo";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Clapperboard,
  MapPin,
  Music,
  Network,
} from "lucide-react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { siGithub } from "simple-icons";
import {
  type PostHogApplicationLink,
  posthogApplication,
} from "@/content/posthog";
import { cn } from "@/lib/generic/styles";
import { AgentPlatformSection } from "./agent-platform-section";
import { CultureSection } from "./culture-section";
import { PostHogFooterActions } from "./footer-actions";
import { HomelabDiagramSwitcher } from "./homelab-diagram-switcher";
import styles from "./posthog.module.css";

function GitHubIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      role="img"
      viewBox="0 0 24 24"
    >
      <path d={siGithub.path} />
    </svg>
  );
}

const roundHog = localFont({
  src: [
    {
      path: "../../../node_modules/@posthog/brand/dist/fonts/RoundHog.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../../node_modules/@posthog/brand/dist/fonts/RoundHog-Italic.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "../../../node_modules/@posthog/brand/dist/fonts/RoundHog-SemiBold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../../node_modules/@posthog/brand/dist/fonts/RoundHog-Bold.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-roundhog",
});

export const metadata: Metadata = {
  title: "A speculative application to PostHog",
  description: posthogApplication.description,
  alternates: {
    canonical: "/posthog",
    types: { "text/markdown": "/posthog.md" },
  },
  openGraph: {
    title: "PostHog, I want to help products drive themselves",
    description: posthogApplication.description,
    url: "/posthog",
  },
};

function EvidenceLink({ link }: { readonly link: PostHogApplicationLink }) {
  const content = (
    <>
      {link.label}
      {link.external ? (
        <ArrowUpRight className="size-4" aria-hidden="true" />
      ) : (
        <ArrowRight className="size-4" aria-hidden="true" />
      )}
    </>
  );
  const className =
    "inline-flex items-center gap-1.5 text-sm font-bold underline decoration-2 underline-offset-4 hover:decoration-[var(--hog-red)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4";

  if (link.external) {
    return (
      <a
        className={className}
        href={link.href}
        target="_blank"
        rel="noreferrer"
      >
        {content}
      </a>
    );
  }

  return (
    <Link className={className} href={link.href}>
      {content}
    </Link>
  );
}

const stageColours = ["#f5c842", "#f05b52", "#1490e8", "#4e9b75"];
const personalityIcons = [BookOpen, Music, Clapperboard];

type PersonalityItem =
  (typeof posthogApplication.weirdness.personality.items)[number];

function PersonalityCard({
  item,
  index,
}: {
  readonly item: PersonalityItem;
  readonly index: number;
}) {
  const Icon = personalityIcons[index] ?? BookOpen;
  const className = cn(
    styles.personalityCard,
    "group flex min-h-full flex-col p-6 sm:p-7",
  );
  const style = {
    "--personality-accent": stageColours[index],
  } as CSSProperties;
  const content = (
    <>
      <div className="flex items-center gap-3">
        {"image" in item ? (
          <Image
            alt={item.imageAlt}
            className="size-20 shrink-0 rounded-full border-2 border-[var(--hog-ink)] object-cover shadow-[3px_3px_0_var(--hog-ink)]"
            height={96}
            src={item.image}
            width={96}
          />
        ) : (
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--hog-ink)]"
            style={{ backgroundColor: stageColours[index] }}
          >
            <Icon className="size-5" aria-hidden="true" />
          </span>
        )}
        <p className="font-mono text-[0.65rem] font-black uppercase tracking-[0.12em] text-black/55">
          {item.eyebrow}
        </p>
      </div>
      <h4 className="mt-6 text-2xl font-black leading-tight">{item.title}</h4>
      <p className="mt-4 flex-1 font-bold leading-7 text-black/70">
        {item.description}
      </p>
      {"href" in item && (
        <span className="mt-6 inline-flex items-center gap-2 font-black underline decoration-2 underline-offset-4">
          {item.linkLabel}
          {"external" in item && item.external ? (
            <ArrowUpRight className="size-4" aria-hidden="true" />
          ) : (
            <ArrowRight className="size-4" aria-hidden="true" />
          )}
        </span>
      )}
      {"links" in item && (
        <div className="mt-6 flex flex-col items-start gap-3">
          {item.links.map((link) => (
            <a
              className="inline-flex items-center gap-2 font-black underline decoration-2 underline-offset-4 hover:decoration-[var(--hog-blue)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4"
              href={link.href}
              key={link.href}
              rel="noreferrer"
              target="_blank"
            >
              {link.label}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
    </>
  );

  if ("href" in item) {
    if ("external" in item && item.external) {
      return (
        <a
          className={className}
          href={item.href}
          rel="noreferrer"
          style={style}
          target="_blank"
        >
          {content}
        </a>
      );
    }

    return (
      <Link className={className} href={item.href} style={style}>
        {content}
      </Link>
    );
  }

  return (
    <article className={className} style={style}>
      {content}
    </article>
  );
}

export default function PostHogApplicationPage() {
  return (
    <div className={cn(styles.page, roundHog.variable)}>
      <section className="relative mx-auto grid min-h-[calc(100vh-5rem)] max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] lg:px-12">
        <div className="relative z-10">
          <div className="mb-8 flex items-center gap-3 text-lg font-bold">
            <span>Dear</span>
            <Logo size={132} title="PostHog" />
            <span>,</span>
          </div>
          <h1 className="max-w-4xl text-5xl font-black leading-[0.94] tracking-[-0.045em] sm:text-6xl lg:text-7xl xl:text-[5.6rem]">
            I want to help products{" "}
            <span className={styles.scribble}>drive themselves</span>.
          </h1>
          <a
            className={cn(styles.heroTeaser, "group mt-7 block max-w-2xl")}
            href="#specific-weirdness"
          >
            <div className="flex items-center justify-between gap-4 border-b-2 border-[var(--hog-ink)] px-3 py-2.5 sm:px-4">
              <p className="text-xs font-black uppercase tracking-[0.15em] sm:text-sm">
                A preview of the weirdness
              </p>
              <span className="shrink-0 text-xs font-black underline decoration-2 underline-offset-2">
                See the through-line ↓
              </span>
            </div>
            <div className="grid grid-cols-4">
              {posthogApplication.weirdness.artefacts
                .slice(0, 4)
                .map((artefact) =>
                  "image" in artefact ? (
                    <div
                      className={cn(
                        styles.heroTeaserItem,
                        "relative aspect-square overflow-hidden",
                      )}
                      key={artefact.title}
                    >
                      <Image
                        alt=""
                        className={
                          artefact.imageFit === "contain"
                            ? "size-full object-contain"
                            : "size-full object-cover"
                        }
                        height={artefact.imageHeight}
                        priority
                        sizes="(min-width: 640px) 160px, 25vw"
                        src={artefact.image}
                        width={artefact.imageWidth}
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-[var(--hog-ink)]/90 px-1.5 py-1 text-center text-[0.58rem] font-black uppercase tracking-[0.08em] text-white sm:px-2 sm:py-1.5 sm:text-xs">
                        {artefact.shortTitle}
                      </span>
                    </div>
                  ) : null,
                )}
            </div>
          </a>
          <p className="mt-8 max-w-2xl text-lg font-medium leading-8 sm:text-xl">
            You are building the data context and tooling that enable products
            to understand what is happening and to act on it. I keep arriving at
            the same problem from wildly different directions: cancer
            diagnostics, logistics yards, satellite swarms, household finance,
            recipes, and software agents. I turn messy systems into models, then
            build the data and feedback loops that make them adapt.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              className="inline-flex items-center gap-2 border-2 border-[var(--hog-ink)] bg-[var(--hog-ink)] px-5 py-3 font-black text-[#fffdf8] shadow-[4px_4px_0_var(--hog-red)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4"
              href="#fit"
            >
              See where I might fit
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
            <a
              className="inline-flex items-center gap-2 border-2 border-[var(--hog-ink)] bg-[#fffdf8] px-5 py-3 font-black shadow-[4px_4px_0_var(--hog-ink)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4"
              href="#agent-platform"
            >
              See the PostHog parallel
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          </div>
          <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm font-bold">
            <span className="inline-flex items-center gap-2">
              <MapPin
                className="size-4 text-[var(--hog-red)]"
                aria-hidden="true"
              />
              Belfast, UK
            </span>
            <span className="inline-flex items-center gap-2">
              <Network
                className="size-4 text-[var(--hog-blue)]"
                aria-hidden="true"
              />
              Product · ML · systems · teams
            </span>
            <span className="inline-flex items-center gap-2">
              <Check
                className="size-4 text-[var(--hog-green)]"
                aria-hidden="true"
              />
              Remote role
            </span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-xl pb-7 pt-48 sm:pt-56">
          <Image
            alt="Max the PostHog hedgehog working at a laptop"
            className={cn(
              styles.hoggie,
              "absolute -right-4 top-0 z-10 h-auto w-64 sm:right-3 sm:w-80",
            )}
            height={320}
            priority
            src={hedgehogDeskWizardPng}
            width={320}
          />
          <aside
            className={cn(
              styles.terminalPanel,
              "relative rotate-[1deg] p-5 sm:p-7",
            )}
          >
            <div className="mb-6 flex items-center gap-2 border-b border-white/20 pb-4">
              <span className="size-3 rounded-full bg-[var(--hog-red)]" />
              <span className="size-3 rounded-full bg-[var(--hog-yellow)]" />
              <span className="size-3 rounded-full bg-[var(--hog-green)]" />
              <span className="ml-auto font-mono text-xs text-white/55">
                curiosity.log
              </span>
            </div>
            <div className="space-y-5 font-mono text-sm leading-6 sm:text-base">
              <p className="text-white/55">$ cat ~/current-obsessions</p>
              <p className="break-words text-[var(--hog-yellow)]">
                work is not the only place I get weird
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 border-y border-white/20 py-5">
                <dt className="text-white/45">essay</dt>
                <dd>Gödel → data mesh</dd>
                <dt className="text-white/45">dance</dt>
                <dd>solo jazz</dd>
                <dt className="text-white/45">watch</dt>
                <dd>Shrek through Marx</dd>
                <dt className="text-white/45">next</dt>
                <dd>1.5h Barbie deconstruction</dd>
              </dl>
              <p className="flex items-start gap-2 text-[#bce7ce]">
                <Check className="mt-1 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Curiosity does not clock out when the laptop closes.
                </span>
              </p>
            </div>
          </aside>
        </div>
      </section>

      <AgentPlatformSection />

      <section
        id="specific-weirdness"
        className="scroll-mt-20 border-b-2 border-[var(--hog-ink)] bg-[var(--hog-ink)] text-[#fffdf8]"
      >
        <div className="mx-auto grid max-w-7xl gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-12">
          <div className="min-w-0 lg:col-span-2">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b-2 border-white/25 pb-5">
              <div>
                <h2 className="mt-2 text-4xl font-black tracking-[-0.04em] sm:text-6xl">
                  What the weirdness looks like.
                </h2>
              </div>
              <p className="max-w-md text-sm font-bold leading-6 text-white/60">
                Six domains. All with the same urge to turn a messy system into
                something visible, explorable, and useful.
              </p>
            </div>

            <div className="grid items-start gap-8 md:grid-cols-2">
              {posthogApplication.weirdness.artefacts.map((artefact, index) => {
                const cardClassName = cn(
                  styles.artefactCard,
                  "group block min-w-0 self-start",
                  index % 2 === 0
                    ? "md:rotate-[-0.35deg]"
                    : "md:rotate-[0.35deg]",
                );
                const cardStyle = {
                  "--artefact-accent": artefact.accent,
                } as CSSProperties;

                if ("chart" in artefact) {
                  return (
                    <article
                      className={cardClassName}
                      key={artefact.title}
                      style={cardStyle}
                    >
                      <Link
                        className="flex items-center gap-3 p-4 sm:p-5"
                        href={artefact.href}
                      >
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-[var(--hog-ink)] font-mono text-xs font-black"
                          style={{ backgroundColor: artefact.accent }}
                        >
                          {artefact.number}
                        </span>
                        <div className="min-w-0">
                          <h4 className="truncate text-lg font-black">
                            {artefact.title}
                          </h4>
                          <p className="truncate font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] text-black/50">
                            {artefact.meta}
                          </p>
                        </div>
                        <ArrowUpRight
                          className="ml-auto size-5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </Link>
                      <HomelabDiagramSwitcher
                        detailAlt={artefact.detailAlt}
                        detailChart={artefact.detailChart}
                        detailChartTitle={artefact.detailChartTitle}
                        overviewAlt={artefact.alt}
                        overviewChart={artefact.chart}
                        overviewChartTitle={artefact.chartTitle}
                      />
                      <div className="p-5 font-bold leading-7 sm:p-6">
                        <p>{artefact.description}</p>
                        <Link
                          className="mt-4 inline-flex items-center gap-2 underline decoration-2 underline-offset-4"
                          href={artefact.href}
                        >
                          Explore the home lab
                          <ArrowRight className="size-4" aria-hidden="true" />
                        </Link>
                      </div>
                    </article>
                  );
                }

                return (
                  <Link
                    className={cardClassName}
                    href={artefact.href}
                    key={artefact.title}
                    style={cardStyle}
                  >
                    <div className="flex items-center gap-3 p-4 sm:p-5">
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-[var(--hog-ink)] font-mono text-xs font-black"
                        style={{ backgroundColor: artefact.accent }}
                      >
                        {artefact.number}
                      </span>
                      <div className="min-w-0">
                        <h4 className="truncate text-lg font-black">
                          {artefact.title}
                        </h4>
                        <p className="truncate font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] text-black/50">
                          {artefact.meta}
                        </p>
                      </div>
                      <ArrowUpRight
                        className="ml-auto size-5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </div>
                    <div
                      className={cn(
                        styles.artefactImage,
                        "relative aspect-[16/9]",
                      )}
                    >
                      <Image
                        alt={artefact.alt}
                        className={
                          artefact.imageFit === "contain"
                            ? "size-full object-contain"
                            : "size-full object-cover"
                        }
                        height={artefact.imageHeight}
                        sizes="(min-width: 768px) 42vw, 90vw"
                        src={artefact.image}
                        width={artefact.imageWidth}
                      />
                    </div>
                    <p className="p-5 font-bold leading-7 sm:p-6">
                      {artefact.description}
                      {"credit" in artefact && (
                        <span className="mt-3 block font-mono text-[0.65rem] font-black uppercase tracking-[0.12em] text-black/50">
                          {artefact.credit}
                        </span>
                      )}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="mt-8 grid min-w-0 gap-14 border-t-2 border-white/25 pt-12 lg:col-span-2 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--hog-yellow)]">
                The through-line
              </p>
              <h3 className="mt-3 break-words text-4xl font-black tracking-[-0.04em] sm:text-6xl">
                The subjects vary. The passion for building is consistent.
              </h3>
              <blockquote
                className={cn(
                  styles.weirdQuote,
                  "mt-10 w-full max-w-full p-6 text-2xl font-black leading-tight sm:p-8 sm:text-3xl",
                )}
              >
                <p className="break-words">
                  &ldquo;{posthogApplication.weirdness.quote}&rdquo;
                </p>
                <footer className="mt-5 text-sm font-bold">
                  {posthogApplication.weirdness.attribution}
                </footer>
              </blockquote>
            </div>

            <div className="flex min-w-0 flex-col justify-center">
              <p className="text-2xl font-black leading-snug sm:text-3xl">
                {posthogApplication.weirdness.intro}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {posthogApplication.weirdness.threads.map((thread) => (
                  <span
                    className={cn(
                      styles.thread,
                      "px-4 py-2 text-sm font-black",
                    )}
                    key={thread}
                  >
                    {thread}
                  </span>
                ))}
              </div>
              <p className="mt-9 text-lg font-medium leading-8 text-white/80">
                {posthogApplication.weirdness.conclusion}
              </p>
              <a
                className="mt-6 grid overflow-hidden border-l-4 border-[var(--hog-red)] bg-white/10 font-bold leading-7 text-white/90 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-4 sm:grid-cols-[11rem_1fr]"
                href={posthogApplication.weirdness.posthogParallelHref}
                target="_blank"
                rel="noreferrer"
              >
                <Image
                  alt={posthogApplication.weirdness.posthogParallelImageAlt}
                  className="h-44 w-full bg-[var(--hog-paper-deep)] object-contain p-3 sm:h-full sm:min-h-44"
                  height={1043}
                  sizes="(min-width: 640px) 176px, 100vw"
                  src={posthogApplication.weirdness.posthogParallelImage}
                  width={1260}
                />
                <span className="self-center px-5 py-4">
                  {posthogApplication.weirdness.posthogParallel}
                  <ArrowUpRight
                    className="ml-2 inline size-4 align-[-0.1em]"
                    aria-hidden="true"
                  />
                </span>
              </a>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-4">
                {posthogApplication.weirdness.projects.map((project) => (
                  <Link
                    className="inline-flex items-center gap-1.5 font-black underline decoration-2 underline-offset-4 hover:decoration-[var(--hog-yellow)] focus-visible:outline-2 focus-visible:outline-offset-4"
                    href={project.href}
                    key={project.href}
                  >
                    {project.label}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 min-w-0 border-t-2 border-white/25 pt-12 lg:col-span-2">
            <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
              <div>
                <h3 className="mt-2 text-3xl font-black sm:text-5xl">
                  {posthogApplication.weirdness.personality.heading}
                </h3>
              </div>
              <p className="text-lg font-bold leading-8 text-white/75">
                {posthogApplication.weirdness.personality.introBefore}
                <a
                  className="underline decoration-2 underline-offset-4 hover:decoration-[var(--hog-yellow)] focus-visible:outline-2 focus-visible:outline-offset-4"
                  href={posthogApplication.weirdness.personality.introLink.href}
                  rel="noreferrer"
                  target="_blank"
                >
                  {posthogApplication.weirdness.personality.introLink.label}
                </a>
                {posthogApplication.weirdness.personality.introAfter}
              </p>
            </div>
            <div className="mt-9 grid gap-7 md:grid-cols-3">
              {posthogApplication.weirdness.personality.items.map(
                (item, index) => (
                  <PersonalityCard index={index} item={item} key={item.title} />
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      <CultureSection />

      <section id="evidence" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-12">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--hog-blue)]">
              Direct evidence
            </p>
            <h2 className="mt-3 text-4xl font-black tracking-[-0.04em] sm:text-6xl">
              The work is public. You can inspect it.
            </h2>
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            {posthogApplication.evidence.map((item, index) => (
              <article
                className={cn(
                  styles.evidenceCard,
                  "flex min-h-full flex-col p-6 sm:p-8",
                )}
                key={item.title}
              >
                <div className="mb-8 flex items-center gap-3">
                  <span
                    className="block h-3 w-12 border-2 border-[var(--hog-ink)]"
                    style={{ backgroundColor: stageColours[index] }}
                  />
                  <span className="text-xs font-black uppercase tracking-[0.18em]">
                    {item.eyebrow}
                  </span>
                </div>
                <h3 className="text-3xl font-black leading-tight tracking-[-0.03em]">
                  {item.title}
                </h3>
                <p className="mt-5 flex-1 font-medium leading-7">
                  {item.description}
                </p>
                <div className="mt-8 flex flex-col items-start gap-4">
                  {item.links.map((link) => (
                    <EvidenceLink key={link.href} link={link} />
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y-2 border-[var(--hog-ink)] bg-[var(--hog-yellow)]">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-12">
          <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em]">
                What I bring
              </p>
              <h2 className="mt-3 text-4xl font-black tracking-[-0.035em] sm:text-5xl">
                One builder across the whole system.
              </h2>
              <Link
                className="mt-7 inline-flex items-center gap-2 font-black underline decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                href={posthogApplication.links.experience}
              >
                CV and experience
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {posthogApplication.experience.map((item) => (
                <article
                  className="border-t-2 border-[var(--hog-ink)] pt-4"
                  key={item.title}
                >
                  <h3 className="text-lg font-black">{item.title}</h3>
                  <p className="mt-2 font-medium leading-7">{item.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="fit"
        className="mx-auto grid max-w-7xl scroll-mt-20 gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:px-12"
      >
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--hog-green)]">
            Where I might fit
          </p>
          <div className="mt-3 flex items-start gap-3 sm:gap-6">
            <h2 className="text-4xl font-black tracking-[-0.035em] sm:text-5xl">
              A few places I might be useful.
            </h2>
            <Image
              alt="Max the PostHog hedgehog holding a heart"
              className={cn(
                styles.hoggie,
                "-mt-5 h-auto w-24 shrink-0 sm:w-32",
              )}
              height={132}
              src={hedgehogHeartPng}
              width={132}
            />
          </div>
          <div className="mt-8 space-y-5 text-lg font-medium leading-8">
            {posthogApplication.fit.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>

        <aside className={cn(styles.paperPanel, "self-start p-6 sm:p-9")}>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--hog-red)]">
            The ask
          </p>
          <p className="mt-5 text-3xl font-black leading-tight tracking-[-0.03em] sm:text-4xl">
            {posthogApplication.ask.headline.before}
            <em>{posthogApplication.ask.headline.emphasis}</em>
            {posthogApplication.ask.headline.after}
          </p>
          <p className="mt-7 text-lg font-bold leading-7">
            {posthogApplication.ask.plan.intro}
          </p>
          <ul className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {posthogApplication.ask.plan.items.map((item) => (
              <li className="flex items-start gap-2 font-bold" key={item}>
                <Check
                  className="mt-0.5 size-5 shrink-0 text-[var(--hog-green)]"
                  strokeWidth={3}
                  aria-hidden="true"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <a
            className="mt-6 inline-flex items-center gap-2 font-black underline decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
            href={posthogApplication.ask.plan.href}
            target="_blank"
            rel="noreferrer"
          >
            {posthogApplication.ask.plan.label}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
          <div className="mt-8 space-y-5 border-t-2 border-[var(--hog-ink)] pt-7 font-medium leading-7">
            <p>{posthogApplication.ask.evidence}</p>
            <p className="font-black">{posthogApplication.ask.background}</p>
          </div>
          <div className="mt-8 flex flex-col items-start gap-4">
            <Link
              className="inline-flex w-full items-center justify-between gap-3 border-2 border-[var(--hog-ink)] bg-[var(--hog-ink)] px-5 py-3 font-black text-[#fffdf8] shadow-[4px_4px_0_var(--hog-red)] focus-visible:outline-2 focus-visible:outline-offset-4"
              href={posthogApplication.links.initiative}
            >
              Read what I am building towards
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:gap-x-6">
              <a
                className="inline-flex items-center gap-2 font-black underline decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                href={posthogApplication.links.github}
                target="_blank"
                rel="noreferrer"
              >
                <GitHubIcon className="size-4" />
                Inspect my GitHub
              </a>
              <a
                className="inline-flex items-center gap-2 font-black underline decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                href={posthogApplication.links.linkedin}
                target="_blank"
                rel="noreferrer"
              >
                Connect on LinkedIn
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </aside>
      </section>
      <PostHogFooterActions />
    </div>
  );
}
