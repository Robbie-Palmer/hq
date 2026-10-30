"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BedDouble,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Plus,
  Settings2,
  Users,
} from "lucide-react";
import { useMemo } from "react";
import {
  buildWeddingReadiness,
  defaultWeddingReadinessPreferences,
  type ReadinessCheckId,
  readinessCheckIds,
  seatingExportKinds,
} from "wedding-planner-domain";
import { canonicalWeddingPlan } from "@/app/_projects/wedding-planner/application/queries";
import type { WeddingPlanDraft } from "@/app/_projects/wedding-planner/application/types";
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

const checkLabels: Record<ReadinessCheckId, string> = {
  guest_responses: "Guest responses",
  guest_metadata: "Required guest details",
  guest_follow_up: "Guest follow-up",
  accommodation: "Accommodation allocation",
  accommodation_bookings: "Bookings and payments",
  seating: "Seating plan",
  seating_exports: "Seating exports",
};

const exportLabels = {
  venue: "Venue CSV",
  caterer: "Caterer CSV",
  floor_plan: "Floor plan",
} as const;

type PlannerDestination = "guests" | "inventory" | "tables";

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
  icon: LucideIcon;
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
              <span className="readiness-issue-icon">
                <AlertTriangle size={16} />
              </span>
              <span className="readiness-issue-copy">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <Badge className="readiness-issue-area" variant="outline">
                {item.area}
              </Badge>
              <ChevronRight className="readiness-issue-chevron" size={16} />
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
  active,
  updateActive,
}: MilestoneFieldsProps) {
  return (
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
}>;

function ReadinessSummary({
  readiness,
}: Readonly<{
  readiness: ReturnType<typeof buildWeddingReadiness>;
}>) {
  const details = {
    guests: `${readiness.guests.awaiting_response} awaiting response · ${readiness.guests.missing_required_metadata} missing details`,
    accommodation: `${readiness.accommodation.unassigned} unassigned · ${readiness.accommodation.conflicts + readiness.accommodation.unmet_needs} conflicts or unmet needs`,
    seating: `${readiness.seating.unseated} unseated · ${readiness.seating.unlocked} unlocked · ${readiness.seating.stale_exports} exports due`,
  };
  return (
    <div className="readiness-summary-grid">
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

export function ReadinessDashboard({
  state,
  onUpdate,
  onNavigate,
}: ReadinessDashboardProps) {
  const plan = useMemo(() => canonicalWeddingPlan(state), [state]);
  const readiness = useMemo(
    () => buildWeddingReadiness(plan, new Date().toISOString().slice(0, 10)),
    [plan],
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
      <ReadinessSummary readiness={readiness} />
      <IssueList readiness={readiness} onNavigate={onNavigate} />
    </>
  );
}
