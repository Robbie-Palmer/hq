import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTextFile } from "../src/downloads";

describe("downloadTextFile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("downloads text through a temporary object URL and releases it", () => {
    const click = vi.fn();
    const anchor = { click, download: "", href: "" };
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:report"),
      revokeObjectURL,
    });
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => callback(),
    });

    downloadTextFile("report.csv", "text/csv", "one,two");

    expect(anchor).toMatchObject({
      download: "report.csv",
      href: "blob:report",
    });
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:report");
  });
});
