import type { EditorView } from "../components/accommodation-editor";

const workflowPaths: Record<EditorView, string> = {
  readiness: "/wedding-planner/readiness",
  bed_groups: "/wedding-planner/accommodation",
  guests: "/wedding-planner/guests",
  sharing: "/wedding-planner/accommodation/sharing",
  inventory: "/wedding-planner/accommodation/inventory",
  plan: "/wedding-planner/accommodation/rooms",
  result: "/wedding-planner/accommodation/result",
  tables: "/wedding-planner/seating",
  music: "/wedding-planner/music",
  exports: "/wedding-planner/exports",
};

export function workflowHref(view: EditorView, targetId?: string): string {
  const path = workflowPaths[view];
  return view === "guests" && targetId
    ? `${path}?guest=${encodeURIComponent(targetId)}`
    : path;
}
