import type {
  LayoutItem,
  LayoutText,
  ResumeExperience,
  ResumeLayout,
  ResumeProject,
  ResumeSource,
} from "./model";

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;
const BODY_COLOR = "#243044";
const MUTED_COLOR = "#5f6b7a";
const ACCENT_COLOR = "#087e8b";
const HEADING_COLOR = "#12324a";

function estimatedCharacterWidth(character: string, size: number): number {
  if (" ilI.,'`".includes(character)) return size * 0.26;
  if ("MW@%&".includes(character)) return size * 0.82;
  if (character >= "A" && character <= "Z") return size * 0.63;
  return size * 0.5;
}

export function estimateTextWidth(text: string, size: number): number {
  return [...text].reduce(
    (width, character) => width + estimatedCharacterWidth(character, size),
    0,
  );
}

export function wrapText(text: string, size: number, width: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && estimateTextWidth(candidate, size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2]) return value;
  const month = Number(match[2]);
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${names[month - 1] ?? match[2]} ${match[1]}`;
}

function dateRange(experience: ResumeExperience): string {
  return `${formatMonth(experience.startDate)} - ${experience.endDate ? formatMonth(experience.endDate) : "Present"}`;
}

class PageBuilder {
  readonly items: LayoutItem[] = [];
  private y = 0;

  constructor(readonly page: number) {}

  setY(value: number): void {
    this.y = value;
  }

  currentY(): number {
    return this.y;
  }

  text(
    text: string,
    options: Omit<LayoutText, "kind" | "page" | "text" | "y"> & {
      y?: number;
    },
  ): void {
    const y = options.y ?? this.y;
    this.items.push({ kind: "text", page: this.page, text, y, ...options });
  }

  wrapped(
    text: string,
    options: Omit<LayoutText, "kind" | "page" | "text" | "y"> & {
      width: number;
      leading: number;
      prefix?: string;
    },
  ): void {
    const prefix = options.prefix ?? "";
    const prefixWidth = estimateTextWidth(prefix, options.size);
    const lines = wrapText(text, options.size, options.width - prefixWidth);
    lines.forEach((line, index) => {
      this.text(`${index === 0 ? prefix : "  "}${line}`, {
        ...options,
        x: options.x,
        y: this.y,
      });
      this.y += options.leading;
    });
  }

  gap(value: number): void {
    this.y += value;
  }

  section(title: string): void {
    this.text(title.toUpperCase(), {
      x: MARGIN,
      font: "bold",
      size: 10.5,
      color: ACCENT_COLOR,
    });
    this.items.push({
      kind: "rule",
      page: this.page,
      x: MARGIN + 105,
      y: this.y - 3,
      width: CONTENT_WIDTH - 105,
      color: "#b9c5ce",
      thickness: 0.7,
    });
    this.y += 16;
  }
}

function addHeader(page: PageBuilder, source: ResumeSource): void {
  page.items.push({
    kind: "rectangle",
    page: page.page,
    x: 0,
    y: 0,
    width: A4_WIDTH,
    height: 106,
    color: HEADING_COLOR,
  });
  page.text(source.person.name, {
    x: MARGIN,
    y: 40,
    font: "bold",
    size: 25,
    color: "#ffffff",
    sourcePath: "ui/lib/config/site-config.ts",
  });
  page.text(source.experiences[0]?.title ?? "Software engineer", {
    x: MARGIN,
    y: 62,
    font: "regular",
    size: 11.5,
    color: "#dbe8ee",
    sourcePath: source.experiences[0]?.sourcePath,
  });
  const links = [
    ["robbiepalmer.me", source.person.website],
    ["GitHub", source.person.github],
    ["LinkedIn", source.person.linkedin],
  ] as const;
  let x = MARGIN;
  for (const [label, link] of links) {
    page.text(label, {
      x,
      y: 86,
      font: "regular",
      size: 9,
      color: "#ffffff",
      link,
      sourcePath: "ui/lib/config/site-config.ts",
    });
    x += estimateTextWidth(label, 9) + 24;
  }
  page.setY(132);
}

function addExperience(
  page: PageBuilder,
  experience: ResumeExperience,
  responsibilityCount: number,
): void {
  const header = `${experience.title} | ${experience.company}`;
  page.text(header, {
    x: MARGIN,
    font: "bold",
    size: 10.5,
    color: BODY_COLOR,
    link: experience.companyUrl,
    sourcePath: experience.sourcePath,
  });
  const range = dateRange(experience);
  page.text(range, {
    x: A4_WIDTH - MARGIN - estimateTextWidth(range, 9),
    font: "regular",
    size: 9,
    color: MUTED_COLOR,
    sourcePath: experience.sourcePath,
  });
  page.gap(13);
  page.wrapped(experience.description, {
    x: MARGIN,
    width: CONTENT_WIDTH,
    leading: 10.5,
    font: "regular",
    size: 8.7,
    color: BODY_COLOR,
    sourcePath: experience.sourcePath,
  });
  for (const responsibility of experience.responsibilities.slice(
    0,
    responsibilityCount,
  )) {
    page.wrapped(responsibility, {
      x: MARGIN + 8,
      width: CONTENT_WIDTH - 8,
      leading: 10,
      font: "regular",
      size: 8.4,
      color: BODY_COLOR,
      prefix: "- ",
      sourcePath: experience.sourcePath,
    });
  }
  page.wrapped(`Technologies: ${experience.technologies.slice(0, 9).join(", ")}`, {
    x: MARGIN,
    width: CONTENT_WIDTH,
    leading: 9.5,
    font: "regular",
    size: 7.8,
    color: MUTED_COLOR,
    sourcePath: experience.sourcePath,
  });
  page.gap(10);
}

function addProject(page: PageBuilder, project: ResumeProject): void {
  page.text(project.title, {
    x: MARGIN,
    font: "bold",
    size: 9.8,
    color: BODY_COLOR,
    link: project.canonicalUrl,
    sourcePath: project.sourcePath,
  });
  if (project.repositoryUrl) {
    const label = "Source";
    page.text(label, {
      x: A4_WIDTH - MARGIN - estimateTextWidth(label, 8),
      font: "regular",
      size: 8,
      color: ACCENT_COLOR,
      link: project.repositoryUrl,
      sourcePath: project.sourcePath,
    });
  }
  page.gap(12);
  page.wrapped(project.description, {
    x: MARGIN,
    width: CONTENT_WIDTH,
    leading: 10,
    font: "regular",
    size: 8.5,
    color: BODY_COLOR,
    sourcePath: project.sourcePath,
  });
  if (project.technologies.length > 0) {
    page.wrapped(project.technologies.slice(0, 8).join("  |  "), {
      x: MARGIN,
      width: CONTENT_WIDTH,
      leading: 9.5,
      font: "regular",
      size: 7.8,
      color: MUTED_COLOR,
      sourcePath: project.sourcePath,
    });
  }
  page.gap(7);
}

function addFooter(page: PageBuilder, source: ResumeSource): void {
  const footer = `robbiepalmer.me  |  Page ${page.page} of 2`;
  page.text(footer, {
    x: A4_WIDTH - MARGIN - estimateTextWidth(footer, 7.5),
    y: A4_HEIGHT - 25,
    font: "regular",
    size: 7.5,
    color: MUTED_COLOR,
    link: source.person.website,
    sourcePath: "ui/lib/config/site-config.ts",
  });
}

export function buildResumeLayout(source: ResumeSource): ResumeLayout {
  if (source.experiences.length < 2) {
    throw new Error("The resume needs at least two canonical experience records");
  }
  const firstPage = new PageBuilder(1);
  addHeader(firstPage, source);
  firstPage.section("Experience");
  for (const experience of source.experiences.slice(0, 4)) {
    addExperience(firstPage, experience, 3);
  }
  firstPage.section("Technical strengths");
  firstPage.wrapped(source.skills.join("  |  "), {
    x: MARGIN,
    width: CONTENT_WIDTH,
    leading: 11,
    font: "regular",
    size: 8.7,
    color: BODY_COLOR,
    sourcePath: "ui/content/experience.ts",
  });
  addFooter(firstPage, source);

  const secondPage = new PageBuilder(2);
  secondPage.setY(MARGIN);
  secondPage.section("Earlier experience");
  for (const experience of source.experiences.slice(4)) {
    addExperience(secondPage, experience, 2);
  }
  secondPage.section("Selected projects");
  for (const project of source.projects) addProject(secondPage, project);
  addFooter(secondPage, source);

  const layout: ResumeLayout = {
    pageWidth: A4_WIDTH,
    pageHeight: A4_HEIGHT,
    margin: MARGIN,
    pageCount: 2,
    items: [...firstPage.items, ...secondPage.items],
  };
  validateLayout(layout);
  return layout;
}

function validateTextBounds(item: LayoutText, layout: ResumeLayout): void {
  const width = estimateTextWidth(item.text, item.size);
  const escapesPage =
    item.page < 1 ||
    item.page > layout.pageCount ||
    item.x < 0 ||
    item.y - item.size < 0 ||
    item.x + width > layout.pageWidth + 0.5 ||
    item.y > layout.pageHeight;
  if (escapesPage) {
    throw new Error(
      `Text escapes page ${item.page} at (${item.x}, ${item.y}): ${item.text}`,
    );
  }
}

function validatePageBody(
  page: number,
  textItems: LayoutText[],
  layout: ResumeLayout,
): void {
  const bodyItems = textItems
    .filter(
      (item) =>
        item.page === page && item.y > 106 && item.y < layout.pageHeight - 28,
    )
    .sort((left, right) => left.y - right.y || left.x - right.x);
  for (let index = 1; index < bodyItems.length; index += 1) {
    const previous = bodyItems[index - 1];
    const current = bodyItems[index];
    if (!previous || !current || Math.abs(previous.y - current.y) >= 0.5) {
      continue;
    }
    const previousRight =
      previous.x + estimateTextWidth(previous.text, previous.size);
    if (previousRight > current.x - 4) {
      throw new Error(
        `Text overlaps on page ${page}: '${previous.text}' and '${current.text}'`,
      );
    }
  }
  const finalBaseline = bodyItems.at(-1)?.y ?? 0;
  if (finalBaseline < 480) {
    throw new Error(
      `Page ${page} is too sparse: final content baseline is ${finalBaseline}`,
    );
  }
}

export function validateLayout(layout: ResumeLayout): void {
  const textItems = layout.items.filter(
    (item): item is LayoutText => item.kind === "text",
  );
  for (const item of textItems) validateTextBounds(item, layout);
  for (let page = 1; page <= layout.pageCount; page += 1) {
    validatePageBody(page, textItems, layout);
  }
}
