import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const client = new PGlite();
const accountId = "018f3118-8cba-7c21-a411-4a7b76f3e652";
const hashId = "018f3118-94f6-7b1f-a1fd-27fc9963179b";
const objectId = "018f3118-a1a8-7d8c-aeb1-804a29ae17af";
const messageId = "018f3118-ac9a-7312-9729-27d2f1bd4ffd";
const auditId = "018f3118-b611-7940-80a4-c4df56af26b4";

async function seedMailbox(): Promise<void> {
  await client.exec(`
    INSERT INTO mailbox_account (id, provider, provider_account_id)
    VALUES ('${accountId}', 'microsoft_graph', 'provider-account-1');

    INSERT INTO content_hash (id, account_id, digest, byte_length)
    VALUES ('${hashId}', '${accountId}', '${"a".repeat(64)}', 128);

    INSERT INTO content_object (
      id,
      account_id,
      content_hash_id,
      content_class,
      object_key,
      key_version,
      nonce_base64,
      wrapped_data_key_base64
    ) VALUES (
      '${objectId}',
      '${accountId}',
      '${hashId}',
      'raw_mime',
      'inbox-signal/v1/raw_mime/accounts/${accountId}/objects/${objectId}/00000001.enc',
      'mail-archive-kek-v1',
      'AAECAwQFBgcICQoL',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
    );

    INSERT INTO mail_message (
      id,
      account_id,
      provider_message_id,
      raw_object_id,
      observed_at
    ) VALUES (
      '${messageId}',
      '${accountId}',
      'provider-message-1',
      '${objectId}',
      '2026-10-29T12:00:00Z'
    );
  `);
}

beforeAll(async () => {
  await client.exec(
    readFileSync(
      resolve("drizzle/0000_create_inbox_signal_data_foundation.sql"),
      "utf8",
    ),
  );
});

beforeEach(async () => {
  await client.exec("TRUNCATE mailbox_account CASCADE");
  await seedMailbox();
});

afterAll(async () => client.close());

describe("Inbox Signal data migration", () => {
  it("creates every foundation table", async () => {
    const tables = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it("enforces provider IDs within an account", async () => {
    await expect(
      client.exec(`
        INSERT INTO mail_message (
          account_id,
          provider_message_id,
          raw_object_id,
          observed_at
        ) VALUES (
          '${accountId}',
          'provider-message-1',
          '${objectId}',
          '2026-10-29T12:01:00Z'
        )
      `),
    ).rejects.toThrow(/mail_message_account_provider_id_uidx/);
  });

  it("enforces account-scoped idempotency keys", async () => {
    const insert = `
      INSERT INTO idempotency_key (account_id, scope, key, request_digest)
      VALUES ('${accountId}', 'sync-message', 'request-1', '${"b".repeat(64)}')
    `;
    await client.exec(insert);
    await expect(client.exec(insert)).rejects.toThrow(
      /idempotency_key_account_scope_key_uidx/,
    );
  });

  it("allows audit inserts but rejects updates and deletes", async () => {
    await client.exec(`
      INSERT INTO audit_event (
        id,
        account_id,
        event_type,
        actor_type,
        subject_type,
        subject_id,
        payload,
        event_hash,
        occurred_at
      ) VALUES (
        '${auditId}',
        '${accountId}',
        'message.observed',
        'system',
        'mail_message',
        '${messageId}',
        '{"source":"sync"}',
        '${"c".repeat(64)}',
        '2026-10-29T12:02:00Z'
      )
    `);

    await expect(
      client.exec(
        `UPDATE audit_event SET event_type = 'changed' WHERE id = '${auditId}'`,
      ),
    ).rejects.toThrow(/audit_event is append-only/);
    await expect(
      client.exec(`DELETE FROM audit_event WHERE id = '${auditId}'`),
    ).rejects.toThrow(/audit_event is append-only/);
  });
});
