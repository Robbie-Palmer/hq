import { describe, expect, it } from "vitest";
import packageJson from "../../../../package.json";

describe("table room canvas dependency", () => {
  it("stays on the React 19.2-compatible react-konva line", async () => {
    expect(packageJson.dependencies["react-konva"]).toMatch(/^~19\.2\./);

    const { Stage } = await import("react-konva");

    expect(Stage).toBeDefined();
  });
});
