"use client";

import { ExternalLink, Printer } from "lucide-react";
import Link from "next/link";
import { siGithub } from "simple-icons";
import { Button } from "@/components/ui/button";
import type { Experience } from "@/lib/api/experience";
import { formatExperienceDateRange } from "@/lib/api/experience";
import styles from "./resume.module.css";
import type { ResumeData, ResumeProject } from "./resume-data";

function BrandIcon({ path }: Readonly<{ path: string }>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function ExperienceEntry({
  experience,
  compact = false,
}: Readonly<{ experience: Experience; compact?: boolean }>) {
  const responsibilityLimit = 3;
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
      {!compact && (
        <p className={styles.technologyLine}>
          {experience.technologies.slice(0, 9).join(" · ")}
        </p>
      )}
    </article>
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
        {project.technologies.join(" · ")}
      </p>
    </article>
  );
}

function SectionTitle({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <h2 className={styles.sectionTitle}>
      <span>{children}</span>
    </h2>
  );
}

function PageFooter({ page }: Readonly<{ page: number }>) {
  return (
    <footer className={styles.pageFooter}>
      <span>robbiepalmer.me/resume</span>
      <span>Page {page} of 2</span>
    </footer>
  );
}

function ResumeToolbar() {
  return (
    <aside className={styles.toolbar} aria-label="Résumé actions">
      <div>
        <p>Browser-native PDF</p>
        <span>Choose “Save as PDF” in the print dialog.</span>
      </div>
      <Button type="button" onClick={() => window.print()}>
        <Printer aria-hidden="true" />
        Print / save PDF
      </Button>
    </aside>
  );
}

function ResumeHeader({ data }: Readonly<{ data: ResumeData }>) {
  return (
    <header className={styles.resumeHeader}>
      <div>
        <p className={styles.eyebrow}>Résumé</p>
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

function ResumeFirstPage({ data }: Readonly<{ data: ResumeData }>) {
  return (
    <section className={styles.sheet} data-testid="resume-sheet">
      <ResumeHeader data={data} />
      <div className={styles.profileBand}>
        <p>{data.summary}</p>
        <div>
          <span>Core stack</span>
          <p>{data.skills.slice(0, 8).join(" · ")}</p>
        </div>
      </div>

      <div className={styles.pageBody}>
        <SectionTitle>Recent experience</SectionTitle>
        <div className={styles.experienceList}>
          {data.experiences.slice(0, 4).map((experience) => (
            <ExperienceEntry
              key={`${experience.company}-${experience.startDate}`}
              experience={experience}
            />
          ))}
        </div>
      </div>
      <PageFooter page={1} />
    </section>
  );
}

function ResumeSecondPage({ data }: Readonly<{ data: ResumeData }>) {
  return (
    <section className={styles.sheet} data-testid="resume-sheet">
      <header className={styles.continuationHeader}>
        <span>{data.person.name}</span>
        <span>{data.headline}</span>
      </header>
      <div className={styles.secondPageGrid}>
        <div>
          <SectionTitle>Earlier experience</SectionTitle>
          <div className={styles.compactExperienceList}>
            {data.experiences.slice(4).map((experience) => (
              <ExperienceEntry
                compact
                key={`${experience.company}-${experience.startDate}`}
                experience={experience}
              />
            ))}
          </div>
        </div>
        <div>
          <SectionTitle>Selected projects</SectionTitle>
          <div className={styles.projectList}>
            {data.projects.map((project) => (
              <ProjectEntry key={project.slug} project={project} />
            ))}
          </div>
          <SectionTitle>Technical strengths</SectionTitle>
          <ul className={styles.skillList} aria-label="Technical strengths">
            {data.skills.map((skill) => (
              <li key={skill}>{skill}</li>
            ))}
          </ul>
        </div>
      </div>
      <PageFooter page={2} />
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
        <ResumeFirstPage data={data} />
        <ResumeSecondPage data={data} />
      </article>
    </div>
  );
}
