# Distributed coordination over intermittent links

**Status:** Research notes; no protocol decision or flight-software claim.

The current three-node protocol assumes one mission initiator, cooperative peers, bounded response
times, and a path between every participant. Those assumptions make the bench demonstration useful,
but they are the first things a real swarm would violate. Orbital motion creates scheduled contacts,
links may be asymmetric, a silent node may be healthy but unreachable, and a reset node may replay
old state after the rest of the swarm has moved on.

"Cooperative peers" is also a security assumption. It excludes a malfunctioning or compromised
member that sends valid-looking false state, an unauthorized transmitter that impersonates a node,
and hostile traffic that consumes radio time, CPU, or storage even when every packet fails
authentication. This note keeps those concerns bounded to the protocol semantics and experiments in
[the later security section](#byzantine-behavior-and-hostile-traffic-are-later-fault-models).

The right first question is not "which consensus algorithm should the swarm use?" It is "which
decisions need agreement, and what should happen when agreement is unavailable?" A single protocol
for every message would either stop too much work during a partition or permit unsafe conflicts.

## Four different jobs

| Job | Useful guarantee | Partition behavior |
| --- | --- | --- |
| Local health and safe-state action | One node can protect itself without permission | Act locally and report later |
| Reversible observation or computation | At-least-once work with idempotent results | Continue; duplicate work may be acceptable |
| Exclusive assignment or shared-resource use | At most one valid owner in a stated epoch | A minority or isolated node must abstain |
| Telemetry and science data transfer | Eventual, verifiable delivery before expiry | Store, carry, forward, resume, or discard by policy |

The table proposes a research model. The current controller does not provide these guarantees. In
particular, its temporary-leader handshake cannot prevent two initiators on opposite sides of a
partition from assigning conflicting work.

## What the impossibility results change

### The coordinated attack problem

The problem often called
[Two Generals](https://www.cs.yale.edu/homes/aspnes/pinewiki/TwoGenerals.html) asks two parties to
coordinate one action while any message or acknowledgement may be lost. James Aspnes's notes give
the problem and its message-removal proof in detail. No finite chain of acknowledgements can create
certainty that both parties know the final message arrived. Halpern and Moses connect this result to
common knowledge and show that common knowledge cannot be attained when communication is not
guaranteed in
[*Knowledge and Common Knowledge in a Distributed Environment*](https://www.cs.cornell.edu/home/halpern/papers/common_knowledge.pdf).

For this swarm, a lost assignment acknowledgement is ambiguous. The candidate may not have received
the assignment, or it may have acted and lost the reply. Sending one more acknowledgement only moves
the uncertainty to the other node.

The practical response is to stop promising exactly-once physical action. Give every command a
stable identifier and make software handlers idempotent. Record intent, attempted execution, and
observed outcome as separate events. Where repeating an actuator command is unsafe, a hardware
interlock or an operation-specific state machine must reject it. For example, retrying an assignment
could fire a maneuvering thruster for a second interval and apply roughly twice the intended change
in velocity. Message deduplication cannot reverse the resulting orbit change.

### FLP

Fischer, Lynch, and Paterson proved that a deterministic consensus protocol in a fully asynchronous
message-passing system cannot guarantee termination if even one process may crash. Their model even
assumes reliable, exactly-once message delivery, which is kinder than the network considered here.
The result says an admissible execution can remain undecided, not that consensus never succeeds. See
[*Impossibility of Distributed Consensus with One Faulty Process*](https://groups.csail.mit.edu/tds/papers/Lynch/pods83-flp-scanned.pdf).

A timeout does not defeat FLP. It adds a timing assumption. A satellite cannot tell from silence
alone whether a peer crashed, a packet was lost, or the peer moved outside the contact window.
Practical consensus protocols make progress under stated conditions such as eventual bounds on
message delay and processing time. Outside those conditions, they preserve safety by refusing to
commit.

This makes the trade explicit. An exclusive operation can prefer safety and become unavailable in a
partition. A repeatable observation can prefer availability and reconcile duplicate results later.
The choice belongs to the operation, not to the transport.

### Byzantine behavior and hostile traffic are later fault models

Crash and omission faults cover silent or unreachable nodes. Byzantine faults cover nodes that send
conflicting or fabricated state. Message authentication can identify a sender and detect
modification, but it cannot reject a captured, previously valid message on its own. Replay protection
requires an authenticated epoch or sequence number plus receiver-side replay state. The current
`WireCodec::decode` checks packet fields and a checksum; it provides neither sender authentication
nor replay protection. None of these controls makes a compromised, correctly authenticated node
truthful. Byzantine fault tolerance also adds replicas, messages, state, and membership assumptions
that do not fit the first three-node experiment.

An outsider does not need command authority to cause trouble. It may jam the radio, flood the link
with packets that still cost energy to receive and reject, fill reassembly queues, or repeatedly
attempt to join. Identity, authorization, replay windows, rate limits, bounded queues, admission
control, and traffic priorities reduce parts of that attack. They cannot guarantee availability
against an attacker that controls the shared radio channel.

The next simulator should first expose crash, reset, omission, duplication, delay, reordering,
asymmetric-link, and partition faults. Byzantine experiments become useful after persistent identity,
authenticated messages, anti-replay state, and a concrete adversary model exist.

## What transfers from Kafka

[Kafka's design documentation](https://kafka.apache.org/design/) is unusually candid about delivery
semantics. A producer that loses its response cannot know whether its write committed. Kafka uses
producer identities and sequence numbers to deduplicate retries, and its strongest transactional
guarantees end where cooperating Kafka storage ends. An external system must participate or provide
its own idempotence.

Those ideas transfer:

- stable mission, command, sender, and attempt identifiers;
- monotonically increasing sequence numbers within a durable node identity and epoch;
- idempotent message handlers and explicit duplicate detection;
- append-only local journals for replay and diagnosis;
- high-water marks that describe what a peer has actually observed; and
- separate records for intent, acceptance, execution, and outcome.

The centralized-log shape does not transfer. Kafka obtains ordered partitions from leaders and
in-sync replicas in a network where enough brokers can communicate. A swarm should assume that no
single ordered history is continuously available. Each node can instead keep a bounded local event
journal and exchange missing records when contact returns. The result is several partial histories.
Ordering exists within one sender or mission epoch unless a later protocol earns a stronger claim.

Kafka also provides a useful warning about language. "Exactly once" inside a transactional log does
not mean exactly one change occurred in the physical world. A protocol can deduplicate a command and
still lose power between actuator movement and durable outcome recording.

## Software and protocol evolution

A deployed swarm will rarely update as one atomic unit. The Starling flight report gives a concrete
example: a radio anomaly prevented one spacecraft from receiving the DSA software
update, so the planned four-node autonomy experiment ran with three. A production design must expect
old code to reappear after a long partition and an update to stop halfway through the swarm.

The first wire codec accepted exactly one 12-byte layout identified by `0xA1`. The stable-mission-key
slice replaces it with an 18-byte `0xA2` layout and deliberately keeps the hard cutover. Before a
mixed-version deployment, the project needs separate answers for four forms of compatibility:

- wire compatibility, including how old readers handle new message types and fields;
- behavioral compatibility, including whether two versions interpret an assignment the same way;
- persisted-state migration for mission epochs, replay windows, and local journals; and
- capability compatibility, so a leader does not assign work that a peer cannot perform.

Each node should eventually advertise a software version, supported wire versions, durable state
schema, and capabilities. A rollout can then define which mixed-version groups may coordinate. New
senders should stay within the oldest active reader's range until every required node advertises the
new capability. Removed field numbers and message codes must never gain a new meaning. The
[Protocol Buffers evolution rules](https://protobuf.dev/programming-guides/proto3/#updating) are a
useful catalogue of these failure modes even if this fixed-width embedded protocol never adopts
Protocol Buffers.

Binary delivery adds a separate trust problem. An update needs a signed manifest, content digest,
size bound, target hardware and current-version constraints, monotonic release number, staged
activation, and a recoverable previous image. The
[Update Framework specification](https://theupdateframework.io/spec/) is worth studying for rollback,
freeze, mix-and-match, unbounded-download, and compromised-key attacks. It is a source of security
requirements, not a proposal to put the framework unchanged on an Arduino.

The simulator should interrupt transfers and migrations at every durable write. It should cover an
old node rejoining, a new node rolling back after writing new state, a minority on the new protocol,
and a command that only the new version understands. Version skew belongs in the fault model rather
than in a release checklist.

## Data movement is not mission agreement

Bulk science data should use a different path from control messages. The control path carries small,
prioritized messages with operation-specific expiry and acknowledgement rules. The data path moves
immutable objects opportunistically without blocking local safety or coordination.

The space community already has a stronger starting point than ordinary Internet peer-to-peer
stacks. [Bundle Protocol Version 7](https://www.rfc-editor.org/rfc/rfc9171.html) defines a
store-carry-forward overlay for intermittent, delayed, asymmetric, or disrupted links. The
[CCSDS Schedule-Aware Bundle Routing standard](https://ccsds.org/Pubs/734x3b1.pdf) uses predicted
contacts to compute routes through a time-varying space network. A swarm can compare that approach
with opportunistic routing when maneuver uncertainty makes its contact plan stale.

The [CCSDS File Delivery Protocol](https://ccsds.org/Pubs/727x0b5e1.pdf) is a closer reference than
general Internet file sharing. It covers file transfer to and from spacecraft storage across
continuous, intermittent, asymmetric, time-disjoint, and one-way contacts. The experiment still
needs explicit requirements for resumable transfer, checksums or content digests, peer inventories,
duplicate suppression, storage admission, and expiry. CFDP and Bundle Protocol should be evaluated
at their intended layers before inventing a swarm-specific file protocol.

[Epidemic routing](https://cseweb.ucsd.edu/~vahdat/papers/epidemic.pdf) can deliver across a network
that never has an end-to-end path by copying messages during pairwise contact. Its cost is equally
important: unconstrained replication consumes radio time, storage, and energy. Any experiment needs
per-class copy limits, expiry, priority, buffer admission, and eviction. A bounded replication scheme
should be compared with direct delivery and schedule-aware routing rather than adopted on faith.

Data integrity and sender authority are separate. A chunk digest proves that bytes match a named
object; it does not prove that the object came from an authorized node. Bundle Protocol Security
defines integrity and confidentiality services for stored and forwarded bundles in
[RFC 9172](https://www.rfc-editor.org/rfc/rfc9172.html), but key provisioning and command policy
remain mission decisions.

## Evidence from flown and fielded swarm research

NASA's four-CubeSat Starling mission is the closest public flight experiment. Its
[2024 flight report](https://ntrs.nasa.gov/citations/20240006994) describes a decentralized
B.A.T.M.A.N. mobile ad hoc network that discovered neighbors, routed across spacecraft, issued
commands, and transferred files. The Distributed Spacecraft Autonomy payload shared state over that
network and let each spacecraft compute a plan locally.

The rough edges are more useful than a clean architecture diagram. A radio anomaly prevented one
spacecraft from receiving the DSA software update, so the autonomy experiment formed a three-node
network rather than the planned four. The report defines consensus operationally as every spacecraft
having the same plan and expects transient periods without it. This project should reproduce both
conditions: mixed software membership and nodes making decisions from temporarily different inputs.

NASA's earlier [DSA design paper](https://ntrs.nasa.gov/citations/20210016930) separates networking,
distributed state, command and control, planning, and science. That layered view reinforces the need
to avoid treating packet delivery as plan agreement.

DARPA's [OFFSET program](https://www.darpa.mil/research/programs/offensive-swarm-enabled-tactics)
worked at a different scale, with up to 250 air and ground systems, an open architecture, simulated
environments, and a human-swarm interface. This connects directly to the implemented bounded telemetry:
an operator needs to reconstruct what the swarm believed, which decisions it made, and where agents
disagreed. That view must remain an observer during autonomous operation. Its loss cannot stop local
safety behavior. OFFSET's terrestrial tactical network does not answer the orbital contact and
energy questions.

## Simulation software survey

No single simulator covers distributed protocol schedules, packet and radio behavior, orbital
dynamics, flight software, hardware interfaces, large experiment batches, and browser presentation
at equal depth. The useful tools fit at different boundaries.

| Tool | Strongest use here | Cost or limit |
| --- | --- | --- |
| Current native and WebAssembly harness | Run the real portable controller with deterministic time and faults | Needs a richer event scheduler and batch runner |
| [TLA+ and TLC](https://docs.tlapl.us/) | Explore bounded protocol states and find safety counterexamples across message schedules | Does not estimate mission performance or radio behavior |
| [OMNeT++](https://doc.omnetpp.org/omnetpp/manual/index.html) with [INET](https://inet.omnetpp.org/) | Model discrete network events, queues, wireless links, mobility, and MANET protocols | Adds a second model that must be checked against the C++ controller |
| [DTNSim](https://github.com/lggaray/dtnsim) | Compare contact plans, DTN routing, forwarding, and scheduling; it can call ION routing code | Beta software tied to an older OMNeT++ release, better as a research reference than a core dependency |
| [Basilisk](https://avslab.github.io/basilisk/) | Generate repeatable orbit, attitude, power, sensor, and maneuver conditions; supports Monte Carlo and hardware-in-the-loop work | More physical detail than the first protocol experiments need |
| [NASA NOS3](https://github.com/nasa/nos3) | Run flight software against spacecraft hardware models and an operator ground system | Suits later software and hardware integration, not fast protocol exploration |

TLA+ complements simulation. A million Monte Carlo runs can miss the one message ordering that
breaks exclusive ownership. A small model checker can search all schedules within its bounds and
return a counterexample trace. The deterministic C++ runner can then replay that trace against the
implementation.

OMNeT++ and INET become useful when a packet queue, medium-access rule, routing protocol, or radio
error model could change the answer. DTNSim narrows that work to contact-plan and DTN questions.
Basilisk belongs at the boundary where orbital geometry, attitude, power, or maneuvers determine the
contact trace. NOS3 belongs later, when the experiment must run representative flight software
against simulated hardware buses or a hardware-in-the-loop target.

### Shape of the test bed

The CesiumJS prototype can grow into the test-bed console, scenario editor, and trace viewer. Cesium
should not own simulated time or protocol decisions. The same headless simulation kernel should run
one interactive scenario in a Web Worker and large native batches without rendering.

A useful split is:

1. The existing portable C++ controller remains the implementation under test.
2. A deterministic discrete-event kernel owns simulated time, contacts, deliveries, node lifecycle,
   resource budgets, and the seeded fault schedule.
3. A versioned trace records inputs, state changes, messages, actions, and metric samples.
4. Optional adapters import contact and environment traces from Basilisk or network results from
   OMNeT++, INET, or DTNSim. The first experiments can use scripted inputs.
5. A native batch runner and the browser worker consume the same scenario and controller code.
6. Cesium renders a chosen run, compares traces, and explains why each mission succeeded or failed.

Each algorithm comparison should use the same scenario definitions and paired random seeds. Record
the code revision, algorithm configuration, seed, and trace for every run. Report the distribution
and confidence interval for mission success rather than one average. Preserve the worst failures as
regression fixtures.

Mission success needs a domain definition. Candidate measures include useful observations completed
before their deadlines, data delivered before expiry, conflicting exclusive assignments, invalid or
stale commands accepted, time to converge after a partition, energy and radio bytes per useful
result, buffer loss, propulsion use, and wear distributed across nodes. A weighted score may be
convenient for charts, but the raw measures must remain available because two unsafe failures can
hide behind the same average score.

## Proposed experiment sequence

### 1. Write invariants and assumptions

Define the fault model, membership model, clock assumptions, mission deadlines, and acceptable
duplicate behavior before changing the protocol. Candidate invariants include:

- a safe-disabled node never becomes active before reset;
- no node executes an exclusive mission without a valid assignment for its current epoch;
- no two healthy nodes believe they exclusively own the same mission in one epoch;
- expired commands cannot cause new work;
- replayed or duplicated messages do not repeat an accepted software transition; and
- loss of the data path cannot block local health handling.

Some of these invariants will fail against the current implementation. Those failures establish the
baseline behavior and must remain visible.

### 2. Build the network laboratory

Extend the deterministic host and proposed browser simulations with seeded schedules for packet
loss, delay, duplication, reordering, partitions, asymmetric links, node crash and reset, storage
pressure, stale contact plans, and mixed protocol versions. Materialize every stochastic choice in a
replayable trace.

Measure safety violations separately from liveness and cost. Useful measures include assignment
latency, time without a decision, duplicate work, convergence after healing, delivery ratio before
expiry, bytes transmitted, buffer occupancy, and estimated energy per delivered useful byte.
Run algorithms against paired scenarios and seeds so their mission-success estimates are comparable.

### 3. Define the wire and state evolution contract

Before nodes exchange journal data, define a versioned envelope that can carry a boot epoch, sender
sequence number, record type, and bounded payload. Specify record types for journal summaries,
missing-record requests, and journal entries, including how a receiver handles an unknown type or
version. Give durable journal state its own version and define migration and rollback rules.

Add a second wire and state version with one small, observable capability difference. Simulate an
interrupted rollout, mixed-version planning, rollback, and a long-isolated old node rejoining. Define
the compatibility corridor and prove that unsupported work is rejected without corrupting durable
state.

### 4. Add identity, epochs, and local journals

Give each node a persistent identity and boot epoch. Give missions and commands stable identifiers.
Persist the minimum state needed to reject stale ownership and replay after reset. Record a bounded
event journal with sender sequence numbers, then exchange summaries and missing records after
contact.

This phase can borrow Kafka's identifiers and replay discipline without inventing a global log.

### 5. Compare one strategy per job

Keep the current bounded retry protocol as the baseline. Compare it with:

- quorum-backed exclusive assignment that stops in a minority partition;
- deterministic local replanning from a shared, versioned input snapshot, similar to DSA;
- direct and schedule-aware store-carry-forward delivery for bulk data; and
- bounded opportunistic replication when no dependable contact plan exists.

The result should be a table of measured guarantees and failure modes, not one winning protocol for
the whole swarm.

### 6. Add security after semantics are visible

Authenticate identities and messages, reject replay across epochs, define offline key rotation, and
apply authorization by command type. Then inject forged, conflicting, and resource-exhaustion
traffic. Security work done earlier would protect protocol behavior whose meaning is still changing.

## The first implementation slice

The first network-laboratory step is now implemented. The deterministic trace can drop, delay, or
duplicate a selected delivery, change directed links for asymmetric partitions, and reset a node.
Every applied fault is visible in the result. The browser's assignment-loss scenario shows the
leader recording an assignee while the winning node waits and then returns to idle because its
assignment never arrived.

Stable mission identity and executable invariant checks are now implemented against the existing
temporary-leader controller. A mission key combines the origin node, its boot epoch, and a sequence
within that epoch. Deterministic tests cover lost acknowledgements and assignments, duplication,
one-way links, and node resets. The baseline preserves two failures: safe-disabled is volatile and a
delayed request has no expiry, so either can start work after the intended boundary.

The [coordination semantics and invariant baseline](invariant-baseline.md) states the fault,
membership, clock, deadline, and duplicate-execution assumptions. It classifies local health,
repeatable work, exclusive ownership, telemetry, and bulk data instead of assigning one guarantee to
all traffic. Categorized deterministic checks keep safety, liveness, and cost separate. The next
slice added a [bounded telemetry queue](telemetry.md) whose records use stable mission keys. A future
protocol still needs to earn stronger quorum, convergent-state, or delay-tolerant routing claims.
