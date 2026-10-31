"use client";

import { ArrowLeft, ExternalLink, Printer } from "lucide-react";
import Link from "next/link";
import { siGithub } from "simple-icons";
import { Button } from "@/components/ui/button";
import type { Experience } from "@/lib/api/experience";
import { formatExperienceDateRange } from "@/lib/api/experience";
import styles from "./resume.module.css";
import type {
  ResumeData,
  ResumeProfessionalProject,
  ResumeProject,
} from "./resume-data";

function BrandIcon({ path }: Readonly<{ path: string }>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function SectionTitle({ children }: Readonly<{ children: React.ReactNode }>) {
  return <h2 className={styles.sectionTitle}>{children}</h2>;
}

function ExperienceEntry({
  experience,
  responsibilityLimit,
  showTechnology,
}: Readonly<{
  experience: Experience;
  responsibilityLimit: number;
  showTechnology: boolean;
}>) {
  return (
    <article className={styles.experienceEntry}>
      <div className={styles.entryHeading}>
        <div>
          <h3>{experience.title}</h3>
          <a href={experience.companyUrl}>{experience.company}</a>
          <span aria-hidden="true"> · </span>
          <span>{experience.location}</span>
        </div>
        <time>
          {formatExperienceDateRange(experience.startDate, experience.endDate)}
        </time>
      </div>
      <p className={styles.description}>{experience.description}</p>
      <ul>
        {experience.responsibilities
          .slice(0, responsibilityLimit)
          .map((responsibility) => (
            <li key={responsibility}>{responsibility}</li>
          ))}
      </ul>
      {showTechnology && (
        <p className={styles.technologyLine}>
          {experience.technologies.slice(0, 7).join(" · ")}
        </p>
      )}
    </article>
  );
}

function ProfessionalProjectEntry({
  project,
}: Readonly<{ project: ResumeProfessionalProject }>) {
  return (
    <article className={styles.projectEntry}>
      <div className={styles.projectHeading}>
        <Link href={`/projects/${project.slug}`}>{project.title}</Link>
      </div>
      <p className={styles.projectCompany}>{project.company}</p>
      <p>{project.description}</p>
      <p className={styles.technologyLine}>
        {project.technologies.join(" · ")}
      </p>
    </article>
  );
}

function EarlierExperience({
  experiences,
}: Readonly<{ experiences: Experience[] }>) {
  return (
    <div className={styles.earlierExperienceList}>
      {experiences.map((experience) => (
        <article key={`${experience.company}-${experience.startDate}`}>
          <h3>{experience.title}</h3>
          <div>
            <a href={experience.companyUrl}>{experience.company}</a>
            <span>
              {formatExperienceDateRange(
                experience.startDate,
                experience.endDate,
              )}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ProjectEntry({ project }: Readonly<{ project: ResumeProject }>) {
  return (
    <article className={styles.projectEntry}>
      <div className={styles.projectHeading}>
        <Link href={`/projects/${project.slug}`}>{project.title}</Link>
        {project.repositoryUrl && (
          <a
            href={project.repositoryUrl}
            aria-label={`${project.title} source code`}
          >
            <ExternalLink aria-hidden="true" />
          </a>
        )}
      </div>
      <p>{project.description}</p>
      <p className={styles.technologyLine}>
        {project.technologies.slice(0, 4).join(" · ")}
      </p>
    </article>
  );
}

function ResumeToolbar() {
  return (
    <aside className={styles.toolbar} aria-label="Résumé actions">
      <Link href="/experience" className={styles.backLink}>
        <ArrowLeft aria-hidden="true" />
        Back to experience
      </Link>
      <div className={styles.printActions}>
        <span>Choose “Save as PDF” in the print dialog.</span>
        <Button type="button" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          Print / save PDF
        </Button>
      </div>
    </aside>
  );
}

function ResumeHeader({ data }: Readonly<{ data: ResumeData }>) {
  return (
    <header className={styles.resumeHeader}>
      <div>
        <h1>{data.person.name}</h1>
        <p className={styles.headline}>{data.headline}</p>
      </div>
      <nav aria-label="Contact links" className={styles.contactLinks}>
        <a href={data.person.website}>
          {data.person.website.replace("https://", "")}
        </a>
        <a href={data.person.github}>
          <BrandIcon path={siGithub.path} /> GitHub
        </a>
        <a href={data.person.linkedin}>
          <ExternalLink aria-hidden="true" /> LinkedIn
        </a>
      </nav>
    </header>
  );
}

function EvidenceColumn({ data }: Readonly<{ data: ResumeData }>) {
  return (
    <aside className={styles.evidenceColumn}>
      <SectionTitle>Career projects</SectionTitle>
      <div className={styles.projectList}>
        {data.professionalProjects.map((project) => (
          <ProfessionalProjectEntry key={project.slug} project={project} />
        ))}
      </div>
      <SectionTitle>Independent builds</SectionTitle>
      <div className={styles.projectList}>
        {data.independentProjects.map((project) => (
          <ProjectEntry key={project.slug} project={project} />
        ))}
      </div>
      <SectionTitle>Earlier experience</SectionTitle>
      <EarlierExperience experiences={data.experiences.slice(5)} />
    </aside>
  );
}

function ResumePage({ data }: Readonly<{ data: ResumeData }>) {
  const recentExperiences = data.experiences.slice(0, 5);
  return (
    <section className={styles.sheet} data-testid="resume-sheet">
      <ResumeHeader data={data} />
      <div className={styles.profileSummary}>
        <p>{data.summary}</p>
        <p className={styles.skills}>
          <strong>Core:</strong> {data.skills.slice(0, 10).join(" · ")}
        </p>
      </div>
      <div className={styles.contentGrid}>
        <div>
          <SectionTitle>Experience</SectionTitle>
          <div className={styles.experienceList}>
            {recentExperiences.map((experience, index) => (
              <ExperienceEntry
                key={`${experience.company}-${experience.startDate}`}
                experience={experience}
                responsibilityLimit={index === 0 ? 3 : 2}
                showTechnology={index < 2}
              />
            ))}
          </div>
        </div>
        <EvidenceColumn data={data} />
      </div>
      <footer className={styles.pageFooter}>
        <span>robbiepalmer.me/resume</span>
        <span>Experience & selected projects</span>
      </footer>
    </section>
  );
}

export function ResumeDocument({ data }: Readonly<{ data: ResumeData }>) {
  return (
    <div className={styles.shell}>
      <ResumeToolbar />
      <article
        className={styles.document}
        aria-label={`${data.person.name} résumé`}
        data-resume-document
      >
        <ResumePage data={data} />
      </article>
    </div>
  );
}
