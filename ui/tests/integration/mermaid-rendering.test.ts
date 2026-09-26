import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getWranglerTestRepoRoot,
  killProcessGroup,
  waitForServer,
} from "./wrangler-test-utils";

const SERVER_PORT = 8792;
const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;
const UI_ROOT = resolve(getWranglerTestRepoRoot(), "ui");

function findSystemChrome(): string | undefined {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ];

  return candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && existsSync(candidate),
  );
}

describe("Visualization browser rendering", () => {
  let browser: Browser;
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    serverProcess = spawn(
      "pnpm",
      [
        "exec",
        "serve",
        "out",
        "--listen",
        `tcp://127.0.0.1:${SERVER_PORT}`,
        "--no-clipboard",
        "--no-port-switching",
        "--no-request-logging",
      ],
      {
        cwd: UI_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );

    await waitForServer(serverProcess, 30_000, "Accepting connections at");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--disable-setuid-sandbox", "--no-sandbox"],
      executablePath: findSystemChrome(),
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    killProcessGroup(serverProcess);
  });

  it("serves the exported HTML byte-for-byte through the static server", async () => {
    const relativePath = "projects/recipe-site/deck.html";
    const response = await fetch(`${BASE_URL}/projects/recipe-site/deck`);

    expect(response.ok).toBe(true);
    expect(await response.text()).toBe(
      readFileSync(resolve(UI_ROOT, "out", relativePath), "utf8"),
    );
  });

  it("enters and exits fullscreen from the Leaflet map control", async () => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    try {
      await page.goto(`${BASE_URL}/technologies/leaflet`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector(".leaflet-control-fullscreen-button", {
        visible: true,
      });

      await page.click(".leaflet-control-fullscreen-button");
      await page.waitForFunction(() =>
        document
          .querySelector(".leaflet-container")
          ?.classList.contains("leaflet-fullscreen-on"),
      );
      expect(
        await page.$eval(".leaflet-control-fullscreen-button", (button) =>
          button.getAttribute("title"),
        ),
      ).toBe("Exit Fullscreen");

      await page.click(".leaflet-control-fullscreen-button");
      await page.waitForFunction(
        () =>
          !document
            .querySelector(".leaflet-container")
            ?.classList.contains("leaflet-fullscreen-on"),
      );
      expect(
        await page.$eval(".leaflet-control-fullscreen-button", (button) =>
          button.getAttribute("title"),
        ),
      ).toBe("Enter Fullscreen");
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("renders the initiative operating loop without duplicate actors", async () => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    try {
      await page.goto(
        `${BASE_URL}/initiatives/semi-autonomous-software-development`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForSelector(".mermaid-diagram svg", {
        timeout: 20_000,
      });

      const layout = await page.$eval(".mermaid-diagram svg", (svg) => {
        const nodes = Array.from(svg.querySelectorAll<SVGGElement>(".node"));
        const edgeLabels = Array.from(
          svg.querySelectorAll<SVGGElement>(".edgeLabel"),
        );
        const assignment = nodes.find((node) =>
          node.textContent?.includes("2. Assign ready work"),
        );
        const directRead = edgeLabels.find((label) =>
          label.textContent?.includes("read directly while working"),
        );

        const assignmentBounds = assignment?.getBoundingClientRect();
        const directReadBounds = directRead?.getBoundingClientRect();

        return {
          assignmentLeft: assignmentBounds?.left ?? 0,
          directReadCenter:
            directReadBounds === undefined
              ? 0
              : directReadBounds.left + directReadBounds.width / 2,
          directReadLabels: new Set(
            edgeLabels
              .filter((label) =>
                label.textContent?.includes("read directly while working"),
              )
              .map((label) => label.textContent?.trim()),
          ).size,
          executionNodes: nodes.filter((node) =>
            node.textContent?.includes("People and agents execute"),
          ).length,
          knowledgeNodes: nodes.filter((node) =>
            node.textContent?.includes("Knowledge graph"),
          ).length,
          workNodes: nodes.filter((node) =>
            node.textContent?.includes("Work graph"),
          ).length,
        };
      });

      expect(pageErrors).toEqual([]);
      expect(layout).toMatchObject({
        directReadLabels: 1,
        executionNodes: 1,
        knowledgeNodes: 1,
        workNodes: 1,
      });
      expect(layout.directReadCenter).toBeLessThan(layout.assignmentLeft);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("runs the reveal.js integration fixture on its technology page", async () => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    try {
      await page.goto(`${BASE_URL}/technologies/revealdotjs`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector(".pitch-deck .reveal.ready", {
        timeout: 20_000,
      });

      const fixture = await page.evaluate(() => ({
        codeBlocks: document.querySelectorAll('code[data-language="ts"]')
          .length,
        fragments: document.querySelectorAll(".pitch-deck .fragment").length,
        highlightedLines: document.querySelectorAll(
          'code[data-language="ts"] [data-highlighted-line]',
        ).length,
        notes: document.querySelectorAll(".pitch-deck aside.notes").length,
        slides: document.querySelectorAll(".pitch-deck .slides > section")
          .length,
      }));

      expect(fixture).toEqual({
        codeBlocks: 1,
        fragments: 3,
        highlightedLines: 3,
        notes: 2,
        slides: 6,
      });
      const initialAppearance = await page.$eval(
        ".pitch-deck .reveal",
        (deck) => ({
          background: getComputedStyle(deck).backgroundColor,
          headingColor: getComputedStyle(
            deck.querySelector("section.present h1") as HTMLElement,
          ).color,
        }),
      );
      expect(initialAppearance).toEqual({
        background: "rgb(9, 10, 9)",
        headingColor: "rgb(247, 245, 239)",
      });
      expect(
        await page.$eval('a[href="/technologies/revealdotjs/deck"]', (link) =>
          link.textContent?.trim(),
        ),
      ).toBe("Present");
      await page.waitForFunction(
        () =>
          document
            .querySelector(".pitch-deck__position")
            ?.textContent?.trim() === "Slide 1 of 6",
      );

      await page.click('button[title="Enter fullscreen"]');
      await page.waitForFunction(
        () => document.fullscreenElement?.classList.contains("pitch-deck"),
        { timeout: 10_000 },
      );
      const fullscreenLayout = await page.$eval(
        ".pitch-deck:fullscreen",
        (deck) => {
          const stage = deck.querySelector<HTMLElement>(".pitch-deck__stage");
          return {
            deckHeight: deck.getBoundingClientRect().height,
            display: getComputedStyle(deck).display,
            stageHeight: stage?.getBoundingClientRect().height ?? 0,
          };
        },
      );
      expect(fullscreenLayout.display).toBe("flex");
      expect(fullscreenLayout.deckHeight).toBeGreaterThan(500);
      expect(fullscreenLayout.stageHeight).toBeGreaterThan(300);
      await page.waitForSelector('button[title="Exit fullscreen"]', {
        timeout: 10_000,
      });
      await page.click('button[title="Exit fullscreen"]');
      await page.waitForFunction(() => document.fullscreenElement === null);

      await page.click('button[aria-label="Next slide"]');
      await page.waitForFunction(
        () =>
          document.querySelector(".pitch-deck section.present h2")
            ?.textContent === "Mermaid remains a live component",
      );
      await page.waitForSelector(
        ".pitch-deck section.present .mermaid-diagram svg",
      );

      const diagramSize = await page.$eval(
        ".pitch-deck section.present .mermaid-diagram svg",
        (svg) => {
          const bounds = svg.getBoundingClientRect();
          return { height: bounds.height, width: bounds.width };
        },
      );
      expect(diagramSize.width).toBeGreaterThan(100);
      expect(diagramSize.height).toBeGreaterThan(30);
      const nodeLabels = await page.$$eval(
        ".pitch-deck section.present .mermaid-diagram .nodeLabel p",
        (labels) =>
          labels.map((label) => ({
            fontSize: getComputedStyle(label).fontSize,
            text: label.textContent,
          })),
      );
      expect(nodeLabels.length).toBeGreaterThan(0);
      expect(nodeLabels.every((label) => label.fontSize === "16px")).toBe(true);
      expect(nodeLabels.map((label) => label.text).join(" ")).toContain(
        "MDX source",
      );

      await page.click('button[aria-label="Next slide"]');
      await page.click('button[aria-label="Next slide"]');
      await page.click('button[aria-label="Next slide"]');
      await page.click('button[aria-label="Next slide"]');
      await page.click('button[aria-label="Next slide"]');

      const visibleFragments = await page.$$eval(
        ".pitch-deck section.present .fragment.visible",
        (fragments) =>
          fragments.map((fragment) =>
            fragment.getAttribute("data-fragment-index"),
          ),
      );
      expect(visibleFragments).toEqual(["0", "1", "2"]);

      await page.click('button[aria-label="Next slide"]');
      await page.waitForFunction(
        () =>
          document.querySelector(".pitch-deck section.present h2")
            ?.textContent === "React state stays interactive",
      );
      await page.click(".pitch-deck section.present button:last-child");

      const liveControl = await page.evaluate(() => ({
        count: document.querySelector(
          ".pitch-deck section.present .review-depth-demo__count strong",
        )?.textContent,
        selected: Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            ".pitch-deck section.present .review-depth-demo button",
          ),
        ).find((button) => button.getAttribute("aria-pressed") === "true")
          ?.textContent,
      }));
      expect(liveControl).toEqual({ count: "3", selected: "Sensitive" });
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("loads the embedded project deck fully styled and counted", async () => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    try {
      await page.goto(`${BASE_URL}/projects/agentic-code-review`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector(".pitch-deck .reveal.ready", {
        timeout: 20_000,
      });
      await page.waitForFunction(
        () =>
          document
            .querySelector(".pitch-deck__position")
            ?.textContent?.trim() === "Slide 1 of 8",
      );

      const deck = await page.$eval(".pitch-deck", (element) => {
        const slide = element.querySelector<HTMLElement>(".pitch-slide");
        const reveal = element.querySelector<HTMLElement>(".reveal");
        const heading =
          element.querySelector<HTMLElement>("section.present h1");
        return {
          background: getComputedStyle(element).backgroundColor,
          headingColor: heading ? getComputedStyle(heading).color : "",
          paddingTop: slide ? getComputedStyle(slide).paddingTop : "",
          revealBackground: reveal
            ? getComputedStyle(reveal).backgroundColor
            : "",
          slides: element.querySelectorAll(".slides > section").length,
        };
      });

      expect(deck).toEqual({
        background: "rgb(9, 10, 9)",
        headingColor: "rgb(247, 245, 239)",
        paddingTop: "72px",
        revealBackground: "rgb(9, 10, 9)",
        slides: 8,
      });

      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("keeps recipe styling in overview and scroll views", async () => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    try {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${BASE_URL}/projects/recipe-site/deck`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector(".pitch-deck .reveal.ready", {
        timeout: 20_000,
      });

      await page.click('button[title="Slide overview"]');
      await page.waitForSelector(".pitch-deck__static--overview");
      const finalSlide = await page.$$eval(
        ".pitch-deck__overview-targets button",
        (buttons) => buttons.length,
      );
      expect(finalSlide).toBeGreaterThan(0);
      await page.click(`button[aria-label="Open slide ${finalSlide}"]`);
      await page.waitForFunction(
        (expected) =>
          document
            .querySelector(".pitch-deck__position")
            ?.textContent?.trim() === `Slide ${expected} of ${expected}`,
        {},
        finalSlide,
      );
      const finalCta = await page.$eval(
        "section.present .pitch-final-cta",
        (cta) => {
          const bounds = cta.getBoundingClientRect();
          const styles = getComputedStyle(cta);
          return {
            height: bounds.height,
            isFragment: cta.classList.contains("fragment"),
            opacity: styles.opacity,
            visibility: styles.visibility,
          };
        },
      );
      expect(finalCta.isFragment).toBe(false);
      expect(finalCta.height).toBeGreaterThan(0);
      expect(finalCta.opacity).toBe("1");
      expect(finalCta.visibility).toBe("visible");

      await page.click('button[title="Toggle scroll view"]');
      await page.waitForSelector(".pitch-deck__static--scroll");
      const scrollBackground = await page.$eval(
        ".pitch-deck__static--scroll > .slides > section",
        (slide) => getComputedStyle(slide).backgroundColor,
      );
      expect(scrollBackground).toBe("rgb(244, 237, 223)");

      await page.click('button[title="Toggle scroll view"]');
      await page.waitForFunction(
        () => !document.querySelector(".pitch-deck__static"),
      );
      await page.setViewport({ width: 390, height: 844 });
      await page.click('button[title="Slide overview"]');
      await page.waitForSelector(".pitch-deck__static--overview");
      const overview = await page.$eval(
        ".pitch-deck__static--overview > .slides > section",
        (slide) => {
          const content = slide.querySelector<HTMLElement>(
            ".pitch-slide__content",
          );
          const slideBounds = slide.getBoundingClientRect();
          const contentBounds = content?.getBoundingClientRect();
          const heading = slide.querySelector<HTMLElement>("h1, h2");
          return {
            background: getComputedStyle(slide).backgroundColor,
            contentHeight: contentBounds?.height ?? 0,
            contentWidth: contentBounds?.width ?? 0,
            headingColor: heading ? getComputedStyle(heading).color : "",
            slideHeight: slideBounds.height,
            slideWidth: slideBounds.width,
            transform: content ? getComputedStyle(content).transform : "",
          };
        },
      );

      expect(overview.background).toBe("rgb(244, 237, 223)");
      expect(overview.headingColor).toBe("rgb(53, 46, 38)");
      expect(overview.transform).toContain("0.3");
      expect(overview.contentWidth).toBeLessThanOrEqual(
        overview.slideWidth + 1,
      );
      expect(overview.contentHeight).toBeLessThanOrEqual(
        overview.slideHeight + 1,
      );
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("fits the recipe diagrams into phone-sized slides", async () => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    try {
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(`${BASE_URL}/projects/recipe-site/deck`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector(".pitch-deck .reveal.ready", {
        timeout: 20_000,
      });

      const advanceTo = async (slide: number) => {
        let currentSlide = await page.$eval(
          ".pitch-deck__position",
          (position) => Number(position.textContent?.match(/Slide (\d+)/)?.[1]),
        );
        while (currentSlide < slide) {
          const nextSlide = currentSlide + 1;
          await page.click('button[aria-label="Next slide"]');
          await page.waitForFunction(
            (expected) =>
              document
                .querySelector(".pitch-deck__position")
                ?.textContent?.startsWith(`Slide ${expected} `),
            {},
            nextSlide,
          );
          currentSlide = nextSlide;
        }
      };
      const advanceToDiagram = async (selector: string) => {
        const slide = await page.$$eval(
          ".pitch-deck .slides > section",
          (sections, target) =>
            sections.findIndex((section) => section.querySelector(target)) + 1,
          selector,
        );
        expect(slide).toBeGreaterThan(0);
        await advanceTo(slide);
      };
      const inspectPresentDiagram = async (selector: string) =>
        page.$eval(`section.present ${selector}`, (element) => {
          const diagram = element as HTMLElement;
          const content = diagram.closest<HTMLElement>(".pitch-slide__content");
          const diagramBounds = diagram.getBoundingClientRect();
          const contentBounds = content?.getBoundingClientRect();
          const countTracks = (value: string) => {
            const repeatedTracks = /^repeat\(\s*(\d+)/.exec(value)?.[1];
            if (repeatedTracks) return Number(repeatedTracks);

            let count = 0;
            let depth = 0;
            let inTrack = false;
            for (const character of value) {
              if (character === "(") depth += 1;
              if (character === ")") depth -= 1;
              if (/\s/.test(character) && depth === 0) {
                inTrack = false;
              } else if (!inTrack) {
                count += 1;
                inTrack = true;
              }
            }
            return count;
          };
          const styles = getComputedStyle(diagram);

          return {
            columnCount: countTracks(styles.gridTemplateColumns),
            contained:
              diagram.scrollWidth <= diagram.clientWidth + 1 &&
              diagram.scrollHeight <= diagram.clientHeight + 1 &&
              Boolean(
                contentBounds &&
                  diagramBounds.left >= contentBounds.left - 1 &&
                  diagramBounds.right <= contentBounds.right + 1 &&
                  diagramBounds.top >= contentBounds.top - 1 &&
                  diagramBounds.bottom <= contentBounds.bottom + 1,
              ),
            rowCount: countTracks(styles.gridTemplateRows),
          };
        });

      await advanceToDiagram(".pitch-recipe-loop");
      const loop = await inspectPresentDiagram(".pitch-recipe-loop");
      await advanceToDiagram(".pitch-evidence-ladder");
      const evidence = await inspectPresentDiagram(".pitch-evidence-ladder");
      await advanceToDiagram(".pitch-recommendation-card__recipe");
      const recommendationImage = await page.$eval(
        "section.present .pitch-recommendation-card__recipe",
        (recommendation) => getComputedStyle(recommendation).backgroundImage,
      );
      await advanceToDiagram(".pitch-cooking-flywheel");
      const flywheel = await inspectPresentDiagram(".pitch-cooking-flywheel");
      await advanceToDiagram(".pitch-recipe-roadmap");
      const roadmap = await inspectPresentDiagram(".pitch-recipe-roadmap");

      expect(loop.columnCount).toBe(3);
      expect(loop.rowCount).toBe(3);
      expect(evidence.columnCount).toBe(3);
      expect(flywheel.columnCount).toBe(1);
      expect(roadmap.columnCount).toBe(2);
      expect({ evidence, flywheel, loop, roadmap }).toMatchObject({
        evidence: { contained: true },
        flywheel: { contained: true },
        loop: { contained: true },
        roadmap: { contained: true },
      });
      expect(recommendationImage).toBe("none");
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("uses swipeable slides and a pannable overview on phones", async () => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    try {
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(`${BASE_URL}/projects/agentic-code-review/deck`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector(".pitch-deck .reveal.ready", {
        timeout: 20_000,
      });
      await page.waitForFunction(
        () =>
          document
            .querySelector(".pitch-deck__position")
            ?.textContent?.trim() === "Slide 1 of 8" &&
          !document.querySelector(".pitch-deck__static") &&
          !document.querySelector('button[title="Toggle scroll view"]'),
      );

      const mobileLayout = await page.evaluate(() => {
        const deck = document.querySelector<HTMLElement>(".pitch-deck");
        const reveal = document.querySelector<HTMLElement>(
          ".pitch-deck .reveal",
        );
        const topbar = document.querySelector<HTMLElement>(
          ".pitch-deck__topbar",
        );
        const controls = document.querySelector<HTMLElement>(
          ".pitch-deck__controls",
        );
        const stage = document.querySelector<HTMLElement>(".pitch-deck__stage");
        const toolButtons = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".pitch-deck__tools button, .pitch-deck__tools a",
          ),
        );

        return {
          controlsHeight: controls?.getBoundingClientRect().height ?? 0,
          deckHeight: deck?.getBoundingClientRect().height ?? 0,
          deckWidth: deck?.getBoundingClientRect().width ?? 0,
          documentWidth: document.documentElement.scrollWidth,
          slideHeight: reveal
            ? getComputedStyle(reveal).getPropertyValue("--slide-height")
            : "",
          slideWidth: reveal
            ? getComputedStyle(reveal).getPropertyValue("--slide-width")
            : "",
          stageHeight: stage?.getBoundingClientRect().height ?? 0,
          liveDeckHidden:
            document
              .querySelector(".pitch-deck__live")
              ?.hasAttribute("hidden") ?? true,
          staticViews: document.querySelectorAll(".pitch-deck__static").length,
          toolSizes: toolButtons.map((button) => {
            const bounds = button.getBoundingClientRect();
            return { height: bounds.height, width: bounds.width };
          }),
          topbarHeight: topbar?.getBoundingClientRect().height ?? 0,
        };
      });

      expect(mobileLayout.slideWidth).toBe("720px");
      expect(mobileLayout.slideHeight).toBe("960px");
      expect(mobileLayout.deckWidth).toBeLessThanOrEqual(390);
      expect(mobileLayout.deckHeight).toBeLessThanOrEqual(844);
      expect(mobileLayout.documentWidth).toBeLessThanOrEqual(390);
      expect(mobileLayout.stageHeight).toBeGreaterThan(600);
      expect(mobileLayout.liveDeckHidden).toBe(false);
      expect(mobileLayout.staticViews).toBe(0);
      expect(mobileLayout.topbarHeight).toBeLessThanOrEqual(60);
      expect(mobileLayout.controlsHeight).toBeLessThanOrEqual(60);
      expect(
        mobileLayout.toolSizes.every(
          (size) => size.width >= 40 && size.height >= 40,
        ),
      ).toBe(true);

      const client = await page.createCDPSession();
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 320, y: 420 }],
      });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 70, y: 420 }],
      });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await page.waitForFunction(
        () =>
          document
            .querySelector(".pitch-deck__position")
            ?.textContent?.trim() === "Slide 2 of 8",
      );

      await page.click('button[title="Slide overview"]');
      await page.waitForFunction(() => {
        const stage = document.querySelector<HTMLElement>(
          ".pitch-deck__stage--overview",
        );
        return Boolean(stage && stage.scrollWidth > stage.clientWidth);
      });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 330, y: 420 }],
      });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 50, y: 420 }],
      });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await page.waitForFunction(
        () =>
          (document.querySelector<HTMLElement>(".pitch-deck__stage--overview")
            ?.scrollLeft ?? 0) > 0,
      );

      await page.evaluate(() =>
        document
          .querySelector<HTMLButtonElement>('button[aria-label="Open slide 4"]')
          ?.click(),
      );
      await page.waitForFunction(() =>
        document
          .querySelector(".pitch-deck section.present h2")
          ?.textContent?.includes("Own the review loop"),
      );
      const longTitle = await page.$eval(
        ".pitch-deck section.present .pitch-slide__long-title",
        (heading) => {
          const titleBounds = heading.getBoundingClientRect();
          const slideBounds = heading
            .closest<HTMLElement>(".pitch-slide")
            ?.getBoundingClientRect();
          return {
            bottom: titleBounds.bottom,
            left: titleBounds.left,
            right: titleBounds.right,
            slideBottom: slideBounds?.bottom ?? 0,
            slideLeft: slideBounds?.left ?? 0,
            slideRight: slideBounds?.right ?? 0,
            slideTop: slideBounds?.top ?? 0,
            top: titleBounds.top,
          };
        },
      );
      expect(longTitle.top).toBeGreaterThanOrEqual(longTitle.slideTop);
      expect(longTitle.bottom).toBeLessThanOrEqual(longTitle.slideBottom);
      expect(longTitle.left).toBeGreaterThanOrEqual(longTitle.slideLeft);
      expect(longTitle.right).toBeLessThanOrEqual(longTitle.slideRight);
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("keeps overview and scroll content stable and opens speaker previews", async () => {
    const page = await browser.newPage();

    try {
      await page.goto(`${BASE_URL}/projects/agentic-code-review/deck`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector(".pitch-deck .reveal.ready", {
        timeout: 20_000,
      });

      await page.click('button[title="Slide overview"]');
      await page.waitForFunction(
        () =>
          document.querySelector(".pitch-deck__static--overview") &&
          Array.from(
            document.querySelectorAll<HTMLElement>(
              ".pitch-deck__static--overview > .slides > section",
            ),
          ).every(
            (slide) =>
              getComputedStyle(slide).display === "block" &&
              slide.textContent?.trim(),
          ),
      );

      await page.click('button[aria-label="Open slide 2"]');
      await page.waitForFunction(() =>
        document
          .querySelector(".pitch-deck__live section.present h2")
          ?.textContent?.includes("bottleneck"),
      );

      await page.click('button[title="Slide overview"]');
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            ".pitch-deck__static--overview > .slides > section",
          ).length === 8 &&
          Array.from(
            document.querySelectorAll<HTMLElement>(
              ".pitch-deck__static--overview > .slides > section",
            ),
          ).every(
            (slide) =>
              getComputedStyle(slide).display === "block" &&
              slide.textContent?.trim(),
          ),
      );

      await page.click('button[title="Toggle scroll view"]');
      await page.waitForFunction(
        () =>
          document.querySelector(".pitch-deck__static--scroll") &&
          document.querySelectorAll(
            ".pitch-deck__static--scroll > .slides > section",
          ).length === 8 &&
          document
            .querySelector('button[title="Toggle scroll view"]')
            ?.textContent?.trim() === "Slides",
      );
      const scrollView = await page.$eval(
        ".pitch-deck__stage--scroll",
        (stage) => ({
          clientHeight: stage.clientHeight,
          pages: stage.querySelectorAll(
            ".pitch-deck__static--scroll > .slides > section",
          ).length,
          scrollHeight: stage.scrollHeight,
          visibleSlides: Array.from(
            stage.querySelectorAll<HTMLElement>(
              ".pitch-deck__static--scroll > .slides > section",
            ),
          ).filter(
            (slide) =>
              getComputedStyle(slide).display === "block" &&
              slide.getBoundingClientRect().height > 0 &&
              Boolean(slide.textContent?.trim()),
          ).length,
        }),
      );
      expect(scrollView.pages).toBe(8);
      expect(scrollView.visibleSlides).toBe(8);
      expect(scrollView.scrollHeight).toBeGreaterThan(scrollView.clientHeight);

      await page.click('button[aria-label="Next slide"]');
      await page.waitForFunction(
        () =>
          document
            .querySelector(".pitch-deck__position")
            ?.textContent?.trim() === "Slide 3 of 8",
      );
      await page.click('button[title="Toggle scroll view"]');
      await page.waitForFunction(
        () =>
          !document.querySelector(".pitch-deck__static") &&
          !document
            .querySelector(".pitch-deck__live")
            ?.hasAttribute("hidden") &&
          document.querySelectorAll(".pitch-deck__live .slides > section")
            .length === 8 &&
          document
            .querySelector(".pitch-deck__live section.present h2")
            ?.textContent?.includes("Managed reviewers"),
      );

      expect(await page.$('a[aria-label="Print PDF"]')).toBeNull();

      const speakerTarget = browser.waitForTarget(
        (target) => target.opener() === page.target(),
        { timeout: 10_000 },
      );
      await page.click('button[title="Speaker view"]');
      const speakerPage = await (await speakerTarget).page();
      expect(speakerPage).not.toBeNull();
      expect(speakerPage?.url()).toContain(
        "/projects/agentic-code-review/deck/presenter#/3",
      );
      expect(speakerPage?.url()).not.toBe("about:blank");
      await speakerPage?.waitForSelector(
        'iframe[data-presenter-frame="current"]',
        {
          timeout: 10_000,
        },
      );
      await speakerPage?.waitForFunction(
        () =>
          [
            {
              selector: 'iframe[data-presenter-frame="current"]',
              heading: "Managed reviewers",
            },
            {
              selector: 'iframe[data-presenter-frame="upcoming"]',
              heading: "Own the review loop",
            },
          ].every(({ selector, heading }) =>
            document
              .querySelector<HTMLIFrameElement>(selector)
              ?.contentDocument?.querySelector(
                ".pitch-deck .reveal.ready section.present h1, .pitch-deck .reveal.ready section.present h2",
              )
              ?.textContent?.includes(heading),
          ),
        { timeout: 20_000 },
      );
      const speakerHeading = await speakerPage?.$eval(
        'iframe[data-presenter-frame="current"]',
        (frame) =>
          (frame as HTMLIFrameElement).contentDocument?.querySelector(
            ".pitch-deck section.present h1, .pitch-deck section.present h2",
          )?.textContent,
      );
      expect(speakerHeading).toContain("Managed reviewers");

      const upcomingHeading = await speakerPage?.$eval(
        'iframe[data-presenter-frame="upcoming"]',
        (frame) =>
          (frame as HTMLIFrameElement).contentDocument?.querySelector(
            ".pitch-deck section.present h1, .pitch-deck section.present h2",
          )?.textContent,
      );
      expect(upcomingHeading).toContain("Own the review loop");

      const speakerNotes = await speakerPage?.$eval(
        ".pitch-presenter__notes-body",
        (notes) => notes.textContent?.trim(),
      );
      expect(speakerNotes).toContain("control of the review loop");

      const speakerPreviewChrome = await speakerPage?.evaluate(() =>
        [
          'iframe[data-presenter-frame="current"]',
          'iframe[data-presenter-frame="upcoming"]',
        ].map((selector) => {
          const frameDocument =
            document.querySelector<HTMLIFrameElement>(
              selector,
            )?.contentDocument;
          return {
            ready: Boolean(
              frameDocument?.querySelector(".pitch-deck .reveal.ready"),
            ),
            controls: Boolean(
              frameDocument?.querySelector(".pitch-deck__controls"),
            ),
            topbar: Boolean(
              frameDocument?.querySelector(".pitch-deck__topbar"),
            ),
          };
        }),
      );
      expect(speakerPreviewChrome).toEqual([
        { ready: true, controls: false, topbar: false },
        { ready: true, controls: false, topbar: false },
      ]);

      const speakerPreviewUrls = await speakerPage?.$$eval(
        "iframe[data-presenter-frame]",
        (frames) => frames.map((frame) => (frame as HTMLIFrameElement).src),
      );
      expect(speakerPreviewUrls).toHaveLength(2);
      for (const previewUrl of speakerPreviewUrls ?? []) {
        const url = new URL(previewUrl);
        expect(url.origin).toBe(BASE_URL);
        expect(url.pathname).toBe("/projects/agentic-code-review/deck");
        expect(url.searchParams.get("fragments")).toBe("false");
        expect(url.searchParams.has("receiver")).toBe(true);
      }

      await page.click('button[aria-label="Next slide"]');
      await page.waitForFunction(() =>
        document
          .querySelector(".pitch-deck__live section.present h2")
          ?.textContent?.includes("Own the review loop"),
      );
      await speakerPage?.waitForFunction(
        () =>
          document
            .querySelector<HTMLIFrameElement>(
              'iframe[data-presenter-frame="current"]',
            )
            ?.contentDocument?.querySelector(".pitch-deck section.present h2")
            ?.textContent?.includes("Own the review loop") &&
          document
            .querySelector<HTMLIFrameElement>(
              'iframe[data-presenter-frame="upcoming"]',
            )
            ?.contentDocument?.querySelector(".pitch-deck section.present h2")
            ?.textContent?.includes("One pull request"),
        { timeout: 10_000 },
      );
      const updatedSpeakerNotes = await speakerPage?.$eval(
        ".pitch-presenter__notes-body",
        (notes) => notes.textContent?.trim(),
      );
      expect(updatedSpeakerNotes).toBe("No speaker notes for this slide.");

      await speakerPage?.reload({ waitUntil: "domcontentloaded" });
      expect(speakerPage?.url()).toContain(
        "/projects/agentic-code-review/deck/presenter#/4",
      );
      expect(speakerPage?.url()).not.toBe("about:blank");
      await speakerPage?.waitForFunction(
        () =>
          document
            .querySelector<HTMLIFrameElement>(
              'iframe[data-presenter-frame="current"]',
            )
            ?.contentDocument?.querySelector(".pitch-deck section.present h2")
            ?.textContent?.includes("Own the review loop") &&
          document
            .querySelector<HTMLIFrameElement>(
              'iframe[data-presenter-frame="upcoming"]',
            )
            ?.contentDocument?.querySelector(".pitch-deck section.present h2")
            ?.textContent?.includes("One pull request") &&
          document
            .querySelector(".pitch-presenter__notes-body")
            ?.textContent?.includes("No speaker notes for this slide"),
        { timeout: 20_000 },
      );
      await speakerPage?.close();
    } finally {
      await page.close();
    }
  }, 60_000);

  it.each([
    ["the technology demo", "/technologies/recharts", 3],
    ["the wealth article", "/blog/2020-09-27-how-to-build-wealth", 4],
  ])(
    "lazy-loads charts for %s",
    async (_label, path, expectedCharts) => {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));

      try {
        await page.goto(`${BASE_URL}${path}`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForFunction(
          (chartCount) =>
            document.querySelectorAll(".recharts-responsive-container")
              .length === chartCount,
          { timeout: 20_000 },
          expectedCharts,
        );

        const chartSizes = await page.$$eval(
          ".recharts-responsive-container",
          (containers) =>
            containers.map((container) => {
              const bounds = container.getBoundingClientRect();
              return { height: bounds.height, width: bounds.width };
            }),
        );

        expect(pageErrors).toEqual([]);
        expect(chartSizes).toHaveLength(expectedCharts);
        for (const chart of chartSizes) {
          expect(chart.width).toBeGreaterThan(100);
          expect(chart.height).toBeGreaterThan(100);
        }
      } finally {
        await page.close();
      }
    },
    30_000,
  );
});
