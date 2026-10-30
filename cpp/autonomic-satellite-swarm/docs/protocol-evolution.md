# Protocol and durable-state evolution

**Status:** Host-tested research contract. The controller and reference firmware still use the
18-byte `0xA2` mission packet. They do not send this envelope or persist this state.

The evolution experiment separates four version numbers that can change on different schedules:

- the software version identifies a build's behavior;
- the wire version defines the envelope and record rules;
- the durable-state schema defines what a restarted process may read;
- capability bits state which work a node can accept.

A node advertises all four. A sender chooses the highest wire version in the peers' shared range.
It checks every required capability before sending work. Version agreement alone does not imply
behavioral compatibility.

## Fixed envelope

`ProtocolEvolutionCodec` encodes every record into 32 bytes. It writes integers in big-endian order
and never transmits a C++ object layout.

| Offset | Size | Field | Rule |
| --- | ---: | --- | --- |
| 0 | 1 | Magic | `0xC5` |
| 1 | 1 | Wire version | `1` or `2` |
| 2 | 1 | Record type | Summary `1`, request `2`, entry `3`, advertisement `4` |
| 3 | 1 | Sender | `0..15` |
| 4 | 4 | Sender boot epoch | Nonzero |
| 8 | 4 | Sender sequence | Nonzero and durably reserved |
| 12 | 1 | Payload length | `0..18` |
| 13 | 18 | Payload and zero padding | Type-specific fixed fields |
| 31 | 1 | Checksum | CRC-8 over bytes `0..30` |

The decoder checks the checksum before reporting an unsupported version or unknown record type. A
corrupt type byte is therefore not mistaken for a valid future extension. It rejects nonzero
padding, invalid node IDs, zero epochs or sequences, bad payload lengths, and malformed record
ranges. Unknown versions and record types have distinct results so callers can count them without
interpreting their payloads.

Codes and field positions are permanent once published. A later version may stop emitting a field,
but it must keep that position reserved. It must not assign an old record code to a different
meaning. A new record type needs a new code. A changed interpretation needs a new wire or record
schema version.

## Journal records

The envelope defines three exchange records.

`JournalSummary` names one origin node and boot epoch, then gives its oldest and newest retained
sender sequences. `{0, 0}` means that journal is empty. Other ranges must start at one or greater
and remain ordered.

`MissingRecordRequest` names one origin node and boot epoch, then asks for an inclusive nonzero
sequence range. The receiver may return fewer records when retention or packet budgets prevent a
complete answer. The requester must issue another bounded request rather than assuming absence.

`JournalEntry` contains a record schema, entry kind, required capability bits, priority, data length,
and at most eight data bytes. The implemented kinds are mission intent, mission outcome, and health
observation. This is enough to test evolution behavior. It is not a complete operational journal.

Wire version 1 carries record-schema-1 entries at normal priority. Wire version 2 is the small
observable change in this experiment. It adds record-schema-2 critical priority. A version 1 encoder
rejects a critical entry instead of silently treating it as normal.

## Capability rules

The current bits are mission coordination, journal exchange, and critical journal priority. Every
journal entry names all capabilities needed to apply it. The receiver checks that set before a
durable append. Missing one bit rejects the whole entry and leaves the state byte-for-byte
unchanged.

A version 2 node may use version 1 with an old peer for summaries, requests, and normal entries. It
must not send critical entries to that peer. If only a minority supports critical priority, those
nodes cannot use it for group work. The capability check uses each recipient's advertisement.

An advertisement may name software, wire, or state versions newer than this build. Negotiation caps
the result at wire version 2 and still finds an older shared version. The local decoder continues to
reject an envelope whose selected wire version is unknown.

## Durable state and rollback

`DurableProtocolState` keeps the node ID, state schema, minimum reader schema, boot epoch, next sender
sequence, and eight journal entries. The fixed capacity makes storage exhaustion visible. The
append operation builds and validates a candidate copy before replacing the live state. Invalid
work, unsupported capabilities, a full journal, and sequence exhaustion do not partially mutate
state.

Summary, request, and advertisement senders reserve their envelope sequence through
`reserveSenderSequence`. The reservation advances a candidate state before returning the number.
If the caller cannot persist that state, it must not transmit the envelope. Journal appends reserve
their sequence in the same candidate update.

Loading schema 1 in version 2 performs one migration. It sets the state schema to 2 but leaves the
minimum reader schema at 1. The previous software can still read that state because no version 2
meaning has been written. Appending a schema-2 entry raises the minimum reader schema to 2. A later
version 1 rollback then fails with `UnsafeRollback` and preserves the state. Operators must resume
version 2 or restore a verified pre-migration copy. The code never guesses how to discard the new
record.

Future migrations must follow the same order:

1. Validate the complete old state without mutation.
2. Write a candidate in the new schema while retaining the old minimum reader when possible.
3. Verify the candidate before replacing the active copy.
4. Raise the minimum reader only with the first write that uses new meaning.
5. Reject an old reader after that point. Do not coerce or truncate the state.

## Replayed version-skew cases

Host tests replay four cases from the research plan:

- an interrupted rollout leaves one schema-1 node and one migrated schema-2 node able to negotiate
  wire version 1;
- a rollback after a critical schema-2 write fails without changing durable state;
- one new node among two old nodes withholds critical work because the old advertisements lack the
  capability;
- a long-isolated version 1 node rejoins and receives a version 1 journal summary from a version 2
  peer.

The tests also cover unknown versions and types, corrupt frames, invalid ranges, unsupported work,
journal capacity, and sender-sequence exhaustion. They establish deterministic software behavior.
They do not establish radio interoperability, flash-write atomicity, authentication, replay-window
storage, or flight suitability.
