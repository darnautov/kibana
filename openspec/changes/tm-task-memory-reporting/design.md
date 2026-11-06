## Context

Adaptive capacity measures memory at the process level: `AdaptiveCapacityController` samples V8 statistics on a timer and before each claim, `TaskMemoryEstimator` attributes growth to the runs in flight by cost share, and the mget claimer admits candidates against the resulting budget. The runner already hands each task a `RunContext` (`taskInstance`, `fakeRequest` or `runAs`, `signal`) and already calls `observeRunEnd` when a run finishes, which returns the bytes written to the task document and the event log. This change adds one object to the run context and threads two numbers through the seams that exist.

## Decisions

### D1. Two calls, no definition-level hint

`reserve(bytes)` is for what a task knows before it allocates (a streaming task's batch size times batches in flight; a rule's configured row cap times row size). `report(bytes)` is for what a task can count as it goes (bytes received, buffers held). A static `memoryHint` on the task definition was rejected: the same type varies by an order of magnitude between instances and between runs, so a definition-level number is wrong most of the time, and persisted estimates already cover every instance that has run once.

### D2. Reports raise, never lower

The observation recorded for a run is `max(reportedPeak, measuredShare)`, then scaled by the live ratio like any other observation. A task cannot see what the Elasticsearch client, the Arrow decoder and the HTTP transport allocate on its behalf, and a wrong low report would be persisted on the document and trusted by every node. Measured attribution therefore stays the ground truth; reports fix the case where overlap makes attribution too diffuse. Rejected: trusting reports outright (one bad call site poisons the estimates fleet-wide), and weighting reports into the EWMA (a report below the measured share would still pull the average down).

### D3. Reservations enter the projection, not the estimate

A reservation is a statement about the current run only, so it is not learned. The controller's projection becomes `baseline + Σ max(estimate(task), reserved(task))` over the running set, and the claim gate's running sum starts from the same figure. The reservation lives on the running-task record the pool already keeps (`getRunningTasks()` returns it), is replaced by each call, and dies with the run. Rejected: holding reservations in the estimator (it is keyed by instance and would outlive the run) and cancelling runs that exceed their reservation (that is enforcement, which belongs with the quarantine work in https://github.com/elastic/response-ops-team/issues/846).

### D4. Reporter is created per run by the runner

`TaskManagerRunner` builds a `TaskMemoryReporter` for each run and passes it as `context.memory`. The field is optional on `RunContext` only because some two hundred test fixtures across Kibana build a context by hand; Task Manager always sets it, and task code uses `memory?.report()` rather than checking the mode. In fixed mode, or when `adaptive_capacity.task_reports` is `false`, it builds the no-op reporter, so task code is identical in every mode and the fixed path adds one object allocation per run and nothing else. At run end the runner passes the peak report to `observeRunEnd` together with the snapshot it already builds, and writes `kibana.task.memory_reported_bytes` to the `task-run` event when a report exists.

### D5. First consumers

Alerting v2's query service already receives `maxResponseSize` and counts bytes for its response-size guard; reporting the running count after each Arrow batch and reserving `rules.run.alerts.max × observed row size` before the query is a small change on their side. Workflows can report the size of the step outputs they hold. Both call sites are owned by their teams and are not part of this change.

## Observability

- `_health` → `adaptive_capacity.reservations: { tasks, bytes }` and `adaptive_capacity.reported_runs` (since the node started).
- OTel gauges `kibana.task_manager.adaptive_capacity.reservation.bytes` and `.reservation.tasks`.
- Event log `kibana.task.memory_reported_bytes` next to `memory_bytes`.
- Claim debug line gains `reserved` beside `heap budget / planned / heap limited / seeded`.

## Risks

- A task that reserves far too much starves the node of heavy work; mitigated by the kill switch and by health showing who holds reservations.
- A reporter call after the run has ended (a leaked promise) must be ignored, not attributed to the next run; the reporter is closed when the runner processes the result.
- Report and reservation are per run, so a task that calls `reserve` in a shared helper on every query must not accumulate; the replace-not-add semantics make the last call win.
