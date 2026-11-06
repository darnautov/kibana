# Proposal

## Why

Adaptive capacity (https://github.com/elastic/response-ops-team/issues/840, changes `tm-adaptive-capacity` and `tm-persisted-memory-estimates`) learns what a task costs by watching the process: heap growth between samples is split among the runs in flight by cost share. That is the only signal, and it has two gaps the tasks themselves could close. First, an unseen task instance is priced at the flat default until it has run once, so the first run of a herd of new heavy rules is admitted on a guess; with persisted estimates this is now a first-ever-run problem, but alerting v2 and workflows are exactly the tasks whose first run can be the largest. Second, a streaming task knows its own bound (batch size × batches in flight) and when it has released it, while the process-level signal sees only the aggregate and attributes it by cost share, which is noisy when a dozen runs overlap. Alerting v2 already counts the bytes it receives from Elasticsearch to enforce its response-size guard (https://github.com/elastic/kibana/pull/290026), so the number exists and is thrown away.

A static hint on the task definition was considered and dropped: memory varies a lot from run to run for the same type, so a definition-level number would be wrong most of the time and trusted anyway.

## What Changes

- The run context gains a `memory` reporter with two calls. `reserve(bytes)` declares an upper bound on what this run will hold beyond its learned estimate, takes effect in the next capacity decision, and is lowered or cleared by calling it again (`release()` is `reserve(0)`). `report(bytes)` records how much the run holds right now; the reporter keeps the peak and the estimator folds it into the run's observation when the run ends, never below the measured share.
- Reports can only raise an observation, never lower it: the measured attribution stays the ground truth and catches tasks that report nothing or report too little, because a task cannot see what the client, the decoder and the transport allocate on its behalf.
- The `task-run` event gains `kibana.task.memory_reported_bytes` next to the measured `memory_bytes`, so the two signals can be compared per task type; the persisted `memoryEstimate` on the task document uses the folded value, so a report reaches every node through the existing seed.
- `_health` and OTel report how many running tasks hold a reservation, the reserved total, and how many runs reported in the last window.
- Kill switch: `xpack.task_manager.adaptive_capacity.task_reports: false` makes both calls no-ops; with a numeric `capacity` the reporter is always a no-op, so the default path stays byte-identical. Task code keeps calling the reporter unconditionally.
- Out of scope: the alerting v2 and workflows call sites (each team wires its own, after this lands; the alerting v2 query service is the first candidate since it already counts response bytes), a definition-level static hint, enforcing a reservation (a run that exceeds what it reserved is not cancelled), worker-thread isolation with `resourceLimits` (a separate project that overlaps with https://github.com/elastic/response-ops-team/issues/846).

## Capabilities

### New Capabilities
- `task_manager/task-memory-reporting`: the run-context reporter, how reservations enter the budget, how reports are folded into estimates, their observability and the kill switch.

### Modified Capabilities
- `task_manager/memory-estimates`: the event log and the persisted estimate carry the folded value and the reported bytes.

## Impact

- `server/task.ts`: `RunContext.memory: TaskMemoryReporter` (`reserve`, `release`, `report`); a no-op implementation for fixed mode and for the kill switch.
- `server/task_running/task_runner.ts`: creates the reporter per run, hands it to the task, passes the peak report and the final reservation to `observeRunEnd`; `kibana.task.memory_reported_bytes` in the `task-run` event.
- `server/lib/adaptive_capacity/task_memory_estimator.ts`: `finalizeRun` takes the reported peak and folds `max(reported, measured)`; `adaptive_capacity_controller.ts`: the projection adds `max(0, reserved − estimate)` per running task and the memory gate's running sum sees it at claim time; health state and OTel gauges.
- `server/task_pool/task_pool.ts` or the runner: where the live reservation per running task is kept so the controller can read it with `getRunningTasks()`.
- `server/config.ts`: `adaptive_capacity.task_reports` (default `true`).
- `x-pack/platform/plugins/shared/event_log/generated/*`: `kibana.task.memory_reported_bytes` (long).
- Measurement: the benchmark harness runs the heavy alerting v2 workload with the Arrow response format (change `tm-adaptive-capacity` task 6.11 counts the external bytes; this change makes the first run of each rule budgeted by a reservation instead of the default) and compares against the 2026-11-06 Arrow leg: heap and RSS peak on the first herd, heavy pickup p99, and the gap between `memory_bytes` and `memory_reported_bytes` per rule. Unit tests cover the reporter, the fold, the projection and the kill switch.
