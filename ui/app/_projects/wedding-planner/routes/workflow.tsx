"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  AccommodationEditor,
  type EditorView,
} from "../components/accommodation-editor";
import { workflowHref } from "./workflow-paths";

export function GuestWorkflow() {
  return <EditorWorkflow view="guests" />;
}

export function AccommodationWorkflow({
  view,
}: Readonly<{
  view: Extract<
    EditorView,
    "bed_groups" | "sharing" | "inventory" | "plan" | "result"
  >;
}>) {
  return <EditorWorkflow view={view} />;
}

function EditorWorkflow({ view }: Readonly<{ view: EditorView }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  return (
    <AccommodationEditor
      routeView={view}
      selectedGuestId={
        view === "guests" ? searchParams.get("guest") : undefined
      }
      onNavigate={(destination, targetId) => {
        router.push(workflowHref(destination, targetId));
      }}
      onGuestChange={(guestId) => {
        if (view !== "guests") return;
        router.replace(workflowHref("guests", guestId ?? undefined));
      }}
    />
  );
}
