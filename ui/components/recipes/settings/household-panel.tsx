"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleX,
  CookingPot,
  Home,
  LoaderCircle,
  LogOut,
  MailPlus,
  Plus,
  Trash2,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import {
  type SubmitEvent,
  type SubmitEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";
import { errorMessage } from "ts-base/errors";
import { RecipeAvatar } from "@/components/recipes/recipe-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  acceptHouseholdInvitation,
  addHouseholdEquipment,
  createHousehold,
  declineHouseholdInvitation,
  deleteHousehold,
  type EquipmentRecipeMatchMode,
  type Household,
  type HouseholdEquipment,
  type HouseholdEquipmentItem,
  type HouseholdInvitation,
  type HouseholdMember,
  type IncomingHouseholdInvitation,
  inviteHouseholdMember,
  leaveHousehold,
  removeHouseholdEquipment,
  removeHouseholdMember,
  renameHousehold,
  revokeHouseholdInvitation,
  saveHouseholdEquipmentMatchMode,
} from "@/lib/api/households";
import {
  type HouseholdSettingsData,
  householdSettingsQuery,
} from "@/lib/query/household-queries";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";
import { PanelHead } from "./panel-head";

type Mutation =
  | "create"
  | "rename"
  | "invite"
  | "remove"
  | "revoke"
  | "leave"
  | "delete"
  | "accept"
  | "decline"
  | "add-equipment"
  | "remove-equipment"
  | "save-equipment-mode"
  | null;

type ActiveMutation = Exclude<Mutation, null>;

function friendlyDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function excludeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

function equipmentStatus(item: HouseholdEquipmentItem): string | undefined {
  if (item.unresolved) {
    return "saved as written, automatic matching unavailable";
  }
  if (item.retired) return "retired equipment";
  return item.category;
}

function Section({
  title,
  sub,
  children,
}: Readonly<{
  title: string;
  sub?: string;
  children: React.ReactNode;
}>) {
  return (
    <section className="border-b border-dashed border-[var(--line)] py-6 first:pt-2 last:border-0">
      <p className="rt-mono text-[var(--terracotta)]">{title}</p>
      {sub && <p className="rt-body mt-1 text-sm text-[var(--ink-3)]">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function IncomingInvitationCard({
  invitation,
  busy,
  accepting,
  onAccept,
  onDecline,
}: Readonly<{
  invitation: IncomingHouseholdInvitation;
  busy: boolean;
  accepting: boolean;
  onAccept: (invitation: IncomingHouseholdInvitation) => void;
  onDecline: (invitation: IncomingHouseholdInvitation) => void;
}>) {
  function accept() {
    onAccept(invitation);
  }

  function decline() {
    onDecline(invitation);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--line-strong)] bg-[var(--card)] p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h2 className="rt-display text-2xl">
          Join {invitation.household.name}?
        </h2>
        <p className="rt-body mt-1 text-sm text-[var(--ink-2)]">
          Share household recipes and the kitchen features as they arrive.
          Expires {friendlyDate(invitation.expiresAt)}.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={decline}
        >
          <CircleX /> Decline
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={accept}
          className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
        >
          {accepting ? <LoaderCircle className="animate-spin" /> : <Check />}
          Join household
        </Button>
      </div>
    </div>
  );
}

function HouseholdMemberRow({
  member,
  currentUserId,
  removable,
  busy,
  onRemove,
}: Readonly<{
  member: HouseholdMember;
  currentUserId: string;
  removable: boolean;
  busy: boolean;
  onRemove: (member: HouseholdMember) => void;
}>) {
  const isCurrentUser = member.user.id === currentUserId;

  function remove() {
    onRemove(member);
  }

  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <RecipeAvatar
        name={member.user.name}
        email={member.user.email}
        image={member.user.image}
        size={42}
      />
      <div className="min-w-0 flex-1">
        <p className="rt-body truncate font-semibold text-[var(--ink)]">
          {member.user.name}
          {isCurrentUser ? " · you" : ""}
        </p>
        <p className="rt-mono truncate text-[var(--ink-3)]">
          {member.user.email}
        </p>
      </div>
      <span className="rt-mono rounded-full border border-[var(--line-strong)] bg-[var(--paper-warm)] px-2 py-1 text-[var(--ink-2)]">
        {member.role}
      </span>
      {removable && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${member.user.name}`}
          disabled={busy}
          onClick={remove}
          className="text-[var(--terracotta-deep)] hover:text-[var(--terracotta-deep)]"
        >
          <UserMinus />
        </Button>
      )}
    </div>
  );
}

function PendingInvitationRow({
  invitation,
  busy,
  onRevoke,
}: Readonly<{
  invitation: HouseholdInvitation;
  busy: boolean;
  onRevoke: (invitation: HouseholdInvitation) => void;
}>) {
  function revoke() {
    onRevoke(invitation);
  }

  return (
    <div className="flex items-center gap-3 border-b border-dashed border-[var(--line)] py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="rt-body truncate text-sm text-[var(--ink)]">
          {invitation.email}
        </p>
        <p className="rt-mono text-[var(--ink-3)]">
          pending · expires {friendlyDate(invitation.expiresAt)}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Revoke invitation for ${invitation.email}`}
        disabled={busy}
        onClick={revoke}
        className="text-[var(--ink-3)]"
      >
        <X />
      </Button>
    </div>
  );
}

