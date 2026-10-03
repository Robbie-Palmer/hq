"use client";

import { UsersIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  equalSharedOwnership,
  ownershipLabel,
  personalOwnership,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

function MemberNameEditor({
  memberId,
  initialName,
  onSave,
}: Readonly<{
  memberId: string;
  initialName: string;
  onSave(memberId: string, displayName: string): Promise<void>;
}>) {
  const [displayName, setDisplayName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (displayName.trim() === "" || displayName.trim() === initialName) return;
    setSaving(true);
    try {
      await onSave(memberId, displayName);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex gap-2" onSubmit={handleSubmit}>
      <label
        htmlFor={`household-member-${memberId}`}
        className="min-w-0 flex-1"
      >
        <span className="sr-only">Display name for {initialName}</span>
        <Input
          id={`household-member-${memberId}`}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      <Button
        type="submit"
        variant="outline"
        disabled={
          saving ||
          displayName.trim() === "" ||
          displayName.trim() === initialName
        }
      >
        Save
      </Button>
    </form>
  );
}

export function HouseholdScopeControl() {
  const {
    household,
    householdAccounts,
    addHouseholdMember,
    renameHouseholdMember,
    setAccountOwnership,
    setActiveHouseholdScope,
  } = useAssetTracker();
  const [newMemberName, setNewMemberName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeScope = household.activeScope;
  const activeMember =
    activeScope.kind === "member"
      ? household.members.find(({ id }) => id === activeScope.memberId)
      : null;
  const activeLabel = activeMember?.displayName ?? "Household";

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newMemberName.trim() === "") return;
    setAdding(true);
    setError(null);
    try {
      await addHouseholdMember(newMemberName);
      setNewMemberName("");
    } catch {
      setError("Asset Tracker could not save that household member.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button
          variant="outline"
          className="min-h-11"
          aria-label={`Viewing ${activeLabel}`}
        >
          <UsersIcon />
          <span className="max-w-32 truncate">{activeLabel}</span>
        </Button>
      </DrawerTrigger>
      <DrawerContent className="h-[92dvh] max-h-[92dvh] overflow-hidden">
        <DrawerHeader className="mx-auto w-full max-w-2xl shrink-0">
          <DrawerTitle>Household view</DrawerTitle>
          <DrawerDescription>
            These people and views exist only in this browser. They do not
            create separate logins or access controls.
          </DrawerDescription>
        </DrawerHeader>
        <div className="mx-auto min-h-0 w-full max-w-2xl flex-1 space-y-6 overflow-y-auto p-4">
          <section className="space-y-2" aria-labelledby="active-view-heading">
            <h3 id="active-view-heading" className="text-sm font-medium">
              Active view
            </h3>
            <select
              aria-label="Active household view"
              value={
                household.activeScope.kind === "household"
                  ? "household"
                  : `member:${household.activeScope.memberId}`
              }
              onChange={(event) => {
                const value = event.target.value;
                void setActiveHouseholdScope(
                  value === "household"
                    ? { kind: "household" }
                    : { kind: "member", memberId: value.slice(7) },
                );
              }}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
            >
              <option value="household">Whole household</option>
              {household.members.map((member) => (
                <option key={member.id} value={`member:${member.id}`}>
                  {member.displayName}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Shared values use each member's recorded percentage and count once
              in the household view.
            </p>
          </section>

          <section className="space-y-3" aria-labelledby="members-heading">
            <div>
              <h3 id="members-heading" className="text-sm font-medium">
                Household members
              </h3>
              <p className="text-xs text-muted-foreground">
                Member IDs stay stable when a display name changes.
              </p>
            </div>
            {household.members.map((member) => (
              <MemberNameEditor
                key={member.id}
                memberId={member.id}
                initialName={member.displayName}
                onSave={renameHouseholdMember}
              />
            ))}
            <form className="flex gap-2" onSubmit={handleAddMember}>
              <label htmlFor="new-household-member" className="min-w-0 flex-1">
                <span className="sr-only">New household member</span>
                <Input
                  id="new-household-member"
                  value={newMemberName}
                  placeholder="Add a household member"
                  onChange={(event) => setNewMemberName(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                disabled={adding || newMemberName.trim() === ""}
              >
                Add
              </Button>
            </form>
          </section>

          <section
            className="space-y-3"
            aria-labelledby="accounts-owner-heading"
          >
            <div>
              <h3 id="accounts-owner-heading" className="text-sm font-medium">
                Account ownership
              </h3>
              <p className="text-xs text-muted-foreground">
                Changing an account also updates its balances, contributions,
                holdings, and planned spending.
              </p>
            </div>
            {householdAccounts.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Create an account before assigning ownership.
              </p>
            ) : (
              householdAccounts.map((account) => (
                <div
                  key={account.id}
                  className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {account.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {account.provider} ·{" "}
                      {ownershipLabel(account.ownership, household.members)}
                    </p>
                  </div>
                  <select
                    aria-label={`Owner of ${account.name}`}
                    value={
                      account.ownership.kind === "personal"
                        ? `member:${account.ownership.memberId}`
                        : "shared"
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      void setAccountOwnership(
                        account.id,
                        value === "shared"
                          ? equalSharedOwnership(household.members)
                          : personalOwnership(value.slice(7)),
                      );
                    }}
                    className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                  >
                    {household.members.map((member) => (
                      <option key={member.id} value={`member:${member.id}`}>
                        {member.displayName}
                      </option>
                    ))}
                    {household.members.length > 1 && (
                      <option value="shared">Shared equally</option>
                    )}
                  </select>
                </div>
              ))
            )}
          </section>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mx-auto flex w-full max-w-2xl shrink-0 justify-end border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DrawerClose asChild>
            <Button type="button">Done</Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
