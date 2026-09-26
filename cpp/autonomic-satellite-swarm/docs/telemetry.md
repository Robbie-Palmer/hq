# Bounded telemetry

The portable controller records typed evidence about state transitions, mission negotiation,
mission outcomes, health changes, and transport failures. This is diagnostic evidence from a
research prototype. It is not a flight telemetry protocol.

Each controller owns a fixed 16-record queue. Recording and reading allocate no memory and do not
perform I/O. Failure to drain the queue never blocks coordination or health handling. The queue is
single-context code: it does not synchronize concurrent access, so an interrupt handler must not
read or record telemetry while the main loop is accessing it.

## Record identity

A record contains:

- the node ID, boot epoch, and a sequence number that starts at one for each controller boot;
- the controller's monotonic millisecond timestamp;
- the cumulative number of records dropped before this record was stored;
- a type, reason, and priority;
- the current mission key when one exists;
- the related node and a small event-specific value when needed; and
- the previous and current controller state.

The sequence advances for every attempted record, including a record rejected by a full queue.
Consumers can therefore detect a gap. `droppedTelemetryEvents()` exposes the count immediately,
even when no later record has entered the queue.

`CandidacySent` records cover both the initial successful transmission and successful retries. For
one mission and node, the first such record is the initial transmission and each later record is a
retry. Failed transmissions instead produce `TransportFailure` records.

On the leader, an `AssignmentBroadcast` record stores the chosen node in `related_node` and its
candidacy score in `value`. The repeated equal-score simulation counts these records to assess the
allocation policy. A receiving node records the assignee but leaves `value` at zero because the
assignment wire message does not carry the winning score.

Entering safe-disabled adds three critical records in order: `SafeStateRequested`, the state
transition, and `SafeStateResult`. The emitter node and boot epoch identify the one request allowed
during that controller boot. Safe-state records store the emitter in `related_node` and retain the
triggering reason and current mission key. `SafeStateResult.value` is `0` when the platform rejects
the request and `1` when it accepts it.

After acceptance, the controller polls the adapter once per update while its status remains pending.
It emits one `SafeStateExecutionResult` and stops polling when the adapter reports success or
failure. The event value is `1` for success and `2` for failure. Adapter-reported success is useful
evidence, but it does not independently prove that hardware reached a physical safe state.

Sequence zero is reserved. After record `4,294,967,295`, the buffer stops storing telemetry and
counts later attempts as drops, up to the saturating drop-counter limit. This preserves unique
record identities within a boot without widening every record on SRAM-constrained targets.
Controller coordination and health handling continue after exhaustion; a reboot with a new boot
epoch starts a new sequence.

## Admission under pressure

Telemetry has routine, operational, and critical priorities. When the queue is full, an incoming
record can displace the oldest record at the lowest priority beneath its own. Otherwise, the queue
drops the incoming record. Mission outcomes and entry into safe-disabled are critical, so routine
candidacy evidence cannot displace them.

This policy bounds storage and the work needed to admit one record.

## Rate-limited export

`TelemetryTransmitter` peeks at the oldest record and asks a platform `TelemetrySink` to publish it.
It attempts at most one record per call and one per configured interval. Failed publication leaves
the record queued and delays another attempt until the next interval. Attempt, success, and rejection
counters saturate at their 32-bit limit.

The caller supplies `channel_available` on every update. A platform sharing one physical channel must
set it to false while coordination or safety traffic needs that channel. The transmitter does no work
and consumes no record while access is withheld. The Uno and ESP32 reference sketches use a
dedicated serial diagnostic channel, call the controller first, and grant telemetry afterward. They
attempt one frame per second.

Export uses a fixed 34-byte binary frame identified by `0xB3`. It contains every record field in
big-endian order, one reserved zero byte, and a CRC-8. This is separate from the 18-byte coordination
packet. The serial experiment has no delivery acknowledgement, authentication, encryption, replay
protection, or routing. A parser must use the magic byte and checksum to find frames after startup
text or a partial read.

## Deterministic replay

The simulation drains every controller after each command or update and adds the records to its
ordered event stream. It intentionally bypasses the transmitter because the replay captures complete
internal evidence rather than modelling a downlink. Browser schema version 6 exposes the records and
each node's cumulative drop count. The replay log can distinguish a state change inferred by the
simulator from the controller's own reason for that change.
