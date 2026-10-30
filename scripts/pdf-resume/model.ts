export interface ResumeExperience {
  company: string;
  companyUrl: string;
  title: string;
  location: string;
  startDate: string;
  endDate?: string;
  description: string;
  responsibilities: string[];
  technologies: string[];
  sourcePath: string;
}

export interface ResumeProject {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  status: string;
  role?: string;
  technologies: string[];
  repositoryUrl?: string;
  demoUrl?: string;
  canonicalUrl: string;
  sourcePath: string;
}

export interface ResumeSourceFile {
  path: string;
  sha256: string;
}

export interface ResumeSource {
  person: {
    name: string;
    website: string;
    github: string;
    linkedin: string;
  };
  experiences: ResumeExperience[];
  projects: ResumeProject[];
  skills: string[];
  sourceFiles: ResumeSourceFile[];
  sourceDigest: string;
}

export interface LayoutText {
  kind: "text";
  page: number;
  x: number;
  y: number;
  text: string;
  font: "regular" | "bold";
  size: number;
  color: string;
  link?: string;
  sourcePath?: string;
}

export interface LayoutRule {
  kind: "rule";
  page: number;
  x: number;
  y: number;
  width: number;
  color: string;
  thickness: number;
}

export interface LayoutRectangle {
  kind: "rectangle";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export type LayoutItem = LayoutText | LayoutRule | LayoutRectangle;

export interface ResumeLayout {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  pageCount: number;
  items: LayoutItem[];
}

export interface ResumeProvenance {
  schemaVersion: 1;
  generator: string;
  sourceDigest: string;
  sources: ResumeSourceFile[];
  selectedProjects: string[];
  pdf: {
    path: string;
    sha256: string;
    pages: number;
    links: string[];
  };
}
