import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { posthogApplication } from "@/content/posthog";
import { TechIcon } from "@/lib/api/tech-icons";
import { cn } from "@/lib/generic/styles";
import styles from "./posthog.module.css";

export function AgentPlatformSection() {
  return (
    <section
      id="agent-platform"
      className="scroll-mt-20 border-y-2 border-[var(--hog-ink)] bg-[#dcedfb]"
    >
      <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--hog-red)]">
              {posthogApplication.agentPlatform.eyebrow}
            </p>
            <h2 className="mt-3 text-4xl font-black tracking-[-0.04em] sm:text-6xl">
              {posthogApplication.agentPlatform.heading}
            </h2>
          </div>
          <div className="self-end">
            <p className="text-lg font-bold leading-8">
              {posthogApplication.agentPlatform.intro}
            </p>
            <a
              className="mt-5 inline-flex items-center gap-2 font-black underline decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
              href={posthogApplication.agentPlatform.posthogLink.href}
              rel="noreferrer"
              target="_blank"
            >
              {posthogApplication.agentPlatform.posthogLink.label}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="mt-14 grid min-w-0 items-stretch gap-5 lg:grid-cols-[0.9fr_auto_1.25fr_auto_1fr] lg:gap-4">
          <Link
            className={cn(
              styles.paperPanel,
              "group flex min-w-0 flex-col p-6 sm:p-7",
            )}
            href={posthogApplication.agentPlatform.workspace.href}
          >
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-xs font-black uppercase tracking-[0.16em] text-black/55">
                {posthogApplication.agentPlatform.workspace.number} ·{" "}
                {posthogApplication.agentPlatform.workspace.eyebrow}
              </span>
              <span className="size-3 rounded-full border-2 border-[var(--hog-ink)] bg-[var(--hog-green)]" />
            </div>
            <h3 className="mt-6 text-3xl font-black leading-tight tracking-[-0.03em]">
              {posthogApplication.agentPlatform.workspace.title}
            </h3>
            <p className="mt-4 flex-1 font-bold leading-7 text-black/70">
              {posthogApplication.agentPlatform.workspace.detail}
            </p>
            <p className="mt-6 font-mono text-[0.68rem] font-black uppercase tracking-[0.12em] text-black/55">
              {posthogApplication.agentPlatform.workspace.status}
            </p>
            <span className="mt-4 inline-flex items-center gap-2 font-black underline decoration-2 underline-offset-4">
              {posthogApplication.agentPlatform.workspace.linkLabel}
              <ArrowRight className="size-4" aria-hidden="true" />
            </span>
          </Link>

          <ArrowRight
            className="mx-auto size-7 rotate-90 self-center lg:rotate-0"
            aria-hidden="true"
          />

          <article
            className={cn(
              styles.terminalPanel,
              "flex min-w-0 flex-col p-6 sm:p-7",
            )}
          >
            <div className="flex items-center gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-white p-2">
                <TechIcon
                  className="size-full"
                  iconSlug="t3code"
                  name="t3-code"
                />
              </span>
              <div>
                <p className="font-mono text-xs font-black uppercase tracking-[0.16em] text-white/55">
                  {posthogApplication.agentPlatform.hub.number} ·{" "}
                  {posthogApplication.agentPlatform.hub.eyebrow}
                </p>
                <h3 className="mt-1 text-2xl font-black">
                  {posthogApplication.agentPlatform.hub.title}
                </h3>
              </div>
            </div>
            <p className="mt-5 font-bold leading-7 text-white/75">
              {posthogApplication.agentPlatform.hub.detail}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {posthogApplication.agentPlatform.harnesses.map((harness) => (
                <div
                  className="flex min-w-0 items-center gap-3 border-2 border-white/30 bg-white/10 p-3"
                  key={harness.name}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white p-2 text-[var(--hog-ink)]">
                    <TechIcon
                      className="size-full"
                      iconSlug={harness.iconSlug}
                      invertInDarkMode={false}
                      name={harness.iconName}
                    />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-sm">
                      {harness.name}
                    </strong>
                    <span className="block truncate font-mono text-[0.64rem] font-bold uppercase tracking-[0.1em] text-white/55">
                      {harness.detail}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <Link
              className="mt-6 inline-flex items-center gap-2 self-start font-black underline decoration-2 underline-offset-4"
              href={posthogApplication.agentPlatform.hub.href}
            >
              {posthogApplication.agentPlatform.hub.linkLabel}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </article>

          <ArrowRight
            className="mx-auto size-7 rotate-90 self-center lg:rotate-0"
            aria-hidden="true"
          />

          <article
            className={cn(
              styles.paperPanel,
              "flex min-w-0 flex-col p-6 sm:p-7",
            )}
          >
            <p className="font-mono text-xs font-black uppercase tracking-[0.16em] text-black/55">
              {posthogApplication.agentPlatform.shared.number} ·{" "}
              {posthogApplication.agentPlatform.shared.eyebrow}
            </p>
            <h3 className="mt-6 text-3xl font-black leading-tight tracking-[-0.03em]">
              {posthogApplication.agentPlatform.shared.title}
            </h3>
            <p className="mt-4 font-bold leading-7 text-black/70">
              {posthogApplication.agentPlatform.shared.detail}
            </p>
            <div className="mt-6 space-y-4">
              {posthogApplication.agentPlatform.shared.services.map(
                (service) => (
                  <Link
                    className="group block border-t-2 border-[var(--hog-ink)] pt-3"
                    href={service.href}
                    key={service.name}
                  >
                    <span className="flex items-center justify-between gap-3 font-black underline decoration-2 underline-offset-4">
                      {service.name}
                      <ArrowRight
                        className="size-4 shrink-0 transition-transform group-hover:translate-x-1"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mt-1 block text-sm font-bold leading-5 text-black/60">
                      {service.detail}
                    </span>
                  </Link>
                ),
              )}
            </div>
          </article>
        </div>

        <div className="mt-10 grid gap-5 border-2 border-[var(--hog-ink)] bg-[var(--hog-yellow)] p-6 shadow-[6px_6px_0_var(--hog-ink)] sm:p-8 lg:grid-cols-2 lg:gap-12">
          <p className="text-xl font-black leading-8">
            {posthogApplication.agentPlatform.writingPrinciple}
          </p>
          <p className="font-bold leading-7 text-black/70">
            {posthogApplication.agentPlatform.routingPrinciple}
          </p>
        </div>
      </div>
    </section>
  );
}
