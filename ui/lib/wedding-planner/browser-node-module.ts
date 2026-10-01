export function createRequire(): never {
  throw new Error("Node modules are unavailable in the browser");
}
