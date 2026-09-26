#!/usr/bin/env node

import { chromium } from "@playwright/test";

const baseURL = new URL(
  process.env.SATELLITE_SWARM_AUDIT_URL ?? "http://127.0.0.1:3013",
);
const routeURL = new URL("/satellite-swarm", baseURL);
const sourceRevisionPattern = /^[0-9a-f]{40}$/;
const serverPID = Number(process.env.SATELLITE_SWARM_AUDIT_SERVER_PID);
const expectedSourceRevision = process.env.SATELLITE_SWARM_SOURCE_REVISION;

const profiles = {
  desktop: {
    context: {
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      viewport: { height: 900, width: 1440 },
    },
    cpuThrottlingRate: 1,
  },
  mobile: {
    context: {
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
      viewport: { height: 844, width: 390 },
    },
    cpuThrottlingRate: 4,
  },
};

function classify(url) {
  const pathname = new URL(url).pathname;
  if (pathname.startsWith("/ingest/")) return null;
  if (pathname.endsWith(".wasm")) return "webAssembly";
  if (/\.(?:m?js)$/.test(pathname)) return "javaScript";
  if (
    pathname.includes("/cesium/Assets/Textures/NaturalEarthII/") &&
    /\.(?:jpe?g|png|webp)$/.test(pathname)
  ) {
    return "imagery";
  }
  return null;
}

function isCesiumJavaScript(url) {
  const pathname = new URL(url).pathname;
  return pathname.startsWith("/cesium/") && /\.(?:m?js)$/.test(pathname);
}

function isNextJavaScriptChunk(url) {
  return new URL(url).pathname.startsWith("/_next/static/chunks/");
}

function assertAuditServerAlive() {
  if (!Number.isInteger(serverPID) || serverPID <= 0) return;

  try {
    process.kill(serverPID, 0);
  } catch (cause) {
    throw new Error(`Static-site server ${serverPID} exited before the audit`, {
      cause,
    });
  }
}

