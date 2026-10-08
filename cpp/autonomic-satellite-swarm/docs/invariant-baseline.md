# Coordination semantics and invariant baseline

**Status:** Characterization of the temporary-leader controller, not a flight-software claim.

The deterministic checks in `tests/invariant_test.cpp` apply these assumptions to the current
controller. They separate facts a node can establish from facts that packet delivery alone cannot
prove.

## Operation contract

Different work needs different guarantees. The transport does not turn these operation classes into
one common agreement protocol.

| Operation | Required guarantee | Behavior during a partition | Current implementation |
| --- | --- | --- | --- |
| Local health and safe-state action | A node can protect itself without network permission. One controller boot makes at most one idempotent platform request after entering safe-disabled. | Act locally. Queue evidence for later delivery. | Implemented with a volatile latch. Reset persistence is a known failure. |
| Repeatable observation or computation | At-least-once execution is acceptable only when a stable work ID makes the result idempotent or duplicates can be reconciled. | Continue when local policy permits it. Preserve the work ID and report duplicate outcomes. | Not implemented as a separate operation type. The assignment test only proves one software state transition for a duplicated packet. |
| Exclusive mission ownership or shared-resource use | At most one valid owner for a mission key in the origin node's current boot epoch. A node needs matching assignment evidence before it acts. | An isolated node must abstain when it cannot establish current ownership. Availability may be lost to preserve safety. | The scripted baseline passes, but the temporary-leader handshake does not provide quorum-backed ownership across arbitrary partitions. |
| Controller telemetry | Bounded, ordered evidence per emitter boot. Loss and queue pressure must remain observable. Telemetry cannot block controller or health work. | Buffer within the fixed admission policy, drop by priority when full, and export later. | Implemented as a bounded local queue and a separately rate-limited transmitter. |
| Bulk science or diagnostic data | Eventual, verifiable, resumable delivery before an object-specific expiry. Duplicate chunks must not duplicate the committed object. | Store, carry, forward, resume, or discard by explicit policy. | Not implemented. Control messages and telemetry are not a bulk-data protocol. |

No row promises exactly-once physical action. A node may move an actuator and lose power before it
records the result. That case needs an operation-specific state machine, durable evidence, and often
a hardware interlock.

## System assumptions

### Fault and trust model

- The executable baseline injects message loss, finite delay, duplication, delay-induced
  reordering, directed link loss, partitions, and node reset. A trace fixes every event and replays
  it deterministically.
- Nodes are cooperative and non-Byzantine. The model does not cover forged messages, a compromised
  authenticated member, radio jamming, packet corruption below the validated codec, or resource
  exhaustion.
- A reset replaces the controller and clears its volatile state and inbox. The simulator increments
  the node's boot epoch before constructing the replacement. Real hardware must advance that epoch
  durably before it starts the controller.
- These scenarios are regression evidence, not an exhaustive schedule search. They do not prove the
  invariants for every topology, timing, or fault sequence.

### Membership and identity model

- A trace configures a fixed membership of one to sixteen nodes. Node IDs are contiguous in the
  simulator and provisioned rather than negotiated.
- Nodes do not join, leave, change capabilities, or agree on a new membership while a trace runs. A
  silent node is indistinguishable from an unreachable node.
- A mission key is `{origin node, boot epoch, mission sequence}`. The origin and boot epoch identify
  the mission namespace. The sequence never wraps within one controller boot.
- The current protocol has no quorum or membership certificate. Seeing an assignment proves that a
  matching message reached one node. It does not prove that every member observed the same owner.

### Clock and deadline model

- Each controller receives a local unsigned 32-bit millisecond counter. Elapsed-time comparisons
  tolerate rollover when consecutive observations are no more than `INT32_MAX` ticks apart.
- The trace runner uses one deterministic time value to drive every node. This is a test mechanism,
  not a claim that spacecraft clocks are synchronized. The protocol carries no clock offset or
  uncertainty estimate.
- `response_window_ms` bounds the leader's candidacy collection and the candidate's wait phases.
  Those are local state-machine timeouts, not message deadlines.
