import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const headersFile = fs.readFileSync(
  path.resolve(process.cwd(), "public/_headers"),
  "utf8",
);

function header(name: string): string | undefined {
  return headersFile
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${name}:`))
    ?.slice(name.length + 1)
    .trim();
}

describe("Cloudflare Pages security headers", () => {
  it("applies baseline browser protections to every static response", () => {
    expect(headersFile.trimStart().startsWith("/*")).toBe(true);
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains; preload",
    );
    expect(header("Permissions-Policy")).toContain("camera=()");
  });

  it("blocks framing and limits active content to required origins", () => {
    const policy = header("Content-Security-Policy");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    );
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("https://imagedelivery.net");
    expect(policy).toContain("https://avatars.githubusercontent.com");
    expect(policy).toContain("https://*.googleusercontent.com");
  });

  it("allows only deliberate preview routes to render same-origin frames", () => {
    for (const route of [
      "/projects/:project/deck",
      "/technologies/revealdotjs/deck",
      "/posthog",
    ]) {
      const rule = headersFile.split(route)[1]?.split("\n\n")[0];
      expect(rule).toContain("! X-Frame-Options");
      expect(rule).toContain("! Content-Security-Policy");
      expect(rule).toContain("frame-ancestors 'self'");
      expect(rule).not.toContain("frame-ancestors 'none'");
    }

    const posthogRule = headersFile.split("/posthog")[1]?.split("\n\n")[0];
    expect(posthogRule).toContain("https://a.storyblok.com");
    expect(posthogRule).toContain("https://res.cloudinary.com");
    expect(posthogRule).toContain("https://ugc.production.linktr.ee");
  });

  it("keeps Cesium runtime permissions across client-side navigation", () => {
    const baselinePolicy = header("Content-Security-Policy");
    expect(baselinePolicy).toContain("'unsafe-eval'");
    expect(baselinePolicy).toContain("worker-src 'self' blob:");
    expect(headersFile).not.toContain("/technologies/cesiumjs\n");
  });
});
