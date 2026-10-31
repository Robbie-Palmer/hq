import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  actionManifest,
  actionOutcome,
  actionProposal,
  approval,
  auditEvent,
  contentHash,
  contentObject,
  encryptedContentClassEnum,
  evidence,
  idempotencyKey,
  mailAttachment,
  mailMessage,
  mailboxAccount,
  providerSyncState,
} from "../src/schema";

describe("Inbox Signal schema contract", () => {
  const tables = [
    actionManifest,
    actionOutcome,
    actionProposal,
    approval,
    auditEvent,
    contentHash,
    contentObject,
    evidence,
    idempotencyKey,
    mailAttachment,
    mailMessage,
    mailboxAccount,
    providerSyncState,
  ] as const;

  it("exports every foundation table with its stable migration name", () => {
    expect(tables.map((table) => getTableConfig(table).name)).toEqual([
      "action_manifest",
      "action_outcome",
      "action_proposal",
      "approval",
      "audit_event",
      "content_hash",
      "content_object",
      "evidence",
      "idempotency_key",
      "mail_attachment",
      "mail_message",
      "mailbox_account",
      "provider_sync_state",
    ]);
  });

  it("resolves every foreign key and update timestamp callback", () => {
    const configs = tables.map(getTableConfig);
    const references = configs.flatMap((config) =>
      config.foreignKeys.map((foreignKey) => foreignKey.reference()),
    );
    const updateValues = configs.flatMap((config) =>
      config.columns.flatMap((column) =>
        column.onUpdateFn ? [column.onUpdateFn()] : [],
      ),
    );

    expect(references).toHaveLength(21);
    expect(references.every((reference) => reference.foreignTable)).toBe(true);
    expect(updateValues).not.toHaveLength(0);
    expect(updateValues.every((value) => value instanceof Date)).toBe(true);
  });

  it("keeps permanent and expiring object classes in one database contract", () => {
    expect(encryptedContentClassEnum.enumValues).toEqual([
      "raw_mime",
      "attachment",
      "retained_document",
      "evaluation_sample",
      "export_bundle",
      "temporary_work",
    ]);
  });
});
