"use client";

import { Deck } from "@revealjs/react";
import {
  ArrowLeft,
  ArrowRight,
  Columns3,
  Expand,
  FileText,
  LayoutGrid,
  Presentation,
} from "lucide-react";
import Link from "next/link";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RevealApi, RevealConfig, RevealPlugin } from "reveal.js";

interface PitchDeckFrameProps {
  backHref?: string;
  backLabel?: string;
  children: React.ReactNode;
  presentationHref?: string;
  projectSlug?: string;
  title: string;
  mode: "embedded" | "focused";
  plugins?: RevealPlugin[];
  showPresenterTools?: boolean;
  showSpeakerView?: boolean;
}

type Position = {
  current: number;
  total: number;
  atStart: boolean;
  atEnd: boolean;
};

type DeckView = "slides" | "overview" | "scroll";

type SpeakerRevealConfig = RevealConfig & {
  url?: string;
};

const speakerMessageNamespace = "pitch-deck-presenter";

const initialPosition: Position = {
  current: 1,
  total: 1,
  atStart: true,
  atEnd: false,
};

function PresenterTopbar({
  backHref,
  backLabel,
  fullscreenButtonRef,
  isFullscreen,
  mode,
  narrowLayout,
  onFullscreen,
  onOverview,
  onScrollView,
  onSpeakerView,
  presentationHref,
  show,
  showSpeakerView,
  title,
  view,
}: Readonly<{
  backHref?: string;
  backLabel: string;
  fullscreenButtonRef: RefObject<HTMLButtonElement | null>;
  isFullscreen: boolean;
  mode: "embedded" | "focused";
  narrowLayout: boolean;
  onFullscreen: () => void;
  onOverview: () => void;
  onScrollView: () => void;
  onSpeakerView: () => void;
  presentationHref?: string;
  show: boolean;
  showSpeakerView: boolean;
  title: string;
  view: DeckView;
}>) {
  if (!show) return null;
  return (
    <div className="pitch-deck__topbar">
      {mode === "focused" && backHref && (
        <Link href={backHref} className="pitch-deck__back">
          <ArrowLeft aria-hidden="true" />
          {backLabel}
        </Link>
      )}
      <span className="pitch-deck__title">{title}</span>
      <div className="pitch-deck__tools">
        {mode === "embedded" && presentationHref && (
          <Link href={presentationHref}>
            <Presentation aria-hidden="true" />
            <span>Present</span>
          </Link>
        )}
        <button
          type="button"
          onClick={onOverview}
          aria-pressed={view === "overview"}
          title="Slide overview"
        >
          <LayoutGrid aria-hidden="true" />
          <span>Overview</span>
        </button>
        {!narrowLayout && (
          <button
            type="button"
            className="pitch-deck__scroll-toggle"
            onClick={onScrollView}
            aria-pressed={view === "scroll"}
            title="Toggle scroll view"
          >
            <Columns3 aria-hidden="true" />
            <span>{view === "scroll" ? "Slides" : "Scroll"}</span>
          </button>
        )}
        {showSpeakerView && (
          <button type="button" onClick={onSpeakerView} title="Speaker view">
            <Presentation aria-hidden="true" />
            <span>Speaker</span>
          </button>
        )}
        <button
          ref={fullscreenButtonRef}
          type="button"
          onClick={onFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          <Expand aria-hidden="true" />
          <span>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
        </button>
      </div>
    </div>
  );
}

function PresentationControls({
  isSpeakerPreview,
  mode,
  onNavigate,
  position,
  presentationHref,
  projectSlug,
}: Readonly<{
  isSpeakerPreview: boolean;
  mode: "embedded" | "focused";
  onNavigate: (direction: -1 | 1) => void;
  position: Position;
  presentationHref?: string;
  projectSlug?: string;
}>) {
  if (isSpeakerPreview) return null;
  return (
    <div className="pitch-deck__controls">
      <div className="pitch-deck__navigation">
        <button
          type="button"
          onClick={() => onNavigate(-1)}
          disabled={position.atStart}
          aria-label="Previous slide"
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onNavigate(1)}
          disabled={position.atEnd}
          aria-label="Next slide"
        >
          <ArrowRight aria-hidden="true" />
        </button>
        <span
          className="pitch-deck__position"
          aria-live="polite"
          aria-atomic="true"
        >
          Slide {position.current} of {position.total}
        </span>
      </div>
      {(projectSlug || (mode === "embedded" && presentationHref)) && (
        <div className="pitch-deck__links">
          {projectSlug && (
            <a
              href={`/projects/${projectSlug}/deck.md`}
              aria-label="Transcript"
              title="Read transcript"
            >
              <FileText aria-hidden="true" />
              <span>Transcript</span>
            </a>
          )}
          {mode === "embedded" && presentationHref && (
            <Link
              href={presentationHref}
              aria-label="Open deck"
              title="Open deck"
            >
              <Expand aria-hidden="true" />
              <span>Open deck</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function PitchDeckFrame({
  backHref,
  backLabel,
  children,
  presentationHref,
  projectSlug,
  title,
  mode,
  plugins = [],
  showPresenterTools = false,
  showSpeakerView = true,
}: Readonly<PitchDeckFrameProps>) {
  const deckRef = useRef<RevealApi | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const staticViewRef = useRef<HTMLElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const speakerWindowRef = useRef<Window | null>(null);
  const pendingSlideRef = useRef<number | null>(null);
  const currentPositionRef = useRef(1);
  const scrollTargetRef = useRef<number | null>(null);
  const [position, setPosition] = useState(initialPosition);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [narrowLayout, setNarrowLayout] = useState(false);
  const [isSpeakerPreview, setIsSpeakerPreview] = useState(false);
  const [view, setView] = useState<DeckView>("slides");
  const [isFullscreen, setIsFullscreen] = useState(false);

  // The notes plugin calls next() in its upcoming iframe. Fragments would
  // leave that iframe on the current slide instead of showing the next one.
  const speakerPreviewUrl = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set("fragments", "false");
    return url.toString();
  }, []);

  useEffect(() => {
    currentPositionRef.current = position.current;
  }, [position.current]);

  const resolvedBackHref =
    backHref ?? (projectSlug ? `/projects/${projectSlug}` : undefined);
  const resolvedBackLabel =
    backLabel ?? (projectSlug ? "Back to project" : "Back");
  const resolvedPresentationHref =
    presentationHref ??
    (projectSlug ? `/projects/${projectSlug}/deck` : undefined);

  const sendSpeakerState = useCallback(
    (target = speakerWindowRef.current) => {
      if (!target || target.closed) return;
      const notes = deckRef.current
        ?.getCurrentSlide()
        ?.querySelector<HTMLElement>("aside.notes")
        ?.textContent?.trim();
      target.postMessage(
        {
          namespace: speakerMessageNamespace,
          type: "state",
          current: position.current - 1,
          total: position.total,
          notes: notes ?? "",
        },
        window.location.origin,
      );
    },
    [position.current, position.total],
  );

  useEffect(() => {
    if (!resolvedPresentationHref) return;
    const handleSpeakerMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== speakerWindowRef.current ||
        event.data?.namespace !== speakerMessageNamespace
      ) {
        return;
      }
      if (event.data.type === "connect") {
        sendSpeakerState(event.source as Window);
      } else if (event.data.type === "navigate") {
        event.data.direction === "previous"
          ? deckRef.current?.prev()
          : deckRef.current?.next();
      }
    };
    window.addEventListener("message", handleSpeakerMessage);
    return () => window.removeEventListener("message", handleSpeakerMessage);
  }, [resolvedPresentationHref, sendSpeakerState]);

  useEffect(() => {
    sendSpeakerState();
  }, [sendSpeakerState]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => {
      setNarrowLayout(query.matches);
      if (query.matches) {
        setView((current) => (current === "scroll" ? "slides" : current));
      }
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setIsSpeakerPreview(
      new URLSearchParams(window.location.search).has("receiver"),
    );
  }, []);

  const updatePosition = useCallback((readyDeck?: RevealApi) => {
    const deck = readyDeck ?? deckRef.current;
    if (!deck) return;
    setPosition({
      current: deck.getSlidePastCount() + 1,
      total: Math.max(deck.getTotalSlides(), 1),
      atStart: deck.isFirstSlide(),
      atEnd: deck.isLastSlide(),
    });
  }, []);
  const handleReady = useCallback(
    (deck: RevealApi) => {
      deckRef.current = deck;
      updatePosition(deck);
    },
    [updatePosition],
  );
  const handlePositionEvent = useCallback(
    () => updatePosition(),
    [updatePosition],
  );

  useEffect(() => {
    let layoutFrame = 0;
    const syncFullscreen = () => {
      const active = document.fullscreenElement === shellRef.current;
      setIsFullscreen(active);
      if (!active) fullscreenButtonRef.current?.focus();

      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => {
        deckRef.current?.layout();
        updatePosition();
      });
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => {
      cancelAnimationFrame(layoutFrame);
      document.removeEventListener("fullscreenchange", syncFullscreen);
    };
  }, [updatePosition]);

  const config = useMemo<SpeakerRevealConfig>(
    () => ({
      height: narrowLayout ? 960 : 720,
      width: narrowLayout ? 720 : 1280,
      margin: 0.055,
      embedded: true,
      keyboardCondition: mode === "embedded" ? "focused" : null,
      hash: mode === "focused",
      hashOneBasedIndex: mode === "focused",
      history: mode === "focused",
      autoSlide: false,
      transition: reducedMotion ? "none" : "slide",
      backgroundTransition: reducedMotion ? "none" : "fade",
      controls: false,
      progress: false,
      slideNumber: false,
      overview: false,
      view: null,
      scrollActivationWidth: 0,
      ...(speakerPreviewUrl ? { url: speakerPreviewUrl } : {}),
    }),
    [mode, narrowLayout, reducedMotion, speakerPreviewUrl],
  );

  const toggleOverview = () => {
    setView((current) => (current === "overview" ? "slides" : "overview"));
  };

  const toggleScrollView = () => {
    if (view === "scroll") {
      pendingSlideRef.current =
        scrollTargetRef.current ?? currentPositionRef.current - 1;
      scrollTargetRef.current = null;
      setView("slides");
      return;
    }
    // Capture this before React commits the view change. The animation-frame
    // effect must use the selected slide even if position state commits later.
    scrollTargetRef.current = currentPositionRef.current - 1;
    setView("scroll");
  };

  const openSlide = (index: number) => {
    pendingSlideRef.current = index;
    deckRef.current?.slide(index);
    setPosition((current) => ({
      current: index + 1,
      total: current.total,
      atStart: index === 0,
      atEnd: index === current.total - 1,
    }));
    setView("slides");
  };

  const getStaticSlides = useCallback(
    () =>
      Array.from(
        staticViewRef.current?.querySelectorAll<HTMLElement>(
          ":scope > .slides > section",
        ) ?? [],
      ),
    [],
  );

  const scrollToStaticSlide = useCallback(
    (index: number, behavior: ScrollBehavior) => {
      const slide = getStaticSlides()[index];
      const stage = stageRef.current;
      if (!slide || !stage) return;
      if (typeof stage.scrollTo === "function") {
        stage.scrollTo({ top: slide.offsetTop, behavior });
      } else {
        stage.scrollTop = slide.offsetTop;
      }
    },
    [getStaticSlides],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (view === "slides") {
        const deck = deckRef.current;
        if (!deck) return;
        const pendingSlide = pendingSlideRef.current;
        if (pendingSlide !== null) {
          pendingSlideRef.current = null;
          deck.slide(pendingSlide);
        }
        deck.layout();
        updatePosition(deck);
      } else if (view === "scroll") {
        scrollToStaticSlide(
          scrollTargetRef.current ?? currentPositionRef.current - 1,
          "instant",
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollToStaticSlide, updatePosition, view]);

  const navigate = (direction: -1 | 1) => {
    if (view === "slides") {
      direction === -1 ? deckRef.current?.prev() : deckRef.current?.next();
      return;
    }

    const target = Math.max(
      0,
      Math.min(position.current - 1 + direction, position.total - 1),
    );
    if (view === "overview") {
      openSlide(target);
      return;
    }
    scrollTargetRef.current = target;
    scrollToStaticSlide(target, reducedMotion ? "instant" : "smooth");
    currentPositionRef.current = target + 1;
    setPosition((current) => ({
      current: target + 1,
      total: current.total,
      atStart: target === 0,
      atEnd: target === current.total - 1,
    }));
  };

  const handleStaticScroll = () => {
    if (view !== "scroll" || !stageRef.current) return;
    const stageTop = stageRef.current.getBoundingClientRect().top;
    const slides = getStaticSlides();
    const closest = slides.reduce(
      (best, slide, index) => {
        const distance = Math.abs(slide.getBoundingClientRect().top - stageTop);
        return distance < best.distance ? { distance, index } : best;
      },
      { distance: Number.POSITIVE_INFINITY, index: 0 },
    );
    const scrollTarget = scrollTargetRef.current;
    if (scrollTarget !== null && closest.index !== scrollTarget) return;
    scrollTargetRef.current = null;
    currentPositionRef.current = closest.index + 1;
    setPosition((current) => ({
      current: closest.index + 1,
      total: current.total,
      atStart: closest.index === 0,
      atEnd: closest.index === current.total - 1,
    }));
  };

  const openSpeakerView = () => {
    if (resolvedPresentationHref) {
      if (speakerWindowRef.current && !speakerWindowRef.current.closed) {
        speakerWindowRef.current.focus();
        sendSpeakerState();
        return;
      }
      speakerWindowRef.current = window.open(
        `${resolvedPresentationHref}/presenter#/${position.current}`,
        "pitch-deck-presenter",
        "width=1100,height=700",
      );
      return;
    }
    const notes = deckRef.current?.getPlugin("notes") as
      | { open?: () => void }
      | undefined;
    notes?.open?.();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === shellRef.current) {
        await document.exitFullscreen();
      } else {
        await shellRef.current?.requestFullscreen();
      }
    } catch {
      fullscreenButtonRef.current?.focus();
    }
  };

  const hasPresenterTools =
    !isSpeakerPreview && (mode === "focused" || showPresenterTools);
  const projectClassName = projectSlug
    ? ` pitch-deck--project-${projectSlug}`
    : "";

  return (
    <section
      ref={shellRef}
      className={`pitch-deck pitch-deck--${mode}${projectClassName}`}
      aria-label={`${title} presentation`}
    >
      <PresenterTopbar
        backHref={resolvedBackHref}
        backLabel={resolvedBackLabel}
        fullscreenButtonRef={fullscreenButtonRef}
        isFullscreen={isFullscreen}
        mode={mode}
        narrowLayout={narrowLayout}
        onFullscreen={() => void toggleFullscreen()}
        onOverview={toggleOverview}
        onScrollView={toggleScrollView}
        onSpeakerView={openSpeakerView}
        presentationHref={resolvedPresentationHref}
        show={hasPresenterTools}
        showSpeakerView={showSpeakerView}
        title={title}
        view={view}
      />

      <div
        ref={stageRef}
        className={`pitch-deck__stage pitch-deck__stage--${view}`}
        onScroll={handleStaticScroll}
      >
        <div className="pitch-deck__live" hidden={view !== "slides"}>
          <Deck
            deckRef={deckRef}
            config={config}
            plugins={plugins}
            className="project-pitch-reveal"
            onReady={handleReady}
            onSlideChange={handlePositionEvent}
            onSync={handlePositionEvent}
          >
            {children}
          </Deck>
        </div>
        {view !== "slides" && (
          <section
            ref={staticViewRef}
            className={`reveal pitch-deck__static pitch-deck__static--${view}`}
            aria-label={
              view === "overview" ? "Slide overview" : "Scrollable slides"
            }
          >
            <div className="slides">{children}</div>
            {view === "overview" && (
              <div className="pitch-deck__overview-targets">
                {Array.from({ length: position.total }, (_, index) => (
                  <button
                    key={`slide-${index + 1}`}
                    type="button"
                    aria-label={`Open slide ${index + 1}`}
                    onClick={() => openSlide(index)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <PresentationControls
        isSpeakerPreview={isSpeakerPreview}
        mode={mode}
        onNavigate={navigate}
        position={position}
        presentationHref={resolvedPresentationHref}
        projectSlug={projectSlug}
      />
    </section>
  );
}
