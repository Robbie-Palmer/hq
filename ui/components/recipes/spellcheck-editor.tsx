"use client";

import { Check, RefreshCw, SpellCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CooklangToken,
  type CooklangTokenKind,
  tokenizeCooklang,
} from "recipe-domain/cooklang-highlighting";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTypoDictionary } from "@/hooks/use-typo-dictionary";
import {
  applyCorrection,
  findMisspellings,
  type Misspelling,
} from "@/lib/domain/recipe/spellcheck";
import { cn } from "@/lib/generic/styles";

// Typography/layout classes shared by the editable textarea and the highlight
// backdrop drawn over it. They must match exactly so highlighted ranges line up
// with the caret; only colour/interaction differs between the two layers.
const SHARED_BOX =
  "rt-body min-h-[360px] w-full rounded-lg border border-[var(--line-strong)] p-3 text-base leading-relaxed";

interface SpellcheckEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly ariaLabel?: string;
}

/** A misspelling the user clicked, with the viewport rect of its highlight. */
interface ActiveMark {
  readonly misspelling: Misspelling;
  readonly rect: DOMRect;
}

/**
 * Cooklang text editor with inline, `typos`-parity spell-checking. Misspellings
 * are underlined in a highlight layer over the textarea; clicking one (or using
 * the issues summary) accepts a suggested correction or dismisses it — the
 * document-editor experience the repo's pre-commit `typos` gate used to provide
 * for file-based recipes.
 */
