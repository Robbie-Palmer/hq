import { ArrowRight, Network } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import type { InitiativeWithProjects } from "@/lib/api/initiatives";
import type { ProjectWithADRsView } from "@/lib/domain";
import type { RoleListItemView } from "@/lib/domain/role/roleViews";
import { InitiativeStatusBadge } from "./initiative-status-badge";

const STATUS_ORDER = { active: 0, idea: 1, inactive: 2 } as const;
const PROJECT_PATH_LIMIT = 3;

function getInitiativeCompanies(
  initiative: InitiativeWithProjects,
): RoleListItemView[] {
  const companies = new Map<string, RoleListItemView>();
  const newestProjectsFirst = [...initiative.projects].sort((a, b) =>
    (b.updated ?? b.date).localeCompare(a.updated ?? a.date),
  );

  for (const project of newestProjectsFirst) {
    if (project.role && !companies.has(project.role.company)) {
      companies.set(project.role.company, project.role);
    }
  }

  return Array.from(companies.values());
}

function getProjectPath(
  initiative: InitiativeWithProjects,
): ProjectWithADRsView[] {
  const projects = [...initiative.projects].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  if (projects.length <= PROJECT_PATH_LIMIT) return projects;

  const first = projects[0];

  return [first, ...projects.slice(-(PROJECT_PATH_LIMIT - 1))].filter(
    (project): project is ProjectWithADRsView => project !== undefined,
  );
}

function getInitiativeYears(initiative: InitiativeWithProjects): string {
  const startYear = initiative.date.slice(0, 4);
  if (initiative.status === "active") return `Since ${startYear}`;

  const endDate = initiative.projects.reduce((latest, project) => {
    const projectDate = project.updated ?? project.date;
    return projectDate > latest ? projectDate : latest;
  }, initiative.updated ?? initiative.date);
  const endYear = endDate.slice(0, 4);

  return startYear === endYear ? startYear : `${startYear} to ${endYear}`;
}

export function HomeInitiatives({
  initiatives,
}: Readonly<{ initiatives: InitiativeWithProjects[] }>) {
  if (initiatives.length === 0) return null;
  const orderedInitiatives = [...initiatives].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (b.updated ?? b.date).localeCompare(a.updated ?? a.date) ||
      a.slug.localeCompare(b.slug),
  );

  return (
    <section
      aria-labelledby="home-initiatives-heading"
      className="mx-auto max-w-5xl"
    >
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Initiatives
          </p>
          <h2
            id="home-initiatives-heading"
            className="text-3xl font-bold tracking-tight"
          >
            What I&apos;m building toward
          </h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            Longer-running goals that connect projects across roles and years.
          </p>
        </div>
        <Link
          href="/projects"
          className="group/link inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Explore all initiatives
          <ArrowRight className="size-4 transition-transform group-hover/link:translate-x-0.5" />
        </Link>
      </div>

      <div className="divide-y divide-border/80 border-y border-border/80">
        {orderedInitiatives.map((initiative) => {
          const companies = getInitiativeCompanies(initiative);
          const projectPath = getProjectPath(initiative);
          const projectCount = initiative.projects.length;
          const omittedProjectCount = projectCount - projectPath.length;

          return (
            <article
              key={initiative.slug}
              className={
                projectCount > 0
                  ? "relative grid gap-8 py-8 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-center lg:gap-12 xl:grid-cols-[22rem_minmax(0,1fr)]"
                  : "relative py-8"
              }
            >
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <InitiativeStatusBadge status={initiative.status} />
                  <span className="text-xs text-muted-foreground">
                    {getInitiativeYears(initiative)}
                  </span>
                </div>

                <h3 className="text-2xl font-semibold leading-tight">
                  <Link
                    href={`/initiatives/${initiative.slug}`}
                    className="group/title inline-flex items-center gap-2 underline-offset-4 hover:text-primary hover:underline"
                  >
                    {initiative.title}
                    <ArrowRight className="size-5 shrink-0 transition-transform group-hover/title:translate-x-1" />
                  </Link>
                </h3>

                <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  {initiative.description}
                </p>

                {companies.length > 0 && (
                  <div className="mt-5 flex items-center gap-3">
                    <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
                      Work at
                    </span>
                    <div className="flex -space-x-2">
                      {companies.map((company) => (
                        <Link
                          key={company.slug}
                          href={`/experience#${company.slug}`}
                          aria-label={`View experience at ${company.company}`}
                          title={company.company}
                          className="relative flex size-9 items-center justify-center rounded-md border bg-background p-1 ring-2 ring-background transition-transform hover:z-10 hover:-translate-y-0.5"
                        >
                          <Image
                            src={company.logoPath}
                            alt={`${company.company} logo`}
                            width={28}
                            height={28}
                            className="size-7 object-contain"
                          />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {projectCount > 0 && (
                <div>
                  <div className="mb-5 flex items-center justify-between gap-4 text-xs text-muted-foreground">
                    <span className="font-medium uppercase tracking-wider">
                      Project path
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Network className="size-3.5" />
                      {projectCount}{" "}
                      {projectCount === 1 ? "project" : "projects"}
                    </span>
                  </div>

                  <ol className="grid gap-5 sm:grid-cols-3">
                    {projectPath.map((project, index) => (
                      <li
                        key={project.slug}
                        className="relative grid grid-cols-[12px_minmax(0,1fr)] gap-3 sm:block"
                      >
                        {index < projectPath.length - 1 && (
                          <>
                            <span
                              aria-hidden="true"
                              className="absolute bottom-[-1.25rem] left-[5px] top-3 w-px bg-border sm:bottom-auto sm:left-3 sm:right-[-1.25rem] sm:top-[5px] sm:h-px sm:w-auto"
                            />
                            {index === 0 && omittedProjectCount > 0 && (
                              <span
                                aria-hidden="true"
                                className="absolute bottom-[-1.125rem] left-[5px] z-20 -translate-x-1/2 bg-background px-1 font-mono text-[0.625rem] tracking-widest text-muted-foreground sm:bottom-auto sm:left-[calc(50%+0.375rem)] sm:top-[5px] sm:-translate-y-1/2"
                              >
                                •••
                              </span>
                            )}
                          </>
                        )}
                        <span
                          aria-hidden="true"
                          className="relative z-10 mt-px size-3 rounded-full border-2 border-primary bg-background ring-4 ring-background sm:mb-3 sm:block"
                        />
                        <div className="min-w-0">
                          <time
                            dateTime={project.date}
                            className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground"
                          >
                            {project.date.slice(0, 4)}
                          </time>
                          <Link
                            href={`/projects/${project.slug}`}
                            className="mt-1 block text-sm font-medium leading-5 underline-offset-4 hover:text-primary hover:underline"
                          >
                            {project.title}
                          </Link>
                          <ProjectStatusBadge
                            status={project.status}
                            className="mt-2 px-1.5 py-0 text-[0.625rem]"
                          />
                          {index === 0 && omittedProjectCount > 0 && (
                            <span className="sr-only">
                              {omittedProjectCount}{" "}
                              {omittedProjectCount === 1
                                ? "project"
                                : "projects"}{" "}
                              not shown
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
