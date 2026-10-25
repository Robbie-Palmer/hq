"use client";

import {
  AlertTriangle,
  BedDouble,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Plus,
  Settings2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  buildWeddingReadiness,
  defaultWeddingReadinessPreferences,
  type ReadinessCheckId,
  readinessCheckIds,
  seatingExportKinds,
  type WeddingOperationsSnapshot,
} from "wedding-planner-domain";
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
import { editorStateToPlan } from "@/lib/wedding-planner/editor-projection";
import { loadWeddingOperationsSnapshot } from "@/lib/wedding-planner/readiness-finance";
import type { WeddingPlanDraft } from "@/lib/wedding-planner/types";

const checkLabels: Record<ReadinessCheckId, string> = {
  checklist: "Checklist work",
  finances: "Costs and payments",
  guest_responses: "Guest responses",
  guest_metadata: "Required guest details",
  guest_follow_up: "Guest follow-up",
  accommodation: "Accommodation allocation",
  accommodation_bookings: "Bookings and payment links",
  seating: "Seating plan",
  seating_exports: "Seating exports",
};

const exportLabels = {
  venue: "Venue CSV",
  caterer: "Caterer CSV",
  floor_plan: "Floor plan",
} as const;

type PlannerDestination = "guests" | "inventory" | "tables";

type ReadinessLoader = (
  planningCaseId: string | null,
) => Promise<WeddingOperationsSnapshot | null>;

type DraftUpdate = (change: (draft: WeddingPlanDraft) => void) => void;
type ReadinessPreferences = NonNullable<WeddingPlanDraft["readiness"]>;
type ReadinessMilestone = ReadinessPreferences["milestones"][number];
type MilestoneUpdate = (
  change: (milestone: ReadinessMilestone) => void,
) => void;
type MilestoneFieldsProps = Readonly<{
  preferences: ReadinessPreferences;
  active: ReadinessMilestone;
  onUpdate: DraftUpdate;
  updateActive: MilestoneUpdate;
}>;

function ensureReadiness(state: WeddingPlanDraft) {
  state.readiness ??= defaultWeddingReadinessPreferences();
  return state.readiness;
}

