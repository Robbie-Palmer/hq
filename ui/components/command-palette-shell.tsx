"use client";

import { Search } from "lucide-react";
import posthog from "posthog-js";
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  FilterOption,
  PaletteBlogPost,
  PaletteIdea,
  PaletteInitiative,
  PaletteProject,
  PaletteTechnology,
} from "@/components/command-palette-types";
import { Button } from "@/components/ui/button";
import { useIsMac } from "@/hooks/use-is-mac";
import { cn } from "@/lib/generic/styles";

const CommandPaletteDialog = lazy(() =>
  import("./command-palette").then((module) => ({
    default: module.CommandPaletteDialog,
  })),
);

export type {
  FilterOption,
  PaletteBlogPost,
  PaletteIdea,
  PaletteInitiative,
  PaletteProject,
  PaletteTechnology,
} from "@/components/command-palette-types";

interface CommandPaletteContextValue {
  registerFilters: (filters: FilterOption[]) => void;
  unregisterFilters: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null,
);

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error(
      "useCommandPalette must be used within CommandPaletteProvider",
    );
  }
  return context;
}

export function useRegisterFilters(filters: FilterOption[]) {
  const { registerFilters, unregisterFilters } = useCommandPalette();

  useEffect(() => {
    registerFilters(filters);
    return () => unregisterFilters();
  }, [filters, registerFilters, unregisterFilters]);
}

export function HotkeyHint({ className }: Readonly<{ className?: string }>) {
  const isMac = useIsMac();
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium",
        className,
      )}
    >
      {isMac ? <span className="text-xs">⌘</span> : <span>Ctrl</span>}
      <span>K</span>
    </kbd>
  );
}

interface CommandPaletteProviderProps {
  children: ReactNode;
  technologies?: PaletteTechnology[];
  ideas?: PaletteIdea[];
  projects?: PaletteProject[];
  initiatives?: PaletteInitiative[];
  blogPosts?: PaletteBlogPost[];
}

export function CommandPaletteProvider({
  children,
  technologies = [],
  ideas = [],
  projects = [],
  initiatives = [],
  blogPosts = [],
}: Readonly<CommandPaletteProviderProps>) {
  const [open, setOpen] = useState(false);
  const [pageFilters, setPageFilters] = useState<FilterOption[]>([]);

  const registerFilters = useCallback((filters: FilterOption[]) => {
    setPageFilters(filters);
  }, []);

  const unregisterFilters = useCallback(() => {
    setPageFilters([]);
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previousOpen) => {
          if (!previousOpen) {
            posthog.capture("command_palette_opened", {
              trigger: "keyboard",
            });
          }
          return !previousOpen;
        });
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const contextValue = useMemo(
    () => ({
      registerFilters,
      unregisterFilters,
      open,
      setOpen,
    }),
    [registerFilters, unregisterFilters, open],
  );

  return (
    <CommandPaletteContext.Provider value={contextValue}>
      {children}
      {open && (
        <Suspense fallback={null}>
          <CommandPaletteDialog
            open={open}
            onOpenChange={setOpen}
            pageFilters={pageFilters}
            technologies={technologies}
            ideas={ideas}
            projects={projects}
            initiatives={initiatives}
            blogPosts={blogPosts}
          />
        </Suspense>
      )}
    </CommandPaletteContext.Provider>
  );
}

export function CommandPaletteTrigger({
  className,
}: Readonly<{ className?: string }>) {
  const { setOpen } = useCommandPalette();

  const handleOpen = useCallback(() => {
    posthog.capture("command_palette_opened", { trigger: "navbar" });
    setOpen(true);
  }, [setOpen]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleOpen}
        aria-label="Search"
        className={cn("md:hidden", className)}
      >
        <Search className="size-5" />
      </Button>

      <button
        type="button"
        onClick={handleOpen}
        aria-label="Search"
        className={cn(
          "hidden md:inline-flex items-center gap-2 h-9 w-44 rounded-md border bg-background px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          className,
        )}
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search</span>
        <HotkeyHint />
      </button>
    </>
  );
}
