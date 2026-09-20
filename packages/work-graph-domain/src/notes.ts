import { isNonBlankString } from "ts-base/strings";
import { WorkGraphError } from "./errors";
import type { WorkItemLifecycle } from "./vocabulary";

export interface PostReleaseNotePolicyInput {
  readonly workItemId: string;
  readonly lifecycle: WorkItemLifecycle;
  readonly author: string;
}

export const validatePostReleaseNote = (
  input: PostReleaseNotePolicyInput,
): void => {
  if (!isNonBlankString(input.author)) {
    throw new WorkGraphError(
      "invalid_note_author",
      "A post-release note must identify its author.",
    );
  }
  if (input.lifecycle !== "released") {
    throw new WorkGraphError(
      "work_item_not_released",
      `Work item ${input.workItemId} is ${input.lifecycle}, not released.`,
    );
  }
};
