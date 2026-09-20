# Wire protocol

## Mission identity

A mission key has three fields:

```text
{origin node, boot epoch, mission sequence}
```

The origin node is the durable node identity that created the mission. The 32-bit boot epoch must
change before that node creates messages after a reset. The 16-bit mission sequence starts at one
within an epoch. Zero is invalid for either numeric field. A controller stops creating missions
when it exhausts the sequence instead of wrapping to one.

This key names a mission. It does not prove that an assignment arrived or that its target started
work. Every message also carries its immediate sender because a candidacy sender differs from the
mission origin.

The simulator increments a node's boot epoch on reset. A real node must load and advance the epoch
from durable storage before constructing its controller. The reference firmware accepts a build-time
epoch for compile and bench use, so it does not yet provide reset-safe epoch management.

## Packet

Every semantic message is encoded into 18 bytes:

| Offset | Size | Field | Encoding |
| --- | ---: | --- | --- |
| 0 | 1 | Magic and version | `0xA2`: family `A`, version `2` |
| 1 | 1 | Message type | Request `1`, candidacy `2`, acknowledgement `3`, assignment `4` |
| 2 | 1 | Sender node | `0..15` in the current controller |
| 3 | 1 | Target node | Node ID or broadcast `255` |
| 4 | 1 | Mission origin node | `0..15` in the current controller |
| 5 | 4 | Mission boot epoch | Nonzero unsigned integer, big-endian |
| 9 | 2 | Mission sequence | Nonzero unsigned integer, big-endian |
| 11 | 2 | Longitude | Signed centidegrees, big-endian |
| 13 | 2 | Latitude | Signed centidegrees, big-endian |
| 15 | 1 | Score | `0..100` |
| 16 | 1 | Reserved | Must be zero |
| 17 | 1 | Checksum | CRC-8, polynomial `0x07`, over bytes `0..16` |

Coordinates and mission keys are validated before encoding and after decoding. Fields unused by a
message type are zero. A packet with the wrong size, version, type, score range, coordinate range,
reserved byte, mission key, or checksum is rejected. Version-one packets are not accepted because
their node-local mission ID cannot be mapped to a stable key after receipt.

## Message flow

1. A leader broadcasts `MissionRequest(key, objective)`.
2. Each idle node sends `Candidacy(key, leader, score)` and retries until acknowledged.
3. The leader records the score and sends `Acknowledgement(key, candidate)`.
4. At the end of its bounded response window, the leader broadcasts
   `MissionAssignment(key, chosen_node)`.
5. The chosen node becomes active; other candidates return to idle.

Every transition matches the complete mission key. An acknowledgement or assignment from an earlier
leader boot cannot complete a later negotiation that reused the same sequence.

The highest score wins. When multiple received candidates share that score, the leader orders them
by node ID and chooses a mission-keyed cyclic index. It hashes the origin node and boot epoch into a
starting phase, then advances one place for each mission sequence. A stable set of equal top-scoring
candidates therefore receives one assignment each per complete rotation. The rule changes no wire
field. It does not account for resource or lifetime cost, and changing the tied set changes the
rotation.

## Infrared framing

The Uno adapter splits the packet into six three-byte chunks. Each chunk is carried in a 32-bit NEC
raw frame whose high byte is `0xD0 | chunk_index`. The receiver accepts chunks `0..5`, resets on a new
chunk `0`, and discards incomplete packets after 250 ms. The packet CRC detects corruption and most
mixed assemblies.

## Telemetry framing

Telemetry does not use the coordination message format. `TelemetryCodec` writes a fixed 34-byte
frame:

| Offset | Size | Field | Encoding |
| --- | ---: | --- | --- |
| 0 | 1 | Magic and version | `0xB3`: family `B`, version `3` |
| 1 | 1 | Event type | `TelemetryEventType` value |
| 2 | 1 | Reason | `TelemetryReason` value |
| 3 | 1 | Priority | Routine `0`, operational `1`, critical `2` |
| 4 | 1 | Emitter node | `0..15` |
| 5 | 1 | Related node | Node ID or broadcast `255` |
| 6 | 1 | Previous state | `ControllerState` value |
| 7 | 1 | Current state | `ControllerState` value |
| 8 | 1 | Event value | Type-specific unsigned value |
| 9 | 4 | Emitter boot epoch | Unsigned integer, big-endian |
| 13 | 4 | Record sequence | Nonzero unsigned integer, big-endian |
| 17 | 4 | Timestamp | Monotonic milliseconds, big-endian |
| 21 | 4 | Dropped before | Cumulative unsigned count, big-endian |
| 25 | 1 | Mission origin | Node ID or `255` when absent |
| 26 | 4 | Mission boot epoch | Unsigned integer, big-endian, zero when absent |
| 30 | 2 | Mission sequence | Unsigned integer, big-endian, zero when absent |
| 32 | 1 | Reserved | Must be zero |
| 33 | 1 | Checksum | CRC-8, polynomial `0x07`, over bytes `0..32` |

The mission key must be valid or entirely absent as `{255, 0, 0}`. The decoder rejects unknown enum
values, invalid nodes, malformed mission keys, a nonzero reserved byte, and checksum failure.

For `SafeStateRequested`, `SafeStateResult`, and `SafeStateExecutionResult`, the emitter node and boot
epoch form the request ID, and `related node` repeats the emitter. All three records are critical and
use one of the three safe-disable reasons. `SafeStateResult` uses event value `0` for rejected and `1`
for accepted. `SafeStateExecutionResult` uses `1` for success and `2` for failure. Pending status is
not emitted. Adding terminal execution results advances the telemetry frame from `0xB2` to `0xB3`;
the codec deliberately rejects older versions.

The reference firmware sends these frames over its serial diagnostic link at a configured maximum
rate. It does not send them over the IR or ESP-NOW coordination transport. The format detects
corruption and version mismatch but supplies no acknowledgement, routing, authentication,
encryption, or replay protection.

## Security and reliability

CRC detects transmission errors. It provides no authentication. ESP-NOW broadcast and the infrared
framing are unauthenticated. The protocol also lacks replay storage, assignment confirmation,
durable boot-epoch management, forward error correction, congestion control, and Byzantine behavior
handling. Stable keys make replay detection possible; they do not provide it by themselves. Those
omissions are acceptable for a benchtop research prototype and unacceptable for a real command link.