- Mission requests and assignments carry no creation time or expiry. A request delayed beyond the
  leader's response window can still start candidacy. Mission execution also has no protocol-level
  deadline or cancellation rule.

### Duplicate execution model

- The transport may deliver the same validated message more than once. Handlers match the complete
  mission key and current state before accepting a transition.
- Repeating one assignment packet causes one transition to active in the deterministic baseline.
  This is software idempotence for that transition only. It does not make an external actuator or
  result store idempotent.
- A safe-state request uses `{node ID, boot epoch}` as its request ID and runs once per controller
  boot. Because the safe-disabled latch is not durable, a reset can create another request under a
  new boot epoch.

## What each node can claim

| Fault | Leader can claim | Candidate can claim | Neither can claim |
| --- | --- | --- | --- |
| Acknowledgement to the candidate is lost | It received the candidacy and handed an acknowledgement to its transport. It may later select and broadcast an assignment. | Before an assignment, it knows only that it sent candidacy and received no matching acknowledgement. A matching assignment is enough for this controller to become active. | That the acknowledgement arrived. The leader also cannot claim that the assignment arrived or that the candidate became active. |
| Assignment to the winner is lost | It selected a target and handed the assignment to its transport. Its `assigned_node` records selection only. Delivery remains unknown. | It received the request and acknowledgement but no assignment. It never becomes active and returns to idle after its wait expires. | That the selected target owns or started the mission. Another node seeing the broadcast cannot infer delivery to the target. |

The protocol has no assignment acknowledgement. Adding one would report another observation, but a
lost reply would still leave the leader uncertain whether the candidate acted.

## Executable results

Run the baseline from the repository root:

```shell
mise //cpp/autonomic-satellite-swarm:test:invariants
```

CTest prefixes every case with `safety`, `liveness`, or `cost` and assigns the matching label.
Safety checks forbid invalid state. Liveness checks require bounded progress under the stated trace
conditions. Cost checks count work without treating a cheap unsafe result as success.

| Class | Check | Baseline | Deterministic evidence |
| --- | --- | --- | --- |
| Safety | A safe-disabled node cannot become active during one controller boot. | Pass | A fatal-health transition followed by a duplicated assignment stays safe-disabled. |
| Safety | An active node has a self-assignment for a valid mission key in the origin's current boot epoch. | Pass in the scripted scenarios | Loss, duplication, and one-way-link runs inspect every active frame. |
| Safety | At most one node is active for one mission key. | Pass in the scripted scenarios | The same runs compare every pair of active nodes in each frame. |
| Safety | An expired request cannot start work. | **Expected baseline failure** | A request delayed past the leader's response window still moves an idle candidate to `awaiting acknowledgement` because the message carries no deadline. |
| Safety | A duplicated assignment cannot repeat an accepted software transition. | Pass | Delivering the same assignment twice produces one transition to active. |
| Safety | Safe-disabled survives reset until explicit recovery. | **Expected baseline failure** | Reset replaces the controller and moves the node from safe-disabled to idle. No durable latch exists. |
| Liveness | Lost assignment does not leave the candidate waiting forever. | Pass | The candidate returns to idle after its bounded wait. |
| Liveness | A one-way partition does not prevent the isolated candidate from leaving its wait state. | Pass | The candidate returns to idle even though the reverse link still works. |
| Liveness | Loss of every data link cannot block local fatal-health handling. | Pass | The isolated node enters safe-disabled from its local health input. |
| Cost | Duplicate delivery overhead stays separate from accepted work. | Pass | The nominal negotiation sends six control messages. The injected duplicate adds one fault event while the candidate still makes one accepted transition to active. |

The two expected failures use Catch2's `[!mayfail]` marker. They remain visible in categorized test
output without making the quality gate fail. A later ticket should remove each marker only when the
implementation satisfies the asserted invariant.

Stable mission keys prevent origin and leader-boot aliases. They do not fix command expiry or make
the safe-disabled latch durable.
