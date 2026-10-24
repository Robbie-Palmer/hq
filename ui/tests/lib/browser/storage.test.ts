import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readBrowserStorage,
  readBrowserStorageJson,
  removeBrowserStorage,
  writeBrowserStorage,
  writeBrowserStorageJson,
} from "@/lib/browser/storage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("browser storage", () => {
  it("reads, writes, and removes values", () => {
    expect(writeBrowserStorage("localStorage", "recipe-key", "value")).toBe(
      true,
    );
    expect(readBrowserStorage("localStorage", "recipe-key")).toBe("value");
    expect(removeBrowserStorage("localStorage", "recipe-key")).toBe(true);
    expect(readBrowserStorage("localStorage", "recipe-key")).toBeNull();
  });

  it("round trips validated JSON", () => {
    expect(
      writeBrowserStorageJson("localStorage", "position", {
        right: 8,
        bottom: 16,
      }),
    ).toBe(true);

    expect(
      readBrowserStorageJson(
        "localStorage",
        "position",
        (value): value is { right: number; bottom: number } =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as { right?: unknown }).right === "number" &&
          typeof (value as { bottom?: unknown }).bottom === "number",
      ),
    ).toEqual({ right: 8, bottom: 16 });
  });

  it("returns null for malformed or rejected JSON", () => {
    localStorage.setItem("position", "{");
    expect(
      readBrowserStorageJson(
        "localStorage",
        "position",
        (value): value is number => typeof value === "number",
      ),
    ).toBeNull();

    localStorage.setItem("position", JSON.stringify("wrong shape"));
    expect(
      readBrowserStorageJson(
        "localStorage",
        "position",
        (value): value is number => typeof value === "number",
      ),
    ).toBeNull();
  });

  it("contains blocked storage failures", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });

    expect(readBrowserStorage("localStorage", "recipe-key")).toBeNull();
    expect(writeBrowserStorage("localStorage", "recipe-key", "value")).toBe(
      false,
    );
    expect(removeBrowserStorage("localStorage", "recipe-key")).toBe(false);
  });
});
