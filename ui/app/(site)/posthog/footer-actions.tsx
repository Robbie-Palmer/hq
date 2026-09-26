"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { FileText, Monitor, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/generic/styles";

type PreviewMode = "desktop" | "mobile";

const actionClassName =
  "items-center gap-2 border-2 border-[var(--hog-ink)] bg-[#fffdf8] px-4 py-2.5 text-sm font-black shadow-[3px_3px_0_var(--hog-ink)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4";

export function PostHogFooterActions() {
  const [previewMode, setPreviewMode] = useState<PreviewMode | null>(null);

  return (
    <>
      <section className="border-t-2 border-[var(--hog-ink)] bg-[var(--hog-paper-deep)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-9 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12">
          <p className="text-sm font-black uppercase tracking-[0.16em]">
            Two other ways to view this page
          </p>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap">
            <button
              className={cn(actionClassName, "hidden lg:inline-flex")}
              onClick={() => setPreviewMode("mobile")}
              type="button"
            >
              <Smartphone className="size-4" aria-hidden="true" />
              View the mobile layout
            </button>
            <button
              className={cn(actionClassName, "inline-flex lg:hidden")}
              onClick={() => setPreviewMode("desktop")}
              type="button"
            >
              <Monitor className="size-4" aria-hidden="true" />
              View the desktop layout
            </button>
            <a
              className={cn(actionClassName, "inline-flex")}
              href="/posthog.md"
            >
              <FileText className="size-4" aria-hidden="true" />
              Read the agent-friendly Markdown
            </a>
          </div>
        </div>
      </section>

      <Dialog.Root
        open={previewMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewMode(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm" />
          <Dialog.Content className="fixed inset-3 z-[71] flex flex-col border-2 border-[#1d1f1f] bg-[#efe5d3] shadow-[7px_7px_0_#f05b52] focus:outline-none sm:inset-6">
            <div className="flex items-center justify-between gap-4 border-b-2 border-[#1d1f1f] bg-[#f7f2e8] px-4 py-3 text-[#1d1f1f] sm:px-5">
              <Dialog.Title className="text-lg font-black">
                {previewMode === "mobile"
                  ? "Mobile preview · 390px"
                  : "Desktop preview · 1280px"}
              </Dialog.Title>
              <Dialog.Close className="inline-flex items-center gap-2 border-2 border-[#1d1f1f] bg-[#fffdf8] px-3 py-2 text-sm font-black focus-visible:outline-2 focus-visible:outline-offset-2">
                Close
                <X className="size-4" aria-hidden="true" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              A framed preview of this application page at the alternate
              viewport width.
            </Dialog.Description>
            <div className="min-h-0 flex-1 overflow-auto bg-[#1d1f1f] p-4">
              {previewMode ? (
                <div
                  className={cn(
                    "mx-auto overflow-hidden border-2 border-[#1d1f1f] bg-white shadow-[5px_5px_0_#f5c842]",
                    previewMode === "mobile"
                      ? "h-[844px] w-[390px]"
                      : "h-[900px] w-[1280px]",
                  )}
                >
                  <iframe
                    className="size-full border-0"
                    src="/posthog"
                    title={`${previewMode === "mobile" ? "Mobile" : "Desktop"} preview of the PostHog application`}
                  />
                </div>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
