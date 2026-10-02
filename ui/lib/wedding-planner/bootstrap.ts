import type { PlannerApplication } from "./application";
import { toEditorState } from "./editor-projection";
import { createSampleWeddingPlan } from "./sample-plan";

export async function loadEditorPlan(
  application: PlannerApplication,
  seedSample: boolean,
) {
  const existing = await application.load();
  if (existing || !seedSample) return existing;
  const sample = toEditorState(createSampleWeddingPlan());
  await application.save(sample);
  return sample;
}