export function SpellcheckEditor({
  value,
  onChange,
  placeholder,
  maxLength,
  ariaLabel,
}: SpellcheckEditorProps) {
  const { dictionary, ready, retry } = useTypoDictionary();
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [active, setActive] = useState<ActiveMark | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const misspellings = useMemo(
    () => (dictionary ? findMisspellings(value, dictionary, ignored) : []),
    [dictionary, value, ignored],
  );

  // The popover anchor is a fixed-position rect captured at click time, so any
  // scroll (capture phase catches the textarea's too) or resize would leave it
  // stale — close it instead of letting it drift.
  useEffect(() => {
    if (!active) return;
    const close = () => setActive(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [active]);

  // A correction rewrites the source via onChange, bypassing the textarea's
  // maxLength; skip any that would push the recipe past the save limit.
  const withinLimit = (text: string) =>
    maxLength === undefined || text.length <= maxLength;

  const accept = (misspelling: Misspelling, replacement: string) => {
    setActive(null);
    // Guard against a stale offset: only rewrite if the flagged range still
    // holds the exact word (the source may have shifted since it was flagged).
    if (value.slice(misspelling.start, misspelling.end) !== misspelling.word) {
      return;
    }
    const next = applyCorrection(value, misspelling, replacement);
    if (withinLimit(next)) onChange(next);
  };

  const ignore = (word: string) => {
    setIgnored((prev) => new Set(prev).add(word.toLowerCase()));
    setActive(null);
  };

  const fixAll = () => {
    // Apply right-to-left so earlier offsets stay valid as text length changes.
    const next = [...misspellings]
      .sort((a, b) => b.start - a.start)
      .reduce((text, m) => {
        const replacement = m.suggestions[0];
        if (!replacement) return text;
        const candidate = applyCorrection(text, m, replacement);
        return withinLimit(candidate) ? candidate : text;
      }, value);
    onChange(next);
  };

  const fixableCount = misspellings.filter(
    (m) => m.suggestions.length > 0,
  ).length;

  return (
    <div className="grid gap-2">
      <SpellcheckSummary
        ready={ready}
        unavailable={ready && !dictionary}
        misspellings={misspellings}
        fixableCount={fixableCount}
        onFixAll={fixAll}
        onAccept={accept}
        onIgnore={ignore}
        onRetry={retry}
      />
      <div className="relative">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => {
            const backdrop = backdropRef.current;
            if (backdrop) {
              backdrop.scrollTop = event.currentTarget.scrollTop;
              backdrop.scrollLeft = event.currentTarget.scrollLeft;
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-label={ariaLabel}
          // Our curated check replaces the browser's, so its squiggles don't
          // double up with ours.
          spellCheck={false}
          className={cn(
            SHARED_BOX,
            "relative z-0 block resize-y bg-[var(--paper)] text-transparent caret-[var(--ink)] outline-none transition-shadow placeholder:text-[var(--ink-4)] focus:border-[var(--terracotta)] focus:ring-3 focus:ring-[var(--terracotta)]/15",
          )}
        />
        <HighlightBackdrop
          ref={backdropRef}
          value={value}
          misspellings={misspellings}
          onMarkClick={(misspelling, rect) => setActive({ misspelling, rect })}
        />
        {/* One shared popover repositions to the clicked mark rather than
            mounting a Radix root per highlight. */}
        <Popover
          open={active !== null}
          onOpenChange={(open) => {
            if (!open) setActive(null);
          }}
        >
          {active && (
            <PopoverAnchor asChild>
              <div
                aria-hidden="true"
                className="pointer-events-none fixed"
                style={{
                  top: active.rect.top,
                  left: active.rect.left,
                  width: active.rect.width,
                  height: active.rect.height,
                }}
              />
            </PopoverAnchor>
          )}
          <PopoverContent align="start" className="w-64 p-2">
            {active && (
              <SpellcheckSuggestionRow
                misspelling={active.misspelling}
                onAccept={accept}
                onIgnore={ignore}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function SpellcheckSummary({
  ready,
  unavailable,
  misspellings,
  fixableCount,
  onFixAll,
  onAccept,
  onIgnore,
  onRetry,
}: {
  readonly ready: boolean;
  readonly unavailable: boolean;
  readonly misspellings: readonly Misspelling[];
  readonly fixableCount: number;
  readonly onFixAll: () => void;
  readonly onAccept: (misspelling: Misspelling, replacement: string) => void;
  readonly onIgnore: (word: string) => void;
  readonly onRetry: () => void;
}) {
  if (unavailable) {
    return (
      <p className="rt-mono flex items-center gap-2 text-xs text-[var(--ink-4)]">
        <SpellCheck className="size-3.5" />
        Spell-check unavailable
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 text-[var(--terracotta-deep)] hover:underline"
        >
          <RefreshCw className="size-3" /> Retry
        </button>
      </p>
    );
  }

  if (!ready || misspellings.length === 0) {
    return (
      <p className="rt-mono flex items-center gap-1.5 text-xs text-[var(--ink-4)]">
        <SpellCheck className="size-3.5" />
        {ready ? "No spelling issues" : "Checking spelling…"}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--paper-warm)] px-3 py-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rt-mono flex items-center gap-1.5 text-sm text-[var(--terracotta-deep)] hover:underline"
          >
            <SpellCheck className="size-4" />
            {misspellings.length} possible spelling{" "}
            {misspellings.length === 1 ? "issue" : "issues"}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-80 w-80 overflow-auto p-2"
        >
          <ul className="grid gap-1">
            {misspellings.map((misspelling) => (
              <li
                key={`${misspelling.start}:${misspelling.word}`}
                className="rounded-md px-2 py-1.5 hover:bg-[var(--paper-warm)]"
              >
                <SpellcheckSuggestionRow
                  misspelling={misspelling}
                  onAccept={onAccept}
                  onIgnore={onIgnore}
                />
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={fixableCount === 0}
        onClick={onFixAll}
      >
        <Check /> Fix all
      </Button>
    </div>
  );
}

function SpellcheckSuggestionRow({
  misspelling,
  onAccept,
  onIgnore,
}: {
  readonly misspelling: Misspelling;
  readonly onAccept: (misspelling: Misspelling, replacement: string) => void;
  readonly onIgnore: (word: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <span className="rt-mono text-xs text-[var(--ink-3)]">
        “{misspelling.word}”
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {misspelling.suggestions.length > 0 ? (
          misspelling.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onAccept(misspelling, suggestion)}
              className="rt-body inline-flex items-center gap-1 rounded-md border border-[var(--line-strong)] bg-[var(--card)] px-2 py-0.5 text-sm font-semibold text-[var(--ink)] hover:border-[var(--terracotta)] hover:text-[var(--terracotta-deep)]"
            >
              <Check className="size-3" /> {suggestion}
            </button>
          ))
        ) : (
          <span className="rt-mono text-xs text-[var(--ink-4)]">
            No suggestion
          </span>
        )}
        <button
          type="button"
          onClick={() => onIgnore(misspelling.word)}
          className="rt-mono inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-[var(--ink-3)] hover:text-[var(--ink)]"
        >
          <X className="size-3" /> Ignore
        </button>
      </div>
    </div>
  );
}

interface BackdropSegment {
  /** Source offset where this segment starts — a stable React key. */
  readonly offset: number;
  readonly text: string;
  readonly token: CooklangTokenKind;
  readonly misspelling: Misspelling | null;
}

function advanceRangeIndex(
  ranges: readonly { readonly end: number }[],
  index: number,
  offset: number,
) {
  let nextIndex = index;
  while (true) {
    const range = ranges[nextIndex];
    if (!range || range.end > offset) return nextIndex;
    nextIndex += 1;
  }
}

function buildSegments(
  value: string,
  tokens: readonly CooklangToken[],
  misspellings: readonly Misspelling[],
): BackdropSegment[] {
  const boundaries = new Set([0, value.length]);
  for (const token of tokens) {
    boundaries.add(token.start);
    boundaries.add(token.end);
  }
  for (const misspelling of misspellings) {
    boundaries.add(misspelling.start);
    boundaries.add(misspelling.end);
  }

  const offsets = [...boundaries].sort((a, b) => a - b);
  const segments: BackdropSegment[] = [];
  let tokenIndex = 0;
  let misspellingIndex = 0;
  for (let index = 0; index < offsets.length - 1; index += 1) {
    const start = offsets[index];
    const end = offsets[index + 1];
    if (start === undefined || end === undefined || start === end) continue;

    tokenIndex = advanceRangeIndex(tokens, tokenIndex, start);
    misspellingIndex = advanceRangeIndex(misspellings, misspellingIndex, start);

    const misspelling = misspellings[misspellingIndex];
    segments.push({
      offset: start,
      text: value.slice(start, end),
      token: tokens[tokenIndex]?.kind ?? "instruction",
      misspelling:
        misspelling && misspelling.start <= start && misspelling.end >= end
          ? misspelling
          : null,
    });
  }
  return segments;
}

const TOKEN_CLASSES = {
  instruction: "text-[var(--ink)]",
  ingredient: "text-[var(--terracotta-deep)]",
  cookware: "text-[var(--berry)]",
  timer: "text-[var(--terracotta)]",
  quantity: "font-semibold text-[var(--berry)]",
  unit: "text-[var(--terracotta)]",
  punctuation: "text-[var(--terracotta)]",
} satisfies Record<CooklangTokenKind, string>;

function HighlightSegment({
  segment,
  onMarkClick,
}: {
  readonly segment: BackdropSegment;
  readonly onMarkClick: (misspelling: Misspelling, rect: DOMRect) => void;
}) {
  const flagged = segment.misspelling;
  if (!flagged) {
    return (
      <span
        data-cooklang-token={segment.token}
        className={TOKEN_CLASSES[segment.token]}
      >
        {segment.text}
      </span>
    );
  }
  // The inline button preserves the backdrop's text metrics. The aria-hidden
  // parent and tabIndex keep it out of the accessibility and keyboard trees;
  // those users act through the issues list instead.
  return (
    <button
      type="button"
      tabIndex={-1}
      data-spellcheck-mark
      data-cooklang-token={segment.token}
      onClick={(event) =>
        onMarkClick(flagged, event.currentTarget.getBoundingClientRect())
      }
      className={cn(
        TOKEN_CLASSES[segment.token],
        "pointer-events-auto inline cursor-pointer border-0 bg-transparent p-0 underline decoration-[var(--terracotta)] decoration-wavy decoration-2 underline-offset-2",
      )}
    >
      {segment.text}
    </button>
  );
}

function HighlightBackdrop({
  ref,
  value,
  misspellings,
  onMarkClick,
}: {
  readonly ref: React.Ref<HTMLDivElement>;
  readonly value: string;
  readonly misspellings: readonly Misspelling[];
  readonly onMarkClick: (misspelling: Misspelling, rect: DOMRect) => void;
}) {
  const tokens = useMemo(() => tokenizeCooklang(value), [value]);
  const segments = useMemo(
    () => buildSegments(value, tokens, misspellings),
    [value, tokens, misspellings],
  );

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-cooklang-highlight-backdrop
      className={cn(
        SHARED_BOX,
        // Sits over the textarea; only marks capture pointer events so typing
        // and caret placement fall through to the transparent textarea beneath.
        "pointer-events-none absolute inset-0 z-10 select-none overflow-hidden whitespace-pre-wrap break-words border-transparent text-[var(--ink)]",
      )}
    >
      {segments.map((segment) => (
        <HighlightSegment
          key={segment.offset}
          segment={segment}
          onMarkClick={onMarkClick}
        />
      ))}
      {/* Keeps the backdrop's final line height in step with the textarea when
          the text ends on a newline. */}
      {"\n"}
    </div>
  );
}
