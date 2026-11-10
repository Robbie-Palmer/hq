import { describe, expect, it } from "vitest";
import {
  inferReviewServiceUrl,
  LOOPBACK_SERVICE_URL,
} from "../domain/service-url";

describe("annotation review service URL", () => {
  it.each([
    "100.64.0.1",
    "100.127.255.254",
    "192.168.1.10",
    "mac-mini",
    "mac-mini.example-tailnet.ts.net",
  ])("uses the page host for private mobile access at %s", (hostname) => {
    expect(inferReviewServiceUrl(hostname)).toBe(`http://${hostname}:8765`);
  });

  it.each(["localhost", "127.0.0.1", "example.com", "100.128.0.1"])(
    "does not infer a private service from %s",
    (hostname) => {
      expect(inferReviewServiceUrl(hostname)).toBe(LOOPBACK_SERVICE_URL);
    },
  );
});
