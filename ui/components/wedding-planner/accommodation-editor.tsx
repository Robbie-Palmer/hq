"use client";

import {
  ArrowRight,
  BedDouble,
  Check,
  ChevronRight,
  Heart,
  House,
  Search,
  Sparkles,
  Users,
  Waypoints,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/generic/styles";
import { browserPlannerSource } from "@/lib/wedding-planner/browser-source";
import { weddingAccommodationSetup } from "@/lib/wedding-planner/setup";
import {
  pairDecision as getPairDecision,
  markNotCouple as markNotCoupleInState,
  setOwnBed as setOwnBedInState,
  setPairDecision as setPairDecisionInState,
  setPartner as setPartnerInState,
  setShareMode as setShareModeInState,
} from "@/lib/wedding-planner/sharing";
import type { PlannerSource } from "@/lib/wedding-planner/source";
import { parseState, pounds } from "@/lib/wedding-planner/state";
import type {
  Allocation,
  BedGroup,
  Guest,
  PairDecision,
  PartyName,
  SharingLevel,
  State,
} from "@/lib/wedding-planner/types";
import { DataControls } from "./data-controls";
import { ResultPlan } from "./result-plan";
import {
  bookingDiscountPercent,
  includedPackageFigure,
  includedRoomRateGroups,
  includedRoomRateTotal,
  propertyNames,
  propertyPrice,
  roomName,
  venueRooms,
} from "./room-data";

const initialFilter = "all";

async function persistPlan(
  source: PlannerSource,
  state: State,
  version: number,
  currentVersion: () => number,
  onSaved: () => void,
  onFailure: (message: string) => void,
): Promise<void> {
  try {
    await source.save(state);
    if (currentVersion() === version) onSaved();
  } catch (cause) {
    if (currentVersion() === version)
      onFailure(
        cause instanceof Error ? cause.message : "Could not save changes",
      );
  }
}

function Select({
  value,
  onChange,
  children,
  disabled,
  label,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
}>) {
  return (
    <select
      aria-label={label}
      className="editor-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

function Field({
  label,
  hint,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="editor-field">
      <span className="editor-label">{label}</span>
      {hint && <span className="editor-hint">{hint}</span>}
      {children}
    </div>
  );
}

function PaymentChoice({
  propertyId,
  value,
  onChange,
  hint,
}: Readonly<{
  propertyId: keyof State["payment_modes"];
  value: "couple" | "guests";
  onChange: (value: "couple" | "guests") => void;
  hint?: string;
}>) {
  return (
    <Field label="Who pays?" hint={hint}>
      <Select
        label={`${propertyNames[propertyId]} payment`}
        value={value}
        onChange={(choice) => onChange(choice as "couple" | "guests")}
      >
        <option value="guests">Guests pay</option>
        <option value="couple">We cover it</option>
      </Select>
    </Field>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  description,
}: Readonly<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description?: string;
}>) {
  return (
    <label className="editor-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}

const plannerSections = [
  { id: "bed_groups", label: "Bed groups", icon: BedDouble },
  { id: "guests", label: "Guests", icon: Users },
  { id: "sharing", label: "Sharing map", icon: Waypoints },
  { id: "plan", label: "Rooms & costs", icon: House },
  { id: "result", label: "Room plan", icon: Sparkles },
] as const;

type EditorView = (typeof plannerSections)[number]["id"];

function PlannerNavigation({
  view,
  onViewChange,
  pendingPairCount,
  guestCount,
}: Readonly<{
  view: EditorView;
  onViewChange: (view: EditorView) => void;
  pendingPairCount: number;
  guestCount: number;
}>) {
  const counts: Partial<Record<EditorView, number>> = {
    bed_groups: pendingPairCount,
    guests: guestCount,
  };
  return (
    <nav className="editor-nav" aria-label="Planner sections">
      {plannerSections.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={view === id ? "active" : ""}
          onClick={() => onViewChange(id)}
        >
          <Icon size={18} /> {label}
          {counts[id] !== undefined && <span>{counts[id] || ""}</span>}
        </button>
      ))}
    </nav>
  );
}

function selectedGuestConnections(selected: Guest | null, guests: Guest[]) {
  const partner = selected?.fixed_bed_group_id
    ? guests.find(
        (guest) =>
          guest.id !== selected.id &&
          guest.fixed_bed_group_id === selected.fixed_bed_group_id,
      )
    : null;
  const companions = selected?.source_party
    ? guests.filter(
        (guest) =>
          guest.id !== selected.id &&
          guest.source_party === selected.source_party,
      )
    : [];
  return { partner, companions };
}

function canFocusGroup(
  group: BedGroup,
  guests: Guest[],
  sharingLevel: SharingLevel,
  isLinenGuest: (id: string) => boolean,
): boolean {
  if (
    !group.guestIds.some(
      (id) => guests.find((guest) => guest.id === id)?.overnight !== "no",
    )
  )
    return false;
  if (sharingLevel === "bed") return group.guestIds.length === 1;
  if (sharingLevel === "room") return !group.guestIds.some(isLinenGuest);
  return true;
}

function bedGroupKind(group: BedGroup, guests: Guest[]): string {
  if (group.guestIds.length === 2) return "Couple";
  if (guests.find((guest) => guest.id === group.guestIds[0])?.requires_own_bed)
    return "Own double bed";
  return "Unpaired guest";
}

function pairingCardTitle(guest: Guest | null): string {
  if (!guest) return "All guests paired";
  return guest.requires_own_bed
    ? `${guest.name} has their own bed`
    : `Pair ${guest.name} with…`;
}

const overnightLabels: Record<Guest["overnight"], string> = {
  yes: "Staying",
  no: "Not staying",
  unknown: "Undecided",
};

function groupShareMode(
  group: BedGroup,
  guests: Guest[],
  level: SharingLevel,
): Guest["room_share_mode"] | Guest["cottage_share_mode"] | undefined {
  const guest = guests.find((member) => member.id === group.guestIds[0]);
  if (level === "room") return guest?.room_share_mode;
  if (level === "cottage") return guest?.cottage_share_mode;
  return undefined;
}

const sharingLevelLabels: Record<SharingLevel, string> = {
  bed: "BED",
  room: "SEPARATE BEDS",
  cottage: "COTTAGE",
};

function ResultView({
  state,
  busy,
  warnings,
  allocation,
  partyNames,
  report,
  onCalculate,
}: Readonly<{
  state: State | null;
  busy: boolean;
  warnings: string[];
  allocation: Allocation | null;
  partyNames: PartyName[];
  report: string;
  onCalculate: () => void;
}>) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ROOM PLAN</span>
          <h2>See where everyone lands.</h2>
          <p>
            Calculate after you update guest choices to compare assignments and
            costs.
          </p>
        </div>
        <Button onClick={onCalculate} disabled={!state || busy}>
          {busy ? "Calculating…" : "Calculate rooms"} <ArrowRight size={16} />
        </Button>
      </div>
      {warnings.length > 0 && (
        <div className="editor-warning">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      {allocation ? (
        <ResultPlan
          allocation={allocation}
          parties={partyNames}
          report={report}
        />
      ) : (
        <Card className="result-empty">
          <CardContent>
            <Sparkles size={30} />
            <h3>Your room plan will appear here</h3>
            <p>
              Answer what you can for guests, then calculate a first draft. You
              can refine it later.
            </p>
            <Button onClick={onCalculate} disabled={!state || busy}>
              Calculate first draft <ArrowRight size={16} />
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: View-specific JSX remains in one editor while navigation and results are separate components.
export function AccommodationEditor({
  source = browserPlannerSource,
}: Readonly<{
  source?: PlannerSource;
}>) {
  const [state, setState] = useState<State | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<EditorView>("bed_groups");
  const [bedSearch, setBedSearch] = useState("");
  const [partnerSearch, setPartnerSearch] = useState("");
  const [sharingLevel, setSharingLevel] = useState<SharingLevel>("room");
  const [focusSearch, setFocusSearch] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [sharingFilter, setSharingFilter] = useState<"all" | PairDecision>(
    "all",
  );
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState("Loading guest list…");
  const [error, setError] = useState("");
  const [report, setReport] = useState("");
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [partyNames, setPartyNames] = useState<PartyName[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const editVersion = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveTimer = useRef<number | null>(null);

  useEffect(() => {
    source
      .load()
      .then((data) => {
        setState(data);
        setSelectedId(data?.guests[0]?.id ?? null);
        setSaveStatus(
          data ? "Saved in this browser" : "Import a plan to begin",
        );
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, [source]);

  function update(change: (draft: State) => void) {
    setAllocation(null);
    setReport("");
    setWarnings([]);
    setState((previous) => {
      if (!previous) return previous;
      const draft = structuredClone(previous);
      change(draft);
      editVersion.current += 1;
      setSaveStatus("Saving…");
      setError("");
      return draft;
    });
  }

  useEffect(() => {
    if (!state || saveStatus !== "Saving…") return;
    const version = editVersion.current;
    const timer = window.setTimeout(() => {
      pendingSaveTimer.current = null;
      saveQueue.current = saveQueue.current.then(() =>
        persistPlan(
          source,
          state,
          version,
          () => editVersion.current,
          () => setSaveStatus("Saved in this browser"),
          (message) => {
            setSaveStatus("Save failed");
            setError(message);
          },
        ),
      );
    }, 500);
    pendingSaveTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (pendingSaveTimer.current === timer) pendingSaveTimer.current = null;
    };
  }, [state, saveStatus, source]);

  function cancelPendingSave() {
    if (pendingSaveTimer.current === null) return;
    window.clearTimeout(pendingSaveTimer.current);
    pendingSaveTimer.current = null;
  }

  async function calculate() {
    if (!state) return;
    const version = editVersion.current;
    cancelPendingSave();
    setBusy(true);
    setError("");
    setView("result");
    try {
      await saveQueue.current;
      try {
        await source.save(state);
      } catch (cause) {
        setSaveStatus("Save failed");
        throw cause;
      }
      if (editVersion.current === version)
        setSaveStatus("Saved in this browser");
      const result = await source.solve(state);
      if (editVersion.current !== version) return;
      setReport(result.report);
      setAllocation(result.result as Allocation);
      setPartyNames(result.parties as PartyName[]);
      setWarnings(
        (result.warnings as string[]).filter(
          (warning) => !warning.startsWith("0 "),
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not calculate rooms",
      );
    } finally {
      setBusy(false);
    }
  }

  async function importPlan(file: File) {
    const imported = parseState(JSON.parse(await file.text()));
    cancelPendingSave();
    await saveQueue.current;
    await source.save(imported);
    editVersion.current += 1;
    setState(imported);
    setSelectedId(imported.guests[0]?.id ?? null);
    setAllocation(null);
    setReport("");
    setWarnings([]);
    setError("");
    setSaveStatus("Saved in this browser");
    setView("bed_groups");
  }

  function exportPlan() {
    if (!state) return;
    const file = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wedding-planner-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const guests = state?.guests ?? [];
  const selected = guests.find((guest) => guest.id === selectedId) ?? null;
  const counts = useMemo(
    () => ({
      yes: guests.filter((guest) => guest.overnight === "yes").length,
      no: guests.filter((guest) => guest.overnight === "no").length,
      unknown: guests.filter((guest) => guest.overnight === "unknown").length,
    }),
    [guests],
  );
  const isFreeGuest = (guest: Guest) =>
    guest.free_stay_reasons.length > 0 ||
    (guest.fixed_bed_group_id !== "" &&
      guests.some(
        (other) =>
          other.id !== guest.id &&
          other.fixed_bed_group_id === guest.fixed_bed_group_id &&
          other.free_stay_reasons.length > 0 &&
          other.include_partner_in_free_stay,
      ));
  const filtered = guests.filter(
    (guest) =>
      (filter === "all" ||
        (filter === "free"
          ? isFreeGuest(guest)
          : guest.overnight === filter)) &&
      `${guest.name} ${guest.source_party} ${guest.tags}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const isLinenGuest = (id: string) =>
    Boolean(
      state &&
        weddingAccommodationSetup.reservation?.guestIds(state).includes(id),
    );
  const bedGroups = useMemo(() => {
    const groups = new Map<string, BedGroup>();
    for (const guest of guests) {
      const groupId = guest.fixed_bed_group_id || guest.id;
      const group = groups.get(groupId) ?? {
        id: groupId,
        name: "",
        guestIds: [],
      };
      group.guestIds.push(guest.id);
      group.name = group.guestIds
        .map((id) => guests.find((member) => member.id === id)?.name ?? id)
        .join(" & ");
      groups.set(groupId, group);
    }
    return [...groups.values()];
  }, [guests]);
  const invitationPairs = useMemo(() => {
    const invitations = new Map<string, Guest[]>();
    for (const guest of guests) {
      if (!guest.source_party) continue;
      invitations.set(guest.source_party, [
        ...(invitations.get(guest.source_party) ?? []),
        guest,
      ]);
    }
    return [...invitations.values()].flatMap((members) => {
      if (members.length !== 2) return [];
      const [first, second] = members;
      return first && second ? [[first, second] as const] : [];
    });
  }, [guests]);
  const nonCouplePairs = state?.reviewed_non_couples ?? [];
  const pairIsNotCouple = (firstId: string, secondId: string) =>
    nonCouplePairs.some(
      (pair) => pair.includes(firstId) && pair.includes(secondId),
    );
  const pendingInvitationPairs = invitationPairs.filter(
    ([first, second]) =>
      !first.fixed_bed_group_id &&
      !second.fixed_bed_group_id &&
      !pairIsNotCouple(first.id, second.id),
  );
  const unpairedGuests = guests.filter((guest) => !guest.fixed_bed_group_id);
  const selectedUnpaired =
    unpairedGuests.find((guest) => guest.id === selectedId) ??
    unpairedGuests.find((guest) => !isLinenGuest(guest.id)) ??
    null;
  const availablePartners = unpairedGuests.filter(
    (guest) =>
      guest.id !== selectedUnpaired?.id &&
      !guest.requires_own_bed &&
      !isLinenGuest(guest.id) &&
      guest.name.toLowerCase().includes(partnerSearch.toLowerCase()),
  );
  const selectedGroupId = selected?.fixed_bed_group_id || selected?.id;

  function changeGuest(id: string, change: (guest: Guest) => void) {
    update((draft) => {
      const guest = draft.guests.find((item) => item.id === id);
      if (guest) change(guest);
    });
  }
  const setShareMode = (
    id: string,
    level: "room" | "cottage",
    mode: "none" | "selected" | "any",
  ) => update((draft) => setShareModeInState(draft, id, level, mode));
  const setPairDecision = (
    level: SharingLevel,
    sourceId: string,
    targetId: string,
    decision: PairDecision,
  ) =>
    update((draft) =>
      setPairDecisionInState(draft, level, sourceId, targetId, decision),
    );
  const setOwnBed = (id: string, requiresOwnBed: boolean) =>
    update((draft) => setOwnBedInState(draft, id, requiresOwnBed));
  const setPartner = (id: string, partnerId: string) =>
    update((draft) => setPartnerInState(draft, id, partnerId));
  const markNotCouple = (
    firstId: string,
    secondId: string,
    notCouple: boolean,
  ) =>
    update((draft) =>
      markNotCoupleInState(draft, firstId, secondId, notCouple),
    );
  const { partner, companions } = selectedGuestConnections(selected, guests);
  const focusChoices = bedGroups.filter((group) =>
    canFocusGroup(group, guests, sharingLevel, isLinenGuest),
  );
  const focusGroup =
    focusChoices.find((group) => group.id === selectedGroupId) ??
    focusChoices[0];
  const focusRequiresOwnBed =
    sharingLevel === "bed" &&
    (guests.find((guest) => guest.id === focusGroup?.guestIds[0])
      ?.requires_own_bed ??
      false);
  const allMatches = focusChoices.filter(
    (group) =>
      group.id !== focusGroup?.id &&
      !focusRequiresOwnBed &&
      (sharingLevel !== "bed" ||
        !guests.find((guest) => guest.id === group.guestIds[0])
          ?.requires_own_bed),
  );
  const pairDecision = (target: BedGroup) =>
    getPairDecision(state, focusGroup, target, sharingLevel);
  const decisionCounts = {
    yes: allMatches.filter((group) => pairDecision(group) === "yes").length,
    no: allMatches.filter((group) => pairDecision(group) === "no").length,
    unset: allMatches.filter((group) => pairDecision(group) === "unset").length,
  };
  const visibleMatches = allMatches.filter(
    (group) =>
      group.name.toLowerCase().includes(matchSearch.toLowerCase()) &&
      (sharingFilter === "all" || pairDecision(group) === sharingFilter),
  );

  return (
    <div className="editor-app">
      <header className="editor-header">
        <div className="editor-brand">
          <span className="brand-mark">
            <Heart size={18} fill="currentColor" />
          </span>
          <span>
            Wedding planner <small>Accommodation</small>
          </span>
        </div>
        <span className="save-status">
          <Check size={15} /> {saveStatus}
        </span>
      </header>
      <div className="editor-shell">
        <aside className="editor-sidebar">
          <div className="sidebar-intro">
            <Badge variant="secondary">ONE NIGHT · PRIVATE</Badge>
            <h1>
              Find everyone
              <br />
              <em>a place to stay.</em>
            </h1>
            <p>
              Pair bed partners, answer overnight questions, then see who fits
              where and what they pay.
            </p>
          </div>
          <PlannerNavigation
            view={view}
            onViewChange={setView}
            pendingPairCount={pendingInvitationPairs.length}
            guestCount={guests.length}
          />
          {state && (
            <DataControls hasData onImport={importPlan} onExport={exportPlan} />
          )}
          <div className="sidebar-note">
            <BedDouble size={19} />
            <p>
              <strong>Bridal suite reserved</strong>
              <br />
              For you and your fiancé. You do not need to add yourselves to the
              guest list.
            </p>
          </div>
        </aside>
        <main className="editor-main">
          {!loading && !state && (
            <Card className="editor-start-card">
              <CardHeader>
                <CardTitle>Bring in your room plan</CardTitle>
                <CardDescription>
                  Import your existing accommodation-state.json. The guest list
                  and choices stay in this browser. Export a backup before
                  switching devices or clearing browser data.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DataControls
                  hasData={false}
                  onImport={importPlan}
                  onExport={exportPlan}
                />
              </CardContent>
            </Card>
          )}
          {error && (
            <div role="alert" className="editor-error">
              {error}
            </div>
          )}
          {view === "bed_groups" && state && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">START HERE</span>
                  <h2>Who shares a bed?</h2>
                  <p>
                    Confirm couples first. Each couple then appears as one bed
                    group when you choose who can share a bedroom or cottage.
                  </p>
                </div>
                <Button onClick={() => setView("sharing")}>
                  Sharing map <ArrowRight size={16} />
                </Button>
              </div>
              <div className="progress-strip bed-progress-strip">
                <span>
                  <strong>
                    {
                      bedGroups.filter((group) => group.guestIds.length === 2)
                        .length
                    }
                  </strong>{" "}
                  couples
                </span>
                <span>
                  <strong>{unpairedGuests.length}</strong> currently unpaired
                </span>
                <span>
                  <strong>{pendingInvitationPairs.length}</strong> suggestions
                  to review
                </span>
                <span>
                  <strong>
                    {
                      guests.filter(
                        (guest) =>
                          guest.requires_own_bed && guest.overnight !== "no",
                      ).length
                    }
                  </strong>{" "}
                  own beds
                </span>
              </div>
              <Card className="bed-review-card">
                <CardHeader>
                  <CardTitle>Suggested from the invitation list</CardTitle>
                  <CardDescription>
                    Guests on one invitation might share a bed. Confirm fixed
                    partners or mark that they are not a couple. Singles can
                    still choose flexible bed sharing in the Sharing map.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {pendingInvitationPairs.length ? (
                    <div className="bed-suggestion-list bed-suggestions-scroll">
                      {pendingInvitationPairs.map(([first, second]) => (
                        <div
                          className="bed-suggestion"
                          key={first.source_party}
                        >
                          <strong>
                            {first.name} &amp; {second.name}
                          </strong>
                          <div className="bed-suggestion-actions">
                            <Button
                              size="sm"
                              disabled={
                                first.requires_own_bed ||
                                second.requires_own_bed
                              }
                              onClick={() => setPartner(first.id, second.id)}
                            >
                              Share one bed
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                markNotCouple(first.id, second.id, true)
                              }
                            >
                              Not a couple
                            </Button>
                          </div>
                          {(first.requires_own_bed ||
                            second.requires_own_bed) && (
                            <small>
                              Change the own-bed choice to pair them.
                            </small>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="bed-empty">
                      All two-person invitations have been reviewed.
                    </p>
                  )}
                </CardContent>
              </Card>
              <div className="bed-setup-grid">
                <Card>
                  <CardHeader>
                    <CardTitle>Pair anyone else</CardTitle>
                    <CardDescription>
                      Select a guest, then find the person they share a double
                      bed with.
                    </CardDescription>
                    <div className="search-wrap">
                      <Search size={16} />
                      <Input
                        aria-label="Find a guest to pair"
                        placeholder="Find a guest"
                        value={bedSearch}
                        onChange={(event) => setBedSearch(event.target.value)}
                      />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="bed-person-list">
                      {unpairedGuests
                        .filter((guest) =>
                          guest.name
                            .toLowerCase()
                            .includes(bedSearch.toLowerCase()),
                        )
                        .map((guest) => (
                          <button
                            type="button"
                            key={guest.id}
                            className={cn(
                              "bed-person",
                              selectedUnpaired?.id === guest.id && "selected",
                            )}
                            onClick={() => {
                              setSelectedId(guest.id);
                              setPartnerSearch("");
                            }}
                          >
                            <span>
                              {guest.name}
                              {guest.requires_own_bed && (
                                <small>Own double bed</small>
                              )}
                            </span>
                            <ChevronRight size={15} />
                          </button>
                        ))}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{pairingCardTitle(selectedUnpaired)}</CardTitle>
                    <CardDescription>
                      These are unpaired guests. Sharing a bed here makes a
                      fixed couple. Flexible singles belong in the Sharing map.
                    </CardDescription>
                    {!selectedUnpaired?.requires_own_bed && (
                      <div className="search-wrap">
                        <Search size={16} />
                        <Input
                          aria-label="Find a bed partner"
                          placeholder="Find their partner"
                          value={partnerSearch}
                          onChange={(event) =>
                            setPartnerSearch(event.target.value)
                          }
                        />
                      </div>
                    )}
                  </CardHeader>
                  <CardContent>
                    {selectedUnpaired?.overnight === "no" && (
                      <p className="editor-hint">
                        No bed preference is needed while this guest is not
                        staying.
                      </p>
                    )}
                    {selectedUnpaired &&
                      selectedUnpaired.overnight !== "no" && (
                        <Toggle
                          title="Needs their own double bed"
                          description="They can still share a bedroom or cottage if they have a separate double bed."
                          checked={selectedUnpaired.requires_own_bed}
                          onChange={(value) =>
                            setOwnBed(selectedUnpaired.id, value)
                          }
                        />
                      )}
                    {!selectedUnpaired?.requires_own_bed && (
                      <div className="bed-person-list">
                        {selectedUnpaired &&
                          availablePartners.map((guest) => (
                            <button
                              type="button"
                              key={guest.id}
                              className="bed-person"
                              onClick={() => {
                                setPartner(selectedUnpaired.id, guest.id);
                                setPartnerSearch("");
                              }}
                            >
                              <span>
                                {guest.name}
                                {guest.source_party ===
                                  selectedUnpaired.source_party && (
                                  <small>Same invitation</small>
                                )}
                              </span>
                              <span>
                                Pair <ArrowRight size={14} />
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
              <Card className="bed-review-card">
                <CardHeader>
                  <CardTitle>Reviewed bed groups</CardTitle>
                  <CardDescription>
                    Change a decision here if you need to.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="bed-suggestion-list">
                    {bedGroups
                      .filter((group) => group.guestIds.length === 2)
                      .map((group) => (
                        <div className="bed-suggestion" key={group.id}>
                          <strong>{group.name}</strong>
                          {group.guestIds.some((id) => isLinenGuest(id)) ? (
                            <Badge variant="secondary">Linen booking</Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setPartner(group.guestIds[0] ?? "", "")
                              }
                            >
                              Remove pairing
                            </Button>
                          )}
                        </div>
                      ))}
                    {nonCouplePairs.map(([firstId, secondId]) => (
                      <div
                        className="bed-suggestion"
                        key={`${firstId}-${secondId}`}
                      >
                        <span>
                          {guests.find((guest) => guest.id === firstId)?.name}{" "}
                          &amp;{" "}
                          {guests.find((guest) => guest.id === secondId)?.name}{" "}
                          · Not a couple
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            markNotCouple(firstId ?? "", secondId ?? "", false)
                          }
                        >
                          Review again
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
          {view === "guests" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">GUEST LIST</span>
                  <h2>Who needs a room?</h2>
                  <p>
                    Answer overnight questions and set accommodation priorities.
                    Fixed bed partners are in Bed groups.
                  </p>
                </div>
                <Button onClick={calculate} disabled={!state || busy}>
                  Calculate rooms <ArrowRight size={16} />
                </Button>
              </div>
              <div className="progress-strip">
                <span>
                  <strong>{counts.yes}</strong> staying
                </span>
                <span>
                  <strong>{counts.no}</strong> not staying
                </span>
                <span>
                  <strong>{counts.unknown}</strong> undecided
                </span>
              </div>
              <div className="guest-layout">
                <Card className="guest-list-card">
                  <CardHeader className="pb-3">
                    <CardTitle>Guests</CardTitle>
                    <CardDescription>
                      Choose someone to edit their stay.
                    </CardDescription>
                    <div className="search-wrap">
                      <Search size={16} />
                      <Input
                        aria-label="Search guests"
                        placeholder="Search guests"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </div>
                    <Select
                      label="Filter guests"
                      value={filter}
                      onChange={setFilter}
                    >
                      <option value="all">All guests</option>
                      <option value="unknown">Undecided</option>
                      <option value="yes">Staying</option>
                      <option value="no">Not staying</option>
                      <option value="free">Free accommodation</option>
                    </Select>
                  </CardHeader>
                  <CardContent className="guest-list">
                    {filtered.map((guest) => (
                      <button
                        type="button"
                        key={guest.id}
                        className={`guest-row ${selectedId === guest.id ? "selected" : ""}`}
                        onClick={() => setSelectedId(guest.id)}
                      >
                        <span className="guest-avatar">
                          {guest.name.charAt(0)}
                        </span>
                        <span className="guest-row-name">
                          <strong>{guest.name}</strong>
                          <small>
                            {overnightLabels[guest.overnight]}
                            {isFreeGuest(guest) && " · We cover"}
                          </small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                    {!filtered.length && (
                      <p className="empty-list">No guests match this search.</p>
                    )}
                  </CardContent>
                </Card>
                {selected && (
                  <div className="guest-detail">
                    <Card>
                      <CardHeader>
                        <div className="detail-heading">
                          <div>
                            <Badge variant="outline">
                              {isLinenGuest(selected.id)
                                ? "LINEN COTTAGE · BOOKED"
                                : "GUEST"}
                            </Badge>
                            <CardTitle className="detail-title">
                              {selected.name}
                            </CardTitle>
                            <CardDescription>
                              {companions.length
                                ? `Invited with ${companions.map((guest) => guest.name).join(", ")}`
                                : selected.tags ||
                                  "Set their stay and preferences below"}
                            </CardDescription>
                          </div>
                          <div className="detail-initial">
                            {selected.name.charAt(0)}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="detail-content">
                        <div className="section-title">
                          <span className="step-number">01</span>
                          <div>
                            <h3>Staying the night?</h3>
                            <p>Only Yes adds them to the current room plan.</p>
                          </div>
                        </div>
                        <div className="choice-row">
                          {(
                            [
                              ["yes", "Yes"],
                              ["no", "No"],
                              ["unknown", "Undecided"],
                            ] as const
                          ).map(([value, label]) => (
                            <Button
                              key={value}
                              size="sm"
                              variant={
                                selected.overnight === value
                                  ? "default"
                                  : "outline"
                              }
                              disabled={isLinenGuest(selected.id)}
                              onClick={() =>
                                changeGuest(selected.id, (guest) => {
                                  guest.overnight = value;
                                  if (value !== "yes")
                                    guest.safe_for_our_booking = false;
                                })
                              }
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                        {selected.overnight === "yes" &&
                          !isLinenGuest(selected.id) && (
                            <div className="booking-confidence">
                              <Toggle
                                title="Very confident they'll stay"
                                description="A planning note about how certain their stay is. It does not restrict their room choices."
                                checked={selected.safe_for_our_booking}
                                onChange={(value) =>
                                  changeGuest(selected.id, (guest) => {
                                    guest.safe_for_our_booking = value;
                                  })
                                }
                              />
                            </div>
                          )}
                        <div className="free-stay-panel">
                          <h3>Free accommodation</h3>
                          <p className="editor-hint">
                            We cover this person's share in a cottage or an
                            outside stay. Their fixed bed partner is included by
                            default.
                          </p>
                          {isFreeGuest(selected) &&
                            selected.free_stay_reasons.length === 0 &&
                            partner && (
                              <p className="editor-hint">
                                Covered as {partner.name}'s bed partner.
                              </p>
                            )}
                          <div className="toggle-grid">
                            {(
                              [
                                ["immediate_family", "Immediate family"],
                                ["wedding_party", "Wedding party"],
                                ["other", "Other guest we cover"],
                              ] as const
                            ).map(([reason, label]) => (
                              <Toggle
                                key={reason}
                                title={label}
                                checked={selected.free_stay_reasons.includes(
                                  reason,
                                )}
                                onChange={(checked) =>
                                  changeGuest(selected.id, (guest) => {
                                    guest.free_stay_reasons = checked
                                      ? [...guest.free_stay_reasons, reason]
                                      : guest.free_stay_reasons.filter(
                                          (item) => item !== reason,
                                        );
                                  })
                                }
                              />
                            ))}
                          </div>
                          {partner && selected.free_stay_reasons.length > 0 && (
                            <Toggle
                              title={`Include ${partner.name} for free`}
                              description="Turn this off if their partner should pay their own share."
                              checked={selected.include_partner_in_free_stay}
                              onChange={(checked) =>
                                changeGuest(selected.id, (guest) => {
                                  guest.include_partner_in_free_stay = checked;
                                })
                              }
                            />
                          )}
                        </div>
                        <div className="editor-divider" />
                        <div className="section-title">
                          <span className="step-number">02</span>
                          <div>
                            <h3>Bed & sharing</h3>
                            <p>
                              Fixed bed partners are set in Bed groups. Flexible
                              singles can choose matches in the Sharing map.
                            </p>
                          </div>
                        </div>
                        <div className="field-grid">
                          <Field label="Fixed bed partner">
                            <div className="bed-partner-summary">
                              <span>{partner?.name ?? "No fixed partner"}</span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setView("bed_groups")}
                              >
                                Edit
                              </Button>
                            </div>
                          </Field>
                          <Field
                            label="Priority"
                            hint="Who gets a Riverside suite first, then a cottage?"
                          >
                            <Select
                              label="Accommodation priority"
                              value={String(selected.priority)}
                              onChange={(value) =>
                                changeGuest(selected.id, (guest) => {
                                  guest.priority = Number(value);
                                })
                              }
                            >
                              <option value="1">1 · Flexible</option>
                              <option value="2">2 · Lower</option>
                              <option value="3">3 · Normal</option>
                              <option value="4">4 · High</option>
                              <option value="5">5 · Highest</option>
                            </Select>
                          </Field>
                        </div>
                        {!partner && selected.overnight !== "no" && (
                          <div className="own-bed-control">
                            <Toggle
                              title="Needs their own double bed"
                              description="They can still share a bedroom or cottage if they have a separate double bed."
                              checked={selected.requires_own_bed}
                              onChange={(value) =>
                                setOwnBed(selected.id, value)
                              }
                            />
                          </div>
                        )}
                        <div className="toggle-grid">
                          <Field
                            label="Bedroom sharing"
                            hint="Another bed group uses a separate bed in a family suite or Black Sheep room 3."
                          >
                            <Select
                              label="Bedroom sharing rule"
                              value={selected.room_share_mode}
                              onChange={(value) =>
                                setShareMode(
                                  selected.id,
                                  "room",
                                  value as Guest["room_share_mode"],
                                )
                              }
                            >
                              <option value="none">No one else</option>
                              <option value="selected">
                                Only selected bed groups
                              </option>
                              <option value="any">
                                Any compatible bed group
                              </option>
                            </Select>
                          </Field>
                          <Field
                            label="Cottage sharing"
                            hint="Other bed groups use separate bedrooms."
                          >
                            <Select
                              label="Cottage sharing rule"
                              value={selected.cottage_share_mode}
                              onChange={(value) =>
                                setShareMode(
                                  selected.id,
                                  "cottage",
                                  value as Guest["cottage_share_mode"],
                                )
                              }
                            >
                              <option value="none">No one else</option>
                              <option value="selected">
                                Only selected bed groups
                              </option>
                              <option value="any">
                                Any compatible bed group
                              </option>
                            </Select>
                          </Field>
                        </div>
                        <div className="sharing-invite">
                          <Waypoints size={19} />
                          <div>
                            <strong>Who can stay together?</strong>
                            <span>
                              Mark yes, no, or undecided for each pair in the
                              sharing map.
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setView("sharing")}
                          >
                            Open map <ArrowRight size={14} />
                          </Button>
                        </div>
                        <div className="editor-divider" />
                        <div className="section-title">
                          <span className="step-number">03</span>
                          <div>
                            <h3>Preferences & boundaries</h3>
                            <p>
                              A building preference helps choose among suitable
                              rooms.
                            </p>
                          </div>
                        </div>
                        <div className="field-grid building-field">
                          <Field label="Preferred building">
                            <Select
                              label="Preferred building"
                              value={selected.preferred_property_ids[0] ?? ""}
                              onChange={(value) =>
                                changeGuest(selected.id, (guest) => {
                                  guest.preferred_property_ids = value
                                    ? [value]
                                    : [];
                                })
                              }
                            >
                              <option value="">No preference</option>
                              {Object.entries(propertyNames).map(
                                ([id, name]) => (
                                  <option key={id} value={id}>
                                    {name}
                                  </option>
                                ),
                              )}
                            </Select>
                          </Field>
                        </div>
                        <details className="relation">
                          <summary>
                            <span>
                              <strong>Cost details for this guest</strong>
                              <small>
                                Optional outside price and guest charge cap
                              </small>
                            </span>
                            <ChevronRight size={17} />
                          </summary>
                          <div className="relation-body">
                            <Field
                              label="Outside accommodation estimate"
                              hint="For a fixed bed pair, enter this on just one person."
                            >
                              <Input
                                aria-label="Outside accommodation estimate"
                                type="number"
                                min="0"
                                inputMode="decimal"
                                placeholder="Optional £"
                                value={selected.outside_cost_gbp ?? ""}
                                onChange={(event) =>
                                  changeGuest(selected.id, (guest) => {
                                    guest.outside_cost_gbp = event.target.value;
                                  })
                                }
                              />
                            </Field>
                            <div className="cost-detail-toggle">
                              <Toggle
                                title="Pay full share even if a cap is set"
                                checked={selected.charge_cap_exempt}
                                onChange={(value) =>
                                  changeGuest(selected.id, (guest) => {
                                    guest.charge_cap_exempt = value;
                                  })
                                }
                              />
                            </div>
                          </div>
                        </details>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            </>
          )}
          {view === "sharing" && state && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">SHARING MAP</span>
                  <h2>Who fits together?</h2>
                  <p>
                    Pick a person or couple, then mark each possible match.
                    Every pair is independent, so circles can overlap.
                  </p>
                </div>
              </div>
              {pendingInvitationPairs.length > 0 && (
                <div className="sharing-invite">
                  <BedDouble size={19} />
                  <div>
                    <strong>
                      {pendingInvitationPairs.length} invitation pairs still
                      need bed review
                    </strong>
                    <span>
                      Confirm couples before using bedroom and cottage matches.
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setView("bed_groups")}
                  >
                    Review bed groups
                  </Button>
                </div>
              )}
              <fieldset className="sharing-levels" aria-label="Sharing level">
                {(
                  [
                    ["bed", "One double bed"],
                    ["room", "Separate beds, one room"],
                    ["cottage", "Cottage"],
                  ] as const
                ).map(([level, label]) => (
                  <Button
                    key={level}
                    variant={sharingLevel === level ? "default" : "outline"}
                    onClick={() => {
                      setSharingLevel(level);
                      setSharingFilter("all");
                      setMatchSearch("");
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </fieldset>
              <div className="sharing-explainer">
                {sharingLevel === "bed" &&
                  "Guests marked No to staying are left out. For everyone else without a fixed bed partner, Yes means two people could share a double bed without becoming a fixed pair."}
                {sharingLevel === "room" &&
                  "Each row is one fixed pair or one unpaired guest. Yes lets groups use separate beds in a family suite or Black Sheep room 3. Its single bed holds one guest who does not require a double. The Linen pair cannot move from their cottage."}
                {sharingLevel === "cottage" &&
                  "Each row is one fixed pair or one unpaired guest in a separate bedroom. Confirm couples in Bed groups first. A yes with the Linen pair also approves the other group for Linen’s spare room."}
              </div>
              <div className="sharing-layout">
                <Card className="sharing-focus-card">
                  <CardHeader>
                    <CardTitle>Start with</CardTitle>
                    <CardDescription>
                      Choose whose sharing circle to edit.
                    </CardDescription>
                    <Input
                      aria-label="Find a person or couple"
                      placeholder="Find a person or couple"
                      value={focusSearch}
                      onChange={(event) => setFocusSearch(event.target.value)}
                    />
                  </CardHeader>
                  <CardContent className="sharing-focus-list">
                    {focusChoices
                      .filter((group) =>
                        group.name
                          .toLowerCase()
                          .includes(focusSearch.toLowerCase()),
                      )
                      .map((group) => (
                        <button
                          type="button"
                          key={group.id}
                          className={`sharing-focus-row ${group.id === focusGroup?.id ? "selected" : ""}`}
                          onClick={() =>
                            setSelectedId(group.guestIds[0] ?? null)
                          }
                        >
                          <span className="guest-avatar">
                            {group.name.charAt(0)}
                          </span>
                          <span>
                            {group.name}
                            <small>{bedGroupKind(group, guests)}</small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                  </CardContent>
                </Card>
                <Card className="sharing-matches-card">
                  <CardHeader>
                    <Badge variant="outline">
                      {sharingLevelLabels[sharingLevel]}
                    </Badge>
                    <CardTitle className="sharing-focus-title">
                      {focusGroup?.name ?? "Choose a guest"}
                    </CardTitle>
                    <CardDescription>
                      Yes and no choices are saved for both sides of the pair.
                    </CardDescription>
                    {sharingLevel === "bed" && focusGroup && (
                      <div className="sharing-policy">
                        <Toggle
                          title="Needs their own double bed"
                          description="This guest won't share a bed with anyone else and cannot use Black Sheep's single bed. Bedroom and cottage choices stay separate."
                          checked={focusRequiresOwnBed}
                          onChange={(value) =>
                            setOwnBed(focusGroup.guestIds[0] ?? "", value)
                          }
                        />
                      </div>
                    )}
                    {sharingLevel !== "bed" && focusGroup && (
                      <div className="sharing-policy">
                        <strong>General rule</strong>
                        <div className="choice-row">
                          {(
                            [
                              ["none", "No one"],
                              ["selected", "Only yes matches"],
                              ["any", "Anyone compatible"],
                            ] as const
                          ).map(([mode, label]) => (
                            <Button
                              key={mode}
                              size="sm"
                              variant={
                                groupShareMode(
                                  focusGroup,
                                  guests,
                                  sharingLevel,
                                ) === mode
                                  ? "default"
                                  : "outline"
                              }
                              onClick={() =>
                                setShareMode(
                                  focusGroup.guestIds[0] ?? "",
                                  sharingLevel,
                                  mode,
                                )
                              }
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent>
                    {focusRequiresOwnBed ? (
                      <p className="editor-hint">
                        This guest needs their own double bed. Turn off the
                        choice above to set bed-sharing matches.
                      </p>
                    ) : (
                      <>
                        <div className="sharing-counts">
                          <button
                            type="button"
                            className={sharingFilter === "all" ? "active" : ""}
                            onClick={() => setSharingFilter("all")}
                          >
                            All {allMatches.length}
                          </button>
                          <button
                            type="button"
                            className={sharingFilter === "yes" ? "active" : ""}
                            onClick={() => setSharingFilter("yes")}
                          >
                            Yes {decisionCounts.yes}
                          </button>
                          <button
                            type="button"
                            className={sharingFilter === "no" ? "active" : ""}
                            onClick={() => setSharingFilter("no")}
                          >
                            No {decisionCounts.no}
                          </button>
                          <button
                            type="button"
                            className={
                              sharingFilter === "unset" ? "active" : ""
                            }
                            onClick={() => setSharingFilter("unset")}
                          >
                            Unset {decisionCounts.unset}
                          </button>
                        </div>
                        <Input
                          aria-label="Find a possible match"
                          placeholder="Find a possible match"
                          value={matchSearch}
                          onChange={(event) =>
                            setMatchSearch(event.target.value)
                          }
                        />
                        <p className="editor-hint sharing-help">
                          Unset means no bed match. For rooms and cottages it
                          follows the general rule above. An explicit No always
                          keeps two groups apart.
                        </p>
                        <div className="sharing-pair-list">
                          {visibleMatches.map((group) => {
                            const decision = pairDecision(group);
                            return (
                              <div key={group.id} className="sharing-pair-row">
                                <div>
                                  <strong>{group.name}</strong>
                                  <small>
                                    {group.guestIds.length === 2
                                      ? "Couple"
                                      : "Unpaired guest"}
                                  </small>
                                </div>
                                <fieldset
                                  className="sharing-decisions"
                                  aria-label={`Sharing with ${group.name}`}
                                >
                                  {(
                                    [
                                      ["yes", "Yes"],
                                      ["no", "No"],
                                      ["unset", "Unset"],
                                    ] as const
                                  ).map(([value, label]) => (
                                    <Button
                                      key={value}
                                      size="sm"
                                      variant={
                                        decision === value
                                          ? "secondary"
                                          : "ghost"
                                      }
                                      className={cn(
                                        "pair-choice",
                                        value === "yes" && "decision-yes",
                                        value === "no" && "decision-no",
                                        value === "unset" && "decision-unset",
                                        decision === value && "active",
                                      )}
                                      aria-pressed={decision === value}
                                      onClick={() =>
                                        focusGroup &&
                                        setPairDecision(
                                          sharingLevel,
                                          focusGroup.guestIds[0] ?? "",
                                          group.id,
                                          value,
                                        )
                                      }
                                    >
                                      {label}
                                    </Button>
                                  ))}
                                </fieldset>
                              </div>
                            );
                          })}
                          {!visibleMatches.length && (
                            <p className="empty-list">
                              No matches in this view.
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
          {view === "plan" && state && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">ROOMS & COSTS</span>
                  <h2>The accommodation</h2>
                  <p>
                    Rates are fixed for this one night. Choose how to handle
                    suite contributions.
                  </p>
                </div>
                <Button onClick={calculate} disabled={busy}>
                  Calculate rooms <ArrowRight size={16} />
                </Button>
              </div>
              <div className="cost-grid">
                <Card>
                  <CardHeader>
                    <CardTitle>Included venue rooms</CardTitle>
                    <CardDescription>
                      The wedding package includes these rooms. Their rates show
                      the value you could ask guests to contribute.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rate-row">
                      <span>
                        Bridal suite <small>You and your fiancé</small>
                      </span>
                      <strong>Reserved</strong>
                    </div>
                    {includedRoomRateGroups.map((group) => (
                      <div
                        className="rate-row"
                        key={`${group.label}:${group.price}`}
                      >
                        <span>
                          {group.count} {group.label}
                        </span>
                        <strong>{pounds(group.price)} each</strong>
                      </div>
                    ))}
                    <div className="rate-row">
                      <span>
                        {venueRooms.length} guest suite rates together
                      </span>
                      <strong>{includedRoomRateTotal}</strong>
                    </div>
                    {includedPackageFigure && (
                      <div className="rate-row">
                        <span>
                          Reported suite figure within your package{" "}
                          <small>Reference value, not another bill</small>
                        </span>
                        <strong>{includedPackageFigure}</strong>
                      </div>
                    )}
                    <PaymentChoice
                      propertyId="venue"
                      value={state.payment_modes.venue ?? "couple"}
                      hint="We cover it means guests pay nothing for these rooms. The rates still appear in the plan."
                      onChange={(value) =>
                        update((draft) => {
                          draft.payment_modes.venue = value;
                        })
                      }
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Optional cottages</CardTitle>
                    <CardDescription>
                      Check availability before relying on a cottage. This
                      planner does not make a booking. If guests pay, they split
                      the rent across occupied bedrooms.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(["black_sheep", "river_side"] as const).map(
                      (propertyId) => (
                        <div className="cottage-option" key={propertyId}>
                          <div className="rate-row">
                            <span>
                              {propertyNames[propertyId]}
                              <small>
                                {
                                  weddingAccommodationSetup.input.properties.find(
                                    (property) => property.id === propertyId,
                                  )?.room_summary
                                }
                              </small>
                            </span>
                            <strong>
                              {propertyPrice(propertyId, "guests")} ·{" "}
                              {propertyPrice(propertyId, "couple")} if we book
                            </strong>
                          </div>
                          <div className="cottage-choice-grid">
                            <Field label="Availability">
                              <Select
                                label={`${propertyNames[propertyId]} availability`}
                                value={
                                  state.cottage_options[propertyId]
                                    ?.availability ?? "unknown"
                                }
                                onChange={(value) =>
                                  update((draft) => {
                                    const option = draft.cottage_options[
                                      propertyId
                                    ] ?? {
                                      availability: "unknown",
                                      booking_by: "couple",
                                    };
                                    option.availability =
                                      value as State["cottage_options"][string]["availability"];
                                    draft.cottage_options[propertyId] = option;
                                  })
                                }
                              >
                                <option value="unknown">Not checked</option>
                                <option value="available">Available</option>
                                <option value="unavailable">Unavailable</option>
                              </Select>
                            </Field>
                            <Field label="Who would book?">
                              <Select
                                label={`${propertyNames[propertyId]} booking plan`}
                                value={
                                  state.cottage_options[propertyId]
                                    ?.booking_by ?? "couple"
                                }
                                onChange={(value) =>
                                  update((draft) => {
                                    const option = draft.cottage_options[
                                      propertyId
                                    ] ?? {
                                      availability: "unknown",
                                      booking_by: "couple",
                                    };
                                    option.booking_by =
                                      value as State["cottage_options"][string]["booking_by"];
                                    draft.cottage_options[propertyId] = option;
                                  })
                                }
                              >
                                <option value="guests">
                                  Guests book ·{" "}
                                  {propertyPrice(propertyId, "guests")}
                                </option>
                                <option value="couple">
                                  We would book ·{" "}
                                  {propertyPrice(propertyId, "couple")}
                                </option>
                              </Select>
                            </Field>
                            <div className="cottage-payment-choice">
                              <PaymentChoice
                                propertyId={propertyId}
                                value={
                                  state.payment_modes[propertyId] ?? "couple"
                                }
                                hint="This is separate from who makes the booking."
                                onChange={(value) =>
                                  update((draft) => {
                                    draft.payment_modes[propertyId] = value;
                                  })
                                }
                              />
                            </div>
                            <div className="cottage-payment-choice">
                              <Field
                                label="Already paid by us"
                                hint="Enter a deposit if paid. A payment on an unused cottage still appears in your total."
                              >
                                <Input
                                  aria-label={`${propertyNames[propertyId]} already paid by us`}
                                  type="number"
                                  min="0"
                                  inputMode="decimal"
                                  value={
                                    state.cottage_paid_by_us_gbp[propertyId]
                                  }
                                  onChange={(event) =>
                                    update((draft) => {
                                      draft.cottage_paid_by_us_gbp[propertyId] =
                                        event.target.value;
                                    })
                                  }
                                />
                              </Field>
                            </div>
                          </div>
                          {state.cottage_options[propertyId]?.booking_by ===
                            "couple" && (
                            <p className="editor-hint cottage-option-hint">
                              We pay the {propertyPrice(propertyId, "couple")}{" "}
                              rent to the cottage owner, then guests reimburse
                              us for their shares. Free guests' shares remain
                              ours to cover. Availability still needs checking
                              before booking.
                            </p>
                          )}
                        </div>
                      ),
                    )}
                    <div className="rate-row">
                      <span>
                        Linen Cottage{" "}
                        <small>
                          {
                            weddingAccommodationSetup.input.properties.find(
                              (property) => property.id === "linen",
                            )?.room_summary
                          }
                        </small>
                      </span>
                      <strong>
                        {propertyPrice("linen", "couple")} after discount
                      </strong>
                    </div>
                    <PaymentChoice
                      propertyId="linen"
                      value={state.payment_modes.linen ?? "couple"}
                      hint={`Already booked by us. If guests pay, the occupied bedrooms split ${propertyPrice("linen", "couple")}.`}
                      onChange={(value) =>
                        update((draft) => {
                          draft.payment_modes.linen = value;
                        })
                      }
                    />
                    <div className="cottage-deposit-field">
                      <Field
                        label="Already paid by us"
                        hint={`Deposit paid toward the ${propertyPrice("linen", "couple")} discounted rent.`}
                      >
                        <Input
                          aria-label="Linen Cottage already paid by us"
                          type="number"
                          min="0"
                          inputMode="decimal"
                          value={state.cottage_paid_by_us_gbp.linen}
                          onChange={(event) =>
                            update((draft) => {
                              draft.cottage_paid_by_us_gbp.linen =
                                event.target.value;
                            })
                          }
                        />
                      </Field>
                    </div>
                  </CardContent>
                </Card>
              </div>
              {state.payment_modes.venue === "guests" && (
                <Card className="plan-card">
                  <CardHeader>
                    <CardTitle>Suite contributions</CardTitle>
                    <CardDescription>
                      Choose how much guests pay for each included Riverside
                      suite.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="billing-grid">
                    {venueRooms.map((id) => (
                      <Field key={id} label={roomName(id)}>
                        <Select
                          label={`${roomName(id)} contribution`}
                          value={state.suite_billing_modes[id] ?? "by_bed"}
                          onChange={(value) =>
                            update((draft) => {
                              draft.suite_billing_modes[id] = value;
                            })
                          }
                        >
                          <option value="by_bed">Charge by used bed</option>
                          <option value="full_room">
                            Charge full room rate
                          </option>
                          <option value="couple">Cover from package</option>
                        </Select>
                      </Field>
                    ))}
                  </CardContent>
                </Card>
              )}
              <Card className="plan-card">
                <CardHeader>
                  <CardTitle>Linen Cottage</CardTitle>
                  <CardDescription>
                    We booked it for the existing guests at{" "}
                    {propertyPrice("linen", "couple")} after the{" "}
                    {bookingDiscountPercent("linen")}% discount. If guests pay,
                    they split that rent across the occupied bedrooms.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="editor-hint">
                    Only people marked Yes with the existing Linen pair in the
                    cottage sharing map can use the second bedroom.
                  </p>
                  <Button
                    className="linen-map-button"
                    variant="outline"
                    onClick={() => {
                      setSelectedId(
                        weddingAccommodationSetup.reservation?.guestIds(
                          state,
                        )[0] ?? null,
                      );
                      setSharingLevel("cottage");
                      setView("sharing");
                    }}
                  >
                    Open Linen sharing map <ArrowRight size={16} />
                  </Button>
                </CardContent>
              </Card>
              <Card className="plan-card">
                <CardHeader>
                  <CardTitle>Calculation choices</CardTitle>
                  <CardDescription>
                    Priority fills Riverside suites by guest rank, then
                    cottages. Lowest price compares extra costs first.
                  </CardDescription>
                </CardHeader>
                <CardContent className="field-grid">
                  <Field label="Goal">
                    <Select
                      label="Calculation goal"
                      value={state.optimization_mode}
                      onChange={(value) =>
                        update((draft) => {
                          draft.optimization_mode = value;
                        })
                      }
                    >
                      <option value="priority_first">
                        Riverside suites first, then cottages
                      </option>
                      <option value="lowest_total_price">
                        Lowest additional lodging price
                      </option>
                    </Select>
                  </Field>
                  <Field label="Outside stay estimate · per bed group">
                    <Input
                      aria-label="Default outside stay estimate per bed group"
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder="Optional £"
                      value={state.default_outside_cost_gbp ?? ""}
                      onChange={(event) =>
                        update((draft) => {
                          draft.default_outside_cost_gbp = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Guest charge cap">
                    <Input
                      aria-label="Guest charge cap"
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder="Optional £"
                      value={state.guest_charge_cap_gbp ?? ""}
                      onChange={(event) =>
                        update((draft) => {
                          draft.guest_charge_cap_gbp = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Maximum total new cottage rent"
                    hint="Includes cottages guests would book directly."
                  >
                    <Input
                      aria-label="Maximum total new cottage rent"
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder="Optional £"
                      value={state.max_cottage_spend_gbp ?? ""}
                      onChange={(event) =>
                        update((draft) => {
                          draft.max_cottage_spend_gbp = event.target.value;
                        })
                      }
                    />
                  </Field>
                </CardContent>
              </Card>
            </>
          )}
          {view === "result" && (
            <ResultView
              state={state}
              busy={busy}
              warnings={warnings}
              allocation={allocation}
              partyNames={partyNames}
              report={report}
              onCalculate={calculate}
            />
          )}
        </main>
      </div>
    </div>
  );
}
