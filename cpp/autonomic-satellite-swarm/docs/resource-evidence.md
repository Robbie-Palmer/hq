# Resource evidence and shared-radio budgets

The portable library now has a `ResourceObserver` port for platform measurements. A successful
observation carries its own timestamp and an availability bit for each field. The current schema can
record energy, temperature, controller time, storage, actuator cycles, duty cycle, wear, flash,
static RAM, stack high-water use, telemetry-frame size, and radio capacity.

`ResourceEvidenceRecorder` validates the observation and labels the attempt `Fresh`, `Stale`,
`Unavailable`, or `Invalid`. It retains the last valid observation when a later attempt is
unavailable or invalid. It does not convert evidence into a health state or candidacy score. A future
policy must store its decision separately and identify the evidence it used.

The recorder rejects unknown availability bits, impossible temperatures, duty cycles above 100%,
zero sizes for an available telemetry frame or radio, values attached to unavailable fields, and
timestamps that appear to come from the future. Freshness uses unsigned elapsed time, including one
32-bit clock rollover.

## Reference measurements

Run the complete profile with:

```shell
mise run resources:measure
```

The 25 October 2026 development run produced these values:

- Arduino Uno and IR used 14,656 of 32,256 program bytes and 1,257 of 2,048 static
  bytes. That left 791 bytes. Board timing and stack high-water use were not measured.
- ESP32 and ESP-NOW used 915,136 of 1,310,720 program bytes and 46,480 of 327,680 static
  bytes. That left 281,200 bytes. Board timing and stack high-water use were not measured.
- The macOS host controller object was 752 bytes. The idle profile completed 50,000 updates in
  3,027,250 nanoseconds, with a worst sample of 167 nanoseconds. Stack evidence was unavailable.

The host timing probe uses `std::chrono::steady_clock` in the CMake development build. Each sample
includes one idle controller update and the surrounding clock reads on one machine. It is useful for
catching large regressions, but it says nothing about either microcontroller's timing. The probe
emits `worstObservedStackBytes: null` instead of turning static SRAM headroom into a false stack
claim.

The firmware compiler reports program and global allocation. The Uno check still requires 768
bytes after global allocation, leaving 23 bytes above that guard in this run. Neither compiler
report measures call-stack depth, interrupt nesting, heap growth, radio callbacks, or physical
timing. A board adapter should populate the stack and timing fields only after a stack high-water
probe and monotonic timer have run under the intended event storm. Until then, those fields remain
unavailable and shared-radio deployment is blocked.

## Shared-radio scheduling

`SharedRadioScheduler` owns a rolling window with an explicit byte limit, airtime limit, or both.
Coordination and safety traffic always enter the schedule, even when doing so exceeds the limit.
The scheduler counts that overrun. Telemetry enters only after the platform reports no priority
traffic waiting and the remaining budget covers the whole frame.

The scheduler counts telemetry admitted, deferred for priority traffic, and deferred for budget. It
also consumes the controller queue's cumulative drop count, which keeps loss visible when repeated
deferral fills the bounded telemetry queue. All counters and accumulated costs saturate.

The deterministic 14,400 bit/s laboratory profile gives an 18-byte coordination packet 10,000
microseconds of airtime and a 34-byte telemetry frame 18,889 microseconds. A hypothetical 10% duty
cycle allows 100,000 microseconds in a one-second window, enough for five telemetry frames only when
coordination and safety use none of it. The calculation comes from model inputs. No IR, ESP-NOW, or
spacecraft-radio measurement supports that limit.

Host tests cover an empty window, a window already used by coordination, priority traffic beyond
the nominal budget, clock rollover, counter saturation, and a 64-update health event storm. During
the storm, local health polling runs on every update, telemetry performs no sink publication, and
queue loss remains visible.

The reference sketches continue to export telemetry through dedicated serial links. Moving either
sketch to a shared radio still requires physical capacity, duty-cycle, latency, loss, and energy
measurements on the selected board and radio.