function Feedback({
  error,
  notice,
  boxed = false,
}: Readonly<{
  error: string | null;
  notice: string | null;
  boxed?: boolean;
}>) {
  if (!error && !notice) return null;
  const spacing = boxed ? "mt-4 rounded-lg border px-3 py-2 text-sm" : "mt-4";

  if (error) {
    return (
      <p
        role="alert"
        className={`rt-body ${spacing} ${
          boxed
            ? "border-[var(--destructive)]/30 bg-[var(--destructive)]/5"
            : ""
        } text-[var(--destructive)]`}
      >
        {error}
      </p>
    );
  }

  return (
    <output
      className={`rt-body block ${spacing} ${
        boxed
          ? "border-[var(--sage)]/40 bg-[var(--sage)]/10 text-[var(--ink-2)]"
          : "text-[var(--sage)]"
      }`}
    >
      {notice}
    </output>
  );
}

function HouseholdLoading() {
  return (
    <output
      className="flex min-h-64 items-center justify-center"
      aria-label="Loading household"
    >
      <LoaderCircle className="size-6 animate-spin text-[var(--ink-3)]" />
    </output>
  );
}

function HouseholdLoadError({
  error,
  onRetry,
}: Readonly<{ error: string | null; onRetry: () => void }>) {
  return (
    <div>
      <PanelHead
        kicker="HOUSEHOLD"
        title="We couldn't load your household."
        sub="Your existing household information is unchanged. Try loading it again before creating or managing a household."
      />
      <p role="alert" className="rt-body mt-4 text-[var(--destructive)]">
        {error}
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-4"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}

function EmptyHouseholdView({
  currentUserName,
  incoming,
  busy,
  mutation,
  name,
  error,
  notice,
  onNameChange,
  onCreate,
  onAccept,
  onDecline,
}: Readonly<{
  currentUserName: string;
  incoming: IncomingHouseholdInvitation[];
  busy: boolean;
  mutation: Mutation;
  name: string;
  error: string | null;
  notice: string | null;
  onNameChange: (name: string) => void;
  onCreate: (event: SubmitEvent<HTMLFormElement>) => void;
  onAccept: (invitation: IncomingHouseholdInvitation) => void;
  onDecline: (invitation: IncomingHouseholdInvitation) => void;
}>) {
  return (
    <div>
      <PanelHead
        kicker="HOUSEHOLD"
        title="Cook better together."
        sub="Create one shared home for the people you plan, shop, and cook with. Your recipes stay personal unless you choose to share them."
      />

      {incoming.length > 0 && (
        <div className="mt-6 rounded-2xl border border-[var(--sage)]/60 bg-[var(--sage)]/10 p-5 sm:p-6">
          <p className="rt-mono text-[var(--terracotta)]">YOU'RE INVITED</p>
          <div className="mt-3 space-y-4">
            {incoming.map((invitation) => (
              <IncomingInvitationCard
                key={invitation.id}
                invitation={invitation}
                busy={busy}
                accepting={mutation === "accept"}
                onAccept={onAccept}
                onDecline={onDecline}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-[var(--line-strong)] bg-[var(--card)] p-5 sm:p-7">
        <span className="flex size-11 items-center justify-center rounded-full bg-[var(--butter-soft)] text-[var(--terracotta-deep)]">
          <Home className="size-5" />
        </span>
        <h2 className="rt-display mt-4 text-3xl">Start a household.</h2>
        <p className="rt-body mt-2 max-w-xl text-[var(--ink-2)]">
          You can belong to one household for now. You'll be its owner and can
          invite or remove members.
        </p>
        <form
          onSubmit={onCreate}
          className="mt-5 flex max-w-lg flex-col gap-3 sm:flex-row"
        >
          <Input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={`${currentUserName}'s kitchen`}
            aria-label="Household name"
            maxLength={120}
            disabled={busy}
            className="bg-white"
          />
          <Button
            type="submit"
            disabled={busy}
            className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
          >
            {mutation === "create" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Users />
            )}
            Create household
          </Button>
        </form>
      </div>
      <Feedback error={error} notice={notice} />
    </div>
  );
}

function HouseholdNameSection({
  householdName,
  name,
  busy,
  saving,
  onNameChange,
  onRename,
}: Readonly<{
  householdName: string;
  name: string;
  busy: boolean;
  saving: boolean;
  onNameChange: (name: string) => void;
  onRename: (event: SubmitEvent<HTMLFormElement>) => void;
}>) {
  return (
    <Section
      title="HOUSEHOLD NAME"
      sub="This is visible to everyone in the household."
    >
      <form
        onSubmit={onRename}
        className="flex max-w-lg flex-col gap-3 sm:flex-row"
      >
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          maxLength={120}
          aria-label="Household name"
          disabled={busy}
          className="bg-[var(--card)]"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={busy || name.trim() === householdName}
        >
          {saving ? <LoaderCircle className="animate-spin" /> : <Check />}
          Save name
        </Button>
      </form>
    </Section>
  );
}

function HouseholdMembersSection({
  members,
  currentUserId,
  isOwner,
  busy,
  onRemove,
}: Readonly<{
  members: HouseholdMember[];
  currentUserId: string;
  isOwner: boolean;
  busy: boolean;
  onRemove: (member: HouseholdMember) => void;
}>) {
  return (
    <Section
      title="MEMBERS"
      sub="Members can see household-shared recipes and the shared kitchen features as they arrive."
    >
      <div className="divide-y divide-dashed divide-[var(--line)]">
        {members.map((member) => (
          <HouseholdMemberRow
            key={member.id}
            member={member}
            currentUserId={currentUserId}
            removable={isOwner && member.role !== "owner"}
            busy={busy}
            onRemove={onRemove}
          />
        ))}
      </div>
    </Section>
  );
}

function HouseholdInvitationsSection({
  invitations,
  inviteEmail,
  busy,
  inviting,
  onInviteEmailChange,
  onInvite,
  onRevoke,
}: Readonly<{
  invitations: HouseholdInvitation[];
  inviteEmail: string;
  busy: boolean;
  inviting: boolean;
  onInviteEmailChange: (email: string) => void;
  onInvite: (event: SubmitEvent<HTMLFormElement>) => void;
  onRevoke: (invitation: HouseholdInvitation) => void;
}>) {
  return (
    <Section
      title="INVITE PEOPLE"
      sub="Invitations expire after 48 hours and only work for the invited email address."
    >
      <form
        onSubmit={onInvite}
        className="flex max-w-lg flex-col gap-3 sm:flex-row"
      >
        <Input
          type="email"
          value={inviteEmail}
          onChange={(event) => onInviteEmailChange(event.target.value)}
          placeholder="cook@example.com"
          aria-label="Email to invite"
          disabled={busy}
          className="bg-[var(--card)]"
          required
        />
        <Button
          type="submit"
          disabled={busy || !inviteEmail.trim()}
          className="bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--ink-2)]"
        >
          {inviting ? <LoaderCircle className="animate-spin" /> : <MailPlus />}
          Invite
        </Button>
      </form>

      {invitations.length > 0 && (
        <div className="mt-5 max-w-lg rounded-xl border border-[var(--line)] bg-[var(--card)] px-4">
          {invitations.map((invitation) => (
            <PendingInvitationRow
              key={invitation.id}
              invitation={invitation}
              busy={busy}
              onRevoke={onRevoke}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function HouseholdEquipmentSection({
  equipment,
  selectedSlug,
  busy,
  adding,
  onSelectedSlugChange,
  onAdd,
  onRemove,
  onMatchModeChange,
}: Readonly<{
  equipment: HouseholdEquipment | null;
  selectedSlug: string;
  busy: boolean;
  adding: boolean;
  onSelectedSlugChange: (slug: string) => void;
  onAdd: SubmitEventHandler<HTMLFormElement>;
  onRemove: (item: HouseholdEquipmentItem) => void;
  onMatchModeChange: (mode: EquipmentRecipeMatchMode) => void;
}>) {
  if (!equipment) {
    return (
      <Section
        title="KITCHEN EQUIPMENT"
        sub="Household equipment couldn't be loaded. Try refreshing this panel."
      >
        <p className="rt-body text-sm text-[var(--ink-3)]">
          No equipment changes are available right now.
        </p>
      </Section>
    );
  }

  const ownedSlugs = new Set(equipment.owned.map((item) => item.slug));
  const available = equipment.catalog.filter(
    (item) => !ownedSlugs.has(item.slug),
  );

  return (
    <Section
      title="KITCHEN EQUIPMENT"
      sub="Choose whether recipes use a shared household equipment list."
    >
      <div className="mb-5">
        <p className="rt-mono mb-2 text-[var(--ink-3)]">
          WHEN A RECIPE NEEDS OTHER EQUIPMENT
        </p>
        <div className="inline-flex rounded-full border border-[var(--line)] bg-[var(--paper-warm)] p-1">
          {(
            [
              ["hide", "Hide it"],
              ["warn", "Show warning"],
              ["disabled", "Disable it"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={(equipment.recipeMatchMode ?? "warn") === value}
              disabled={busy}
              onClick={() => onMatchModeChange(value)}
              className={`rt-body rounded-full px-4 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                (equipment.recipeMatchMode ?? "warn") === value
                  ? "bg-[var(--ink)] font-semibold text-[var(--paper)]"
                  : "text-[var(--ink-2)] hover:bg-[var(--card)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {equipment.recipeMatchMode === "disabled" ? (
        <p className="rt-body text-sm text-[var(--ink-3)]">
          Equipment checks are off. Any saved equipment will still be here if
          you turn them back on.
        </p>
      ) : (
        <>
          <form
            onSubmit={onAdd}
            className="flex max-w-lg flex-col gap-3 sm:flex-row"
          >
            <label className="sr-only" htmlFor="household-equipment">
              Equipment to add
            </label>
            <Input
              id="household-equipment"
              list="household-equipment-catalog"
              value={selectedSlug}
              onChange={(event) => onSelectedSlugChange(event.target.value)}
              disabled={busy}
              placeholder="Choose equipment or enter your own"
              className="min-w-0 flex-1 bg-[var(--card)]"
            />
            <datalist id="household-equipment-catalog">
              {available.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name} · {item.category}
                </option>
              ))}
            </datalist>
            <Button
              type="submit"
              variant="outline"
              disabled={busy || !selectedSlug}
            >
              {adding ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Add equipment
            </Button>
          </form>

          {equipment.owned.length === 0 ? (
            <div className="mt-5 flex max-w-lg items-center gap-3 rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--paper-warm)] p-4 text-[var(--ink-3)]">
              <CookingPot className="size-5 shrink-0" />
              <p className="rt-body text-sm">No equipment added yet.</p>
            </div>
          ) : (
            <div className="mt-5 max-w-lg divide-y divide-dashed divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--card)] px-4">
              {equipment.owned.map((item) => (
                <div key={item.slug} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="rt-body capitalize text-sm text-[var(--ink)]">
                      {item.name}
                    </p>
                    <p className="rt-mono text-[var(--ink-3)]">
                      {equipmentStatus(item)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${item.name}`}
                    disabled={busy}
                    onClick={() => onRemove(item)}
                    className="text-[var(--ink-3)]"
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function HouseholdDangerZone({
  isOwner,
  busy,
  pending,
  onDelete,
  onLeave,
}: Readonly<{
  isOwner: boolean;
  busy: boolean;
  pending: boolean;
  onDelete: () => void;
  onLeave: () => void;
}>) {
  const description = isOwner
    ? "Deleting a household removes its membership and invitations. Recipes return to private."
    : "Leaving makes your household-shared recipes private again.";
  const label = isOwner ? "Delete household" : "Leave household";
  const action = isOwner ? onDelete : onLeave;

  function icon() {
    if (pending) return <LoaderCircle className="animate-spin" />;
    return isOwner ? <Trash2 /> : <LogOut />;
  }

  return (
    <Section title="DANGER ZONE" sub={description}>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={action}
        className="border-[var(--destructive)]/50 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
      >
        {icon()}
        {label}
      </Button>
    </Section>
  );
}

function ManagedHouseholdView({
  household,
  members,
  equipment,
  invitations,
  currentUserId,
  busy,
  mutation,
  name,
  inviteEmail,
  equipmentSlug,
  error,
  notice,
  onNameChange,
  onInviteEmailChange,
  onEquipmentSlugChange,
  onRename,
  onInvite,
  onRemove,
  onRevoke,
  onAddEquipment,
  onRemoveEquipment,
  onEquipmentMatchModeChange,
  onDelete,
  onLeave,
}: Readonly<{
  household: Household;
  members: HouseholdMember[];
  equipment: HouseholdEquipment | null;
  invitations: HouseholdInvitation[];
  currentUserId: string;
  busy: boolean;
  mutation: Mutation;
  name: string;
  inviteEmail: string;
  equipmentSlug: string;
  error: string | null;
  notice: string | null;
  onNameChange: (name: string) => void;
  onInviteEmailChange: (email: string) => void;
  onEquipmentSlugChange: (slug: string) => void;
  onRename: (event: SubmitEvent<HTMLFormElement>) => void;
  onInvite: (event: SubmitEvent<HTMLFormElement>) => void;
  onRemove: (member: HouseholdMember) => void;
  onRevoke: (invitation: HouseholdInvitation) => void;
  onAddEquipment: SubmitEventHandler<HTMLFormElement>;
  onRemoveEquipment: (item: HouseholdEquipmentItem) => void;
  onEquipmentMatchModeChange: (mode: EquipmentRecipeMatchMode) => void;
  onDelete: () => void;
  onLeave: () => void;
}>) {
  const isOwner = household.membership.role === "owner";

  return (
    <div>
      <PanelHead
        kicker="HOUSEHOLD"
        title={household.name}
        sub={`${members.length} ${members.length === 1 ? "person" : "people"} · created ${friendlyDate(household.createdAt)} · you're ${isOwner ? "the owner" : "a member"}.`}
      />

      <Feedback error={error} notice={notice} boxed />

      {isOwner && (
        <HouseholdNameSection
          householdName={household.name}
          name={name}
          busy={busy}
          saving={mutation === "rename"}
          onNameChange={onNameChange}
          onRename={onRename}
        />
      )}

      <HouseholdMembersSection
        members={members}
        currentUserId={currentUserId}
        isOwner={isOwner}
        busy={busy}
        onRemove={onRemove}
      />

      <HouseholdEquipmentSection
        equipment={equipment}
        selectedSlug={equipmentSlug}
        busy={busy}
        adding={mutation === "add-equipment"}
        onSelectedSlugChange={onEquipmentSlugChange}
        onAdd={onAddEquipment}
        onRemove={onRemoveEquipment}
        onMatchModeChange={onEquipmentMatchModeChange}
      />

      {isOwner && (
        <HouseholdInvitationsSection
          invitations={invitations}
          inviteEmail={inviteEmail}
          busy={busy}
          inviting={mutation === "invite"}
          onInviteEmailChange={onInviteEmailChange}
          onInvite={onInvite}
          onRevoke={onRevoke}
        />
      )}

      <HouseholdDangerZone
        isOwner={isOwner}
        busy={busy}
        pending={mutation === "delete" || mutation === "leave"}
        onDelete={onDelete}
        onLeave={onLeave}
      />
    </div>
  );
}

export function HouseholdPanel({
  currentUser,
}: Readonly<{
  currentUser: { id: string; email: string; name: string };
}>) {
  const queryClient = useQueryClient();
  const settingsKey = recipeQueryKeys.householdSettings(currentUser.id);
  const householdResult = useQuery(householdSettingsQuery(currentUser.id));
  const [mutation, setMutation] = useState<Mutation>(null);
  const mutationRef = useRef<Mutation>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(householdResult.data?.household?.name ?? "");
  const [inviteEmail, setInviteEmail] = useState("");
  const [equipmentSlug, setEquipmentSlug] = useState("");
  const household = householdResult.data?.household ?? null;
  const members = householdResult.data?.members ?? [];
  const equipment = householdResult.data?.equipment ?? null;
  const invitations = householdResult.data?.invitations ?? [];
  const incoming = householdResult.data?.incoming ?? [];
  const error =
    actionError ??
    householdResult.data?.detailError ??
    (householdResult.isError && householdResult.data
      ? errorMessage(householdResult.error, "Couldn't refresh your household.")
      : null);

  useEffect(() => {
    setName(household?.name ?? "");
  }, [household?.name]);

  function updateHouseholdData(
    updater: (data: HouseholdSettingsData) => HouseholdSettingsData,
  ) {
    queryClient.setQueryData<HouseholdSettingsData>(settingsKey, (current) =>
      current ? updater(current) : current,
    );
  }

  async function refreshHouseholdData() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: settingsKey,
        exact: true,
      }),
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.pantry(currentUser.id),
        exact: true,
      }),
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.equipmentReadiness(currentUser.id),
        exact: true,
      }),
    ]);
  }

  function run(kind: ActiveMutation, action: () => Promise<void>) {
    if (mutationRef.current) return;
    mutationRef.current = kind;
    setMutation(kind);
    setActionError(null);
    setNotice(null);
    action()
      .catch((actionError) => {
        setActionError(
          errorMessage(actionError, "Something went wrong. Please try again."),
        );
      })
      .finally(() => {
        mutationRef.current = null;
        setMutation(null);
      });
  }

  const busy = mutation !== null;

  function onCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      setActionError("Give your household a name first.");
      return;
    }
    run("create", async () => {
      await createHousehold(nextName);
      setNotice("Household created.");
      await refreshHouseholdData();
    });
  }

  function onRename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!household) return;
    const nextName = name.trim();
    if (!nextName) {
      setActionError("Household name can't be empty.");
      return;
    }
    if (nextName === household.name) return;
    run("rename", async () => {
      const updated = await renameHousehold(household.id, nextName);
      updateHouseholdData((current) => ({
        ...current,
        household: current.household
          ? { ...current.household, ...updated }
          : current.household,
      }));
      setName(updated.name);
      setNotice("Household name saved.");
    });
  }

  function onInvite(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!household) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    run("invite", async () => {
      const invitation = await inviteHouseholdMember(household.id, email);
      updateHouseholdData((current) => ({
        ...current,
        invitations: [...current.invitations, invitation],
      }));
      setInviteEmail("");
      setNotice(`Invitation created for ${invitation.email}.`);
    });
  }

  function retryLoad() {
    void householdResult.refetch();
  }

  function acceptInvitation(invitation: IncomingHouseholdInvitation) {
    run("accept", async () => {
      await acceptHouseholdInvitation(invitation.id);
      setNotice(`Welcome to ${invitation.household.name}.`);
      await refreshHouseholdData();
    });
  }

  function declineInvitation(invitation: IncomingHouseholdInvitation) {
    run("decline", async () => {
      await declineHouseholdInvitation(invitation.id);
      updateHouseholdData((current) => ({
        ...current,
        incoming: excludeById(current.incoming, invitation.id),
      }));
      setNotice("Invitation declined.");
    });
  }

  function removeMember(member: HouseholdMember) {
    if (!household) return;
    if (!window.confirm(`Remove ${member.user.name} from ${household.name}?`)) {
      return;
    }
    run("remove", async () => {
      await removeHouseholdMember(household.id, member.id);
      updateHouseholdData((current) => ({
        ...current,
        members: excludeById(current.members, member.id),
      }));
      setNotice(`${member.user.name} was removed.`);
    });
  }

  function revokeInvitation(invitation: HouseholdInvitation) {
    if (!household) return;
    run("revoke", async () => {
      await revokeHouseholdInvitation(household.id, invitation.id);
      updateHouseholdData((current) => ({
        ...current,
        invitations: excludeById(current.invitations, invitation.id),
      }));
      setNotice(`Invitation for ${invitation.email} revoked.`);
    });
  }

  const onAddEquipment: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!household || !equipmentSlug) return;
    run("add-equipment", async () => {
      const added = await addHouseholdEquipment(household.id, equipmentSlug);
      updateHouseholdData((current) => ({
        ...current,
        equipment: current.equipment
          ? {
              ...current.equipment,
              owned: [
                ...current.equipment.owned.filter(
                  (item) => item.slug !== added.slug,
                ),
                added,
              ].sort((left, right) => left.name.localeCompare(right.name)),
            }
          : current.equipment,
      }));
      setEquipmentSlug("");
      await queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.equipmentReadiness(currentUser.id),
        exact: true,
      });
      setNotice(`${added.name} added to the household.`);
    });
  };

  function onRemoveEquipment(item: HouseholdEquipmentItem) {
    if (!household) return;
    run("remove-equipment", async () => {
      await removeHouseholdEquipment(household.id, item.slug);
      updateHouseholdData((current) => ({
        ...current,
        equipment: current.equipment
          ? {
              ...current.equipment,
              owned: current.equipment.owned.filter(
                (ownedItem) => ownedItem.slug !== item.slug,
              ),
            }
          : current.equipment,
      }));
      await queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.equipmentReadiness(currentUser.id),
        exact: true,
      });
      setNotice(`${item.name} removed from the household.`);
    });
  }

  function onEquipmentMatchModeChange(mode: EquipmentRecipeMatchMode) {
    if (!household || !equipment || equipment.recipeMatchMode === mode) return;
    run("save-equipment-mode", async () => {
      const updated = await saveHouseholdEquipmentMatchMode(household.id, mode);
      updateHouseholdData((current) => ({
        ...current,
        equipment: current.equipment
          ? { ...current.equipment, recipeMatchMode: updated.recipeMatchMode }
          : current.equipment,
      }));
      await queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.equipmentReadiness(currentUser.id),
        exact: true,
      });
      setNotice("Equipment matching preference saved.");
    });
  }

  function deleteCurrentHousehold() {
    if (!household) return;
    if (!window.confirm(`Delete ${household.name}? This can't be undone.`)) {
      return;
    }
    run("delete", async () => {
      await deleteHousehold(household.id);
      updateHouseholdData((current) => ({
        ...current,
        household: null,
        equipment: null,
        members: [],
        invitations: [],
      }));
      setName("");
      setNotice("Household deleted.");
      await refreshHouseholdData();
    });
  }

  function leaveCurrentHousehold() {
    if (!household) return;
    if (!window.confirm(`Leave ${household.name}?`)) return;
    run("leave", async () => {
      await leaveHousehold(household.id);
      updateHouseholdData((current) => ({
        ...current,
        household: null,
        equipment: null,
        members: [],
        invitations: [],
      }));
      setName("");
      setNotice("You've left the household.");
      await refreshHouseholdData();
    });
  }

  if (householdResult.isPending) {
    return <HouseholdLoading />;
  }

  if (householdResult.isError && !householdResult.data) {
    return (
      <HouseholdLoadError
        error={errorMessage(
          householdResult.error,
          "Couldn't load your household.",
        )}
        onRetry={retryLoad}
      />
    );
  }

  if (!household) {
    return (
      <EmptyHouseholdView
        currentUserName={currentUser.name}
        incoming={incoming}
        busy={busy}
        mutation={mutation}
        name={name}
        error={error}
        notice={notice}
        onNameChange={setName}
        onCreate={onCreate}
        onAccept={acceptInvitation}
        onDecline={declineInvitation}
      />
    );
  }

  return (
    <ManagedHouseholdView
      household={household}
      members={members}
      equipment={equipment}
      invitations={invitations}
      currentUserId={currentUser.id}
      busy={busy}
      mutation={mutation}
      name={name}
      inviteEmail={inviteEmail}
      equipmentSlug={equipmentSlug}
      error={error}
      notice={notice}
      onNameChange={setName}
      onInviteEmailChange={setInviteEmail}
      onEquipmentSlugChange={setEquipmentSlug}
      onRename={onRename}
      onInvite={onInvite}
      onRemove={removeMember}
      onRevoke={revokeInvitation}
      onAddEquipment={onAddEquipment}
      onRemoveEquipment={onRemoveEquipment}
      onEquipmentMatchModeChange={onEquipmentMatchModeChange}
      onDelete={deleteCurrentHousehold}
      onLeave={leaveCurrentHousehold}
    />
  );
}