function defaultLoader(planningCaseId: string | null) {
  return loadWeddingOperationsSnapshot(window.localStorage, planningCaseId);
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function internalDestination(href: string): {
  view: PlannerDestination;
  targetId?: string;
} | null {
  if (!href.startsWith("wedding:")) return null;
  const [, section, targetId] = href.split(":");
  let view: PlannerDestination | null = null;
  if (section === "guests") view = "guests";
  else if (section === "inventory") view = "inventory";
  else if (section === "tables") view = "tables";
  return view ? { view, ...(targetId ? { targetId } : {}) } : null;
}

function SummaryCard({
  icon: Icon,
  title,
  value,
  detail,
}: Readonly<{
  icon: typeof ClipboardCheck;
  title: string;
  value: string;
  detail: string;
}>) {
  return (
    <Card className="readiness-summary-card">
      <CardHeader>
        <Icon size={18} />
        <CardDescription>{title}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent>{detail}</CardContent>
    </Card>
  );
}

function FinanceSummary({
  operations,
}: Readonly<{ operations: WeddingOperationsSnapshot | null }>) {
  if (!operations)
    return (
      <Card className="readiness-connect-card">
        <CardHeader>
          <CardTitle>Connect the wedding planning case</CardTitle>
          <CardDescription>
            Add the planning case ID below to read its checklist and costs from
            Asset Tracker. The wedding plan does not copy monetary data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href="/assettracker/cash-flow">Open Asset Tracker</a>
          </Button>
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Wedding costs</CardTitle>
        <CardDescription>{operations.planning_case_name}</CardDescription>
      </CardHeader>
      <CardContent className="readiness-finance-table">
        {operations.finances.map((summary) => (
          <div key={summary.currency}>
            <strong>{summary.currency}</strong>
            <span>
              Planned {formatMoney(summary.planned, summary.currency)}
            </span>
            <span>
              Committed {formatMoney(summary.committed, summary.currency)}
            </span>
            <span>Paid {formatMoney(summary.paid, summary.currency)}</span>
            <span>
              Refunded {formatMoney(summary.refunded, summary.currency)}
            </span>
            <span>
              Remaining {formatMoney(summary.remaining, summary.currency)}
            </span>
          </div>
        ))}
        {!operations.finances.length && (
          <p className="editor-hint">No linked wedding costs yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function IssueList({
  readiness,
  onNavigate,
}: Readonly<{
  readiness: ReturnType<typeof buildWeddingReadiness>;
  onNavigate: (view: PlannerDestination, targetId?: string) => void;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>
          {readiness.issues.length
            ? `${readiness.issues.length} checks need a decision or update.`
            : "All enabled checks are clear."}
        </CardDescription>
      </CardHeader>
      <CardContent className="readiness-issues">
        {!readiness.issues.length && (
          <div className="readiness-clear">
            <CheckCircle2 size={22} /> No warnings for this milestone
          </div>
        )}
        {readiness.issues.map((item) => {
          const destination = internalDestination(item.href);
          const content = (
            <>
              <AlertTriangle size={17} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <Badge
                variant={
                  item.severity === "warning" ? "destructive" : "secondary"
                }
              >
                {item.area}
              </Badge>
            </>
          );
          return destination ? (
            <button
              type="button"
              key={item.id}
              onClick={() => onNavigate(destination.view, destination.targetId)}
            >
              {content}
            </button>
          ) : (
            <a key={item.id} href={item.href}>
              {content}
            </a>
          );
        })}
      </CardContent>
    </Card>
  );
}

function MilestoneIdentityFields({
  preferences,
  active,
  onUpdate,
  updateActive,
}: MilestoneFieldsProps) {
  return (
    <>
      <label>
        <span>Milestone</span>
        <select
          value={active.id}
          onChange={(event) =>
            onUpdate((draft) => {
              ensureReadiness(draft).active_milestone_id = event.target.value;
            })
          }
        >
          {preferences.milestones.map((milestone) => (
            <option value={milestone.id} key={milestone.id}>
              {milestone.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="readiness-milestone-name">
        <span>Name</span>
        <Input
          id="readiness-milestone-name"
          aria-label="Milestone name"
          value={active.name}
          onChange={(event) =>
            updateActive((milestone) => {
              milestone.name = event.target.value || "Untitled milestone";
            })
          }
        />
      </label>
      <label htmlFor="readiness-milestone-date">
        <span>Due date</span>
        <Input
          id="readiness-milestone-date"
          aria-label="Milestone due date"
          type="date"
          value={active.due_on ?? ""}
          onChange={(event) =>
            updateActive((milestone) => {
              milestone.due_on = event.target.value || null;
            })
          }
        />
      </label>
    </>
  );
}

function MilestoneRequirementFields({
  preferences,
  active,
  onUpdate,
  updateActive,
}: MilestoneFieldsProps) {
  return (
    <>
      <label htmlFor="readiness-planning-case">
        <span>Asset Tracker planning case ID</span>
        <Input
          id="readiness-planning-case"
          aria-label="Asset Tracker planning case ID"
          placeholder="Auto-detect a wedding case"
          value={preferences.planning_case_id ?? ""}
          onChange={(event) =>
            onUpdate((draft) => {
              ensureReadiness(draft).planning_case_id =
                event.target.value.trim() || null;
            })
          }
        />
      </label>
      <label
        className="readiness-settings-wide"
        htmlFor="readiness-required-guest-fields"
      >
        <span>Required guest fields</span>
        <Input
          id="readiness-required-guest-fields"
          aria-label="Required guest fields"
          placeholder="email, phone, custom_fields.meal"
          value={active.required_guest_fields.join(", ")}
          onChange={(event) =>
            updateActive((milestone) => {
              milestone.required_guest_fields = event.target.value
                .split(",")
                .map((field) => field.trim())
                .filter(Boolean);
            })
          }
        />
      </label>
    </>
  );
}

function MilestoneChecks({
  active,
  updateActive,
}: Readonly<{
  active: ReadinessMilestone;
  updateActive: MilestoneUpdate;
}>) {
  return (
    <fieldset className="readiness-settings-wide">
      <legend>Checks used for this milestone</legend>
      <div className="readiness-check-grid">
        {readinessCheckIds.map((checkId) => (
          <label key={checkId}>
            <input
              type="checkbox"
              checked={active.check_ids.includes(checkId)}
              onChange={(event) =>
                updateActive((milestone) => {
                  milestone.check_ids = event.target.checked
                    ? [...milestone.check_ids, checkId]
                    : milestone.check_ids.filter((id) => id !== checkId);
                })
              }
            />
            {checkLabels[checkId]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function MilestoneExports({
  active,
  updateActive,
}: Readonly<{
  active: ReadinessMilestone;
  updateActive: MilestoneUpdate;
}>) {
  return (
    <fieldset className="readiness-settings-wide">
      <legend>Required seating exports</legend>
      <div className="readiness-check-grid">
        {seatingExportKinds.map((kind) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={active.required_seating_exports.includes(kind)}
              onChange={(event) =>
                updateActive((milestone) => {
                  milestone.required_seating_exports = event.target.checked
                    ? [...milestone.required_seating_exports, kind]
                    : milestone.required_seating_exports.filter(
                        (item) => item !== kind,
                      );
                })
              }
            />
            {exportLabels[kind]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AddMilestoneButton({ onUpdate }: Readonly<{ onUpdate: DraftUpdate }>) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() =>
        onUpdate((draft) => {
          const readiness = ensureReadiness(draft);
          const id = `milestone-${Date.now().toString(36)}`;
          readiness.milestones.push({
            id,
            name: `Milestone ${readiness.milestones.length + 1}`,
            due_on: null,
            check_ids: [...readinessCheckIds],
            required_guest_fields: [],
            required_seating_exports: [...seatingExportKinds],
          });
          readiness.active_milestone_id = id;
        })
      }
    >
      <Plus size={15} /> Add milestone
    </Button>
  );
}

function ReadinessSettings({
  state,
  onUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  onUpdate: DraftUpdate;
}>) {
  const preferences = state.readiness ?? defaultWeddingReadinessPreferences();
  const active =
    preferences.milestones.find(
      (milestone) => milestone.id === preferences.active_milestone_id,
    ) ?? preferences.milestones[0];
  if (!active) throw new Error("Readiness needs at least one milestone");
  const updateActive: MilestoneUpdate = (change) =>
    onUpdate((draft) => {
      const readiness = ensureReadiness(draft);
      const milestone = readiness.milestones.find(
        (candidate) => candidate.id === readiness.active_milestone_id,
      );
      if (milestone) change(milestone);
    });
  return (
    <details className="readiness-settings">
      <summary>
        <Settings2 size={16} /> Milestone checks
      </summary>
      <div className="readiness-settings-grid">
        <MilestoneIdentityFields
          {...{ preferences, active, onUpdate, updateActive }}
        />
        <MilestoneRequirementFields
          {...{ preferences, active, onUpdate, updateActive }}
        />
        <MilestoneChecks {...{ active, updateActive }} />
        <MilestoneExports {...{ active, updateActive }} />
        <AddMilestoneButton onUpdate={onUpdate} />
      </div>
    </details>
  );
}

type ReadinessDashboardProps = Readonly<{
  state: WeddingPlanDraft;
  onUpdate: DraftUpdate;
  onNavigate: (view: PlannerDestination, targetId?: string) => void;
  loadOperations?: ReadinessLoader;
}>;

function useOperations(
  loadOperations: ReadinessLoader,
  planningCaseId: string | null,
) {
  const [operations, setOperations] =
    useState<WeddingOperationsSnapshot | null>(null);
  const [operationsError, setOperationsError] = useState("");
  useEffect(() => {
    let current = true;
    loadOperations(planningCaseId)
      .then((snapshot) => {
        if (!current) return;
        setOperations(snapshot);
        setOperationsError("");
      })
      .catch((cause) => {
        if (!current) return;
        setOperations(null);
        setOperationsError(
          cause instanceof Error
            ? cause.message
            : "Could not read Asset Tracker",
        );
      });
    return () => {
      current = false;
    };
  }, [loadOperations, planningCaseId]);
  return { operations, operationsError };
}

function ReadinessSummary({
  readiness,
}: Readonly<{
  readiness: ReturnType<typeof buildWeddingReadiness>;
}>) {
  const details = {
    checklist: `${readiness.checklist.overdue} overdue · ${readiness.checklist.blocked} blocked · ${readiness.checklist.unresolved_decisions} decisions open`,
    guests: `${readiness.guests.awaiting_response} awaiting response · ${readiness.guests.missing_required_metadata} missing details`,
    accommodation: `${readiness.accommodation.unassigned} unassigned · ${readiness.accommodation.conflicts + readiness.accommodation.unmet_needs} conflicts or unmet needs`,
    seating: `${readiness.seating.unseated} unseated · ${readiness.seating.unlocked} unlocked · ${readiness.seating.stale_exports} exports due`,
  };
  return (
    <div className="readiness-summary-grid">
      <SummaryCard
        icon={ClipboardCheck}
        title="Checklist"
        value={`${readiness.checklist.completed}/${readiness.checklist.total}`}
        detail={details.checklist}
      />
      <SummaryCard
        icon={Users}
        title="Guests"
        value={`${readiness.guests.attending}/${readiness.guests.total}`}
        detail={details.guests}
      />
      <SummaryCard
        icon={BedDouble}
        title="Accommodation"
        value={`${readiness.accommodation.unassigned} unassigned`}
        detail={details.accommodation}
      />
      <SummaryCard
        icon={CalendarClock}
        title="Seating"
        value={`${readiness.seating.seated}/${readiness.seating.eligible}`}
        detail={details.seating}
      />
    </div>
  );
}

function UpcomingPayments({
  readiness,
}: Readonly<{
  readiness: ReturnType<typeof buildWeddingReadiness>;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming payments</CardTitle>
        <CardDescription>
          Deposits and balances due before this milestone
        </CardDescription>
      </CardHeader>
      <CardContent className="readiness-payments">
        {readiness.upcoming_payments.map((payment) => (
          <a href={payment.href} key={payment.id}>
            <CircleDollarSign size={17} />
            <span>
              <strong>{payment.title}</strong>
              <small>{payment.due_on}</small>
            </span>
            <strong>{formatMoney(payment.amount, payment.currency)}</strong>
          </a>
        ))}
        {!readiness.upcoming_payments.length && (
          <p className="editor-hint">No linked payments due.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function ReadinessDashboard({
  state,
  onUpdate,
  onNavigate,
  loadOperations = defaultLoader,
}: ReadinessDashboardProps) {
  const planningCaseId = state.readiness?.planning_case_id ?? null;
  const { operations, operationsError } = useOperations(
    loadOperations,
    planningCaseId,
  );
  const plan = useMemo(() => editorStateToPlan(state), [state]);
  const readiness = useMemo(
    () =>
      buildWeddingReadiness(
        plan,
        operations,
        new Date().toISOString().slice(0, 10),
      ),
    [operations, plan],
  );
  return (
    <>
      <div className="page-heading readiness-heading">
        <div>
          <h2>Readiness</h2>
          <p>{readiness.milestone.name}</p>
        </div>
        <Badge variant={readiness.issues.length ? "secondary" : "default"}>
          {readiness.issues.length
            ? `${readiness.issues.length} checks need attention`
            : "Ready"}
        </Badge>
      </div>
      <ReadinessSettings state={state} onUpdate={onUpdate} />
      {operationsError && (
        <div role="alert" className="editor-error">
          {operationsError}
        </div>
      )}
      <ReadinessSummary readiness={readiness} />
      <div className="readiness-detail-grid">
        <FinanceSummary operations={operations} />
        <UpcomingPayments readiness={readiness} />
      </div>
      <IssueList readiness={readiness} onNavigate={onNavigate} />
    </>
  );
}