async function waitForServer() {
  let cause;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assertAuditServerAlive();
    try {
      const response = await fetch(routeURL, { method: "HEAD" });
      if (response.ok) {
        assertAuditServerAlive();
        return;
      }
      cause = new Error(`HTTP ${response.status}`);
    } catch (error) {
      cause = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Static site did not start at ${routeURL}`, { cause });
}

async function waitForImagery(requests, page) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (requests.some(({ category }) => category === "imagery")) return;
    await page.waitForTimeout(100);
  }
  throw new Error(
    "Cesium did not request its self-hosted Natural Earth imagery",
  );
}

async function responseSize(response) {
  const contentLengthHeader = await response.headerValue("content-length");
  const contentLength = Number(contentLengthHeader);
  if (
    contentLengthHeader !== null &&
    Number.isFinite(contentLength) &&
    contentLength >= 0
  ) {
    return contentLength;
  }
  return (await response.body()).byteLength;
}

async function sampleAnimationFrames(page, durationMs) {
  return page.evaluate(async (duration) => {
    const intervals = [];
    const startedAt = performance.now();
    let previous = startedAt;

    await new Promise((resolve) => {
      function sample(now) {
        intervals.push(now - previous);
        previous = now;
        if (now - startedAt >= duration) {
          resolve();
          return;
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });

    intervals.sort((left, right) => left - right);
    const percentileIndex = Math.min(
      intervals.length - 1,
      Math.floor(intervals.length * 0.95),
    );
    return {
      frames: intervals.length,
      longestFrameMs: Math.max(...intervals),
      p95FrameMs: intervals[percentileIndex] ?? 0,
      framesOver50Ms: intervals.filter((interval) => interval > 50).length,
    };
  }, durationMs);
}

async function auditProfile(browser, profile) {
  const context = await browser.newContext(profile.context);
  const page = await context.newPage();
  const devtools = await context.newCDPSession(page);
  const requests = [];
  const responseTasks = [];
  const pageErrors = [];
  const navigationRequests = [];

  await devtools.send("Network.enable");
  await devtools.send("Network.setCacheDisabled", { cacheDisabled: true });
  await devtools.send("Emulation.setCPUThrottlingRate", {
    rate: profile.cpuThrottlingRate,
  });

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      navigationRequests.push(url.href);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    const category = classify(url);
    if (!category) return;
    const record = { category, status: response.status(), url };
    requests.push(record);
    responseTasks.push(
      responseSize(response).then((bytes) => {
        record.bytes = bytes;
      }),
    );
  });

  try {
    await page.goto(routeURL.href, { waitUntil: "domcontentloaded" });
    const simulation = page.locator("#simulation");
    await simulation.waitFor({ state: "attached" });

    await simulation.scrollIntoViewIfNeeded();
    await page
      .getByText("South Pole mission replay", { exact: true })
      .waitFor();
    await page.locator(".cesium-widget canvas").waitFor({ state: "visible" });
    await waitForImagery(requests, page);
    const firstGlobeMs = await page.evaluate(() => performance.now());

    const revisionLink = page.locator(
      'a[href^="https://github.com/Robbie-Palmer/hq/commit/"]',
    );
    await revisionLink.waitFor();
    const sourceRevision = (await revisionLink.textContent())?.trim() ?? "";
    const sourceURL = await revisionLink.getAttribute("href");
    const fullRevision = sourceURL?.split("/").at(-1) ?? "";
    if (
      !sourceRevisionPattern.test(fullRevision) ||
      sourceRevision !== fullRevision.slice(0, 12)
    ) {
      throw new Error(
        "The simulation did not display its exact source revision",
      );
    }
    if (expectedSourceRevision && fullRevision !== expectedSourceRevision) {
      throw new Error(
        `The simulation reported ${fullRevision}, expected ${expectedSourceRevision}`,
      );
    }

    const frameSamplePromise = sampleAnimationFrames(page, 3_200);
    await page.getByRole("button", { name: "Play replay" }).click();
    await page.getByText("trace v5 · 120 ms", { exact: true }).waitFor();
    const rendering = await frameSamplePromise;

    await Promise.all(responseTasks);
    const javascriptRequests = requests.filter(
      ({ category }) => category === "javaScript",
    );
    if (!javascriptRequests.some(({ url }) => isCesiumJavaScript(url))) {
      throw new Error("The audit measured no deferred Cesium JavaScript");
    }
    if (!javascriptRequests.some(({ url }) => isNextJavaScriptChunk(url))) {
      throw new Error("The audit measured no deferred globe JavaScript chunk");
    }
    const failedResources = requests.filter(({ status }) => status >= 400);
    if (failedResources.length > 0) {
      throw new Error(
        `Simulation resources failed: ${failedResources
          .map(({ status, url }) => `${status} ${url}`)
          .join(", ")}`,
      );
    }

    const externalRequests = navigationRequests.filter(
      (url) => new URL(url).origin !== baseURL.origin,
    );
    if (externalRequests.length > 0) {
      throw new Error(
        `Satellite simulation made external requests: ${[...new Set(externalRequests)].join(", ")}`,
      );
    }
    if (pageErrors.length > 0) {
      throw new Error(`Browser errors: ${pageErrors.join(", ")}`);
    }

    const resources = Object.fromEntries(
      ["javaScript", "webAssembly", "imagery"].map((category) => {
        const matching = requests.filter(
          (request) => request.category === category,
        );
        return [
          category,
          {
            bytes: matching.reduce(
              (total, request) => total + (request.bytes ?? 0),
              0,
            ),
            requests: matching.length,
          },
        ];
      }),
    );
    for (const [category, result] of Object.entries(resources)) {
      if (result.requests === 0 || result.bytes === 0) {
        throw new Error(`The audit measured no ${category} resources`);
      }
    }

    return {
      cpuThrottlingRate: profile.cpuThrottlingRate,
      firstGlobeMs: Math.round(firstGlobeMs),
      rendering: {
        ...rendering,
        longestFrameMs: Number(rendering.longestFrameMs.toFixed(1)),
        p95FrameMs: Number(rendering.p95FrameMs.toFixed(1)),
      },
      resources,
      sourceRevision: fullRevision,
      viewport: profile.context.viewport,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  await waitForServer();
  const browser = await chromium.launch({
    args: [
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-angle=swiftshader",
      "--use-gl=angle",
    ],
    headless: true,
  });

  try {
    const results = {};
    for (const [name, profile] of Object.entries(profiles)) {
      results[name] = await auditProfile(browser, profile);
      assertAuditServerAlive();
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          browser: await browser.version(),
          measuredAt: new Date().toISOString(),
          route: routeURL.href,
          ...results,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await browser.close();
  }
}

await main();
