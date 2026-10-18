import { describe, expect, it } from "vitest";
import { isPreviewDeployment } from "@/lib/preview-environment";

describe("isPreviewDeployment", () => {
  it("recognizes canonical PR aliases", () => {
    expect(isPreviewDeployment("pr-42.personal-site-bu5.pages.dev")).toBe(true);
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "recognizes the loopback host %s for local preview QA",
    (hostname) => {
      expect(isPreviewDeployment(hostname)).toBe(true);
    },
  );

  it.each([
    "robbiepalmer.me",
    "personal-site-bu5.pages.dev",
    "abc123.personal-site-bu5.pages.dev",
  ])("does not treat %s as a canonical PR alias", (hostname) => {
    expect(isPreviewDeployment(hostname)).toBe(false);
  });
});
