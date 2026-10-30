import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/styles";

export type SaveStatusState = "idle" | "saving" | "saved" | "error";

export function SaveStatus({
  state,
  error,
  idleText = "changes save automatically",
  savingText = "saving...",
  showErrorIcon = true,
}: Readonly<{
  state: SaveStatusState;
  error: string | null;
  idleText?: string;
  savingText?: string;
  showErrorIcon?: boolean;
}>) {
  const content = {
    idle: {
      icon: <span className="size-2 rounded-full bg-[var(--sage)]" />,
      text: idleText,
      className: "text-[var(--sage)]",
    },
    saving: {
      icon: (
        <LoaderCircle className="size-3.5 animate-spin text-[var(--ink-3)]" />
      ),
      text: savingText,
      className: "text-[var(--ink-3)]",
    },
    saved: {
      icon: <Check className="size-3.5 text-[var(--sage)]" />,
      text: "saved",
      className: "text-[var(--sage)]",
    },
    error: {
      icon: showErrorIcon ? (
        <TriangleAlert className="size-3.5 text-[var(--destructive)]" />
      ) : null,
      text: error ?? "Your changes could not be saved.",
      className: "text-[var(--destructive)]",
    },
  }[state];

  return (
    <>
      {content.icon}
      <span
        role={state === "error" ? "alert" : undefined}
        className={cn("rt-mono", content.className)}
      >
        {content.text}
      </span>
    </>
  );
}
