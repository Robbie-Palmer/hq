import type { PathLike } from "node:fs";
import { access } from "node:fs/promises";

export async function pathExists(target: PathLike): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
