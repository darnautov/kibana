## Context

The estimator (`TaskMemoryEstimator`) keys estimates by task instance id in a bounded in-memory map, so its knowledge dies with the process and is never shared between nodes. The two seams this change uses already exist: the mget claimer fetches candidate documents with `_source` (minus the credential fields in `CLAIM_CANDIDATE_SOURCE_EXCLUDES`) and the task runner performs one `bufferedTaskStore.partialUpdate` when a recurring run ends. Adding an attribute to the task document therefore costs no read and no write. The `task` saved object is an encrypted type; the new attribute must stay outside the AAD so that a partial update of it never requires decrypting the document.

## Goals / Non-Goals

- Goals: warm start after restart; estimates shared across nodes; queryable memory history in the event log; a per-setting kill switch; the fixed-capacity path untouched.
- Non-goals: reordering the backlog by cost, event-log seeding at start, task-reported hints, non-recurring tasks, anything that needs an index mapping on the task document.

## Decisions

### D1. The task document is the store, not the event log

The claim already has the document in hand; reading the estimate from it is free and works for every node. The event log is async, index-lifecycle managed and may be disabled, so it cannot be the source the claimer depends on. It gets the same number as a `long` field for queries and the heap-seconds health model. Rejected: an estimator-state saved object per node (another write path, not shared); a cross-node gossip through `background_task_node` documents (no per-instance granularity).

### D2. Unindexed attribute, model version 15 without a mapping change

`memoryEstimate: { bytes: number, samples: number, updatedAt: string }` is added to `taskSchemaV15` with `forwardCompatibility` ignoring unknowns, like versions 10–13; `changes: []`, so no mapping is added and `dynamic: false` keeps it out of the index. Nothing needs to query it. `bytes` is the instance's moving average per run (not per cost unit), already scaled by the live ratio, so a node reads it without knowing the writer's calibration.

### D3. Run-end observation moves to the task runner

Today the pool's `onTaskEnded` finalises the run after the run promise settles, which is after the partial update. The runner instead asks the controller `observeRunEnd(snapshot)` at `processResult` time; the controller samples the heap with the run still counted as running, finalises it and returns the bytes and the instance's updated average. `onTaskEnded` stays as the fallback for runs that end without a result (cancellation, failures before `processResult`); a second finalisation of the same execution id is a no-op. The runner then writes `memoryEstimate` into the recurring-task partial update and `kibana.task.memory_bytes` into the `task-run` event. The runner gets the callback through the `TaskRunner` options from `polling_lifecycle.ts`; in fixed mode it is undefined and no code path changes.

### D4. Seeding, not overriding

`TaskMemoryEstimator.seed(taskId, taskType, bytes, samples)` inserts an instance entry only when none exists; the per-type ring is not fed by seeds so a restart does not replay stale history into the type percentile. The claimer calls `memoryGate.seed(candidate)` for every candidate that carries the attribute before `estimateBytes`. The gate's `estimateBytes` is otherwise unchanged (own history, then type p90, then default).

### D5. Kill switch and compatibility

`adaptive_capacity.persist_estimates` (default `true`) guards the write and the seed together. `capacity: <number>` never constructs the controller, so neither happens. Older Kibana versions drop the attribute on their next full write; this version tolerates documents without it. Rejected: making the write unconditional in auto mode (no way to turn off a new write path in production without the kill switch the project rules require).

### D7. The type history only raises an unseen instance's estimate

The first measured start on 1280 MB died at 22 s: the sixty light rules were due first, the type window (32 recent runs) held nothing but them, its p90 was 3.9 MB, and all twenty unseen heavy rules fell under `light_task_bytes` and bypassed the budget. The v9 rule (type p90 instead of the type average) only works once a heavy run is in the window. `estimateBytes` now returns `max(type p90 × ratio, default)` for an instance without history, so a fresh node drains unseen tasks a budget's worth at a time, which is slow but survives; a seeded or observed instance uses its own value. Rejected: excluding light runs from the type window (a type that is genuinely light would then be priced at the default forever); waiting for N heavy samples before trusting the type (the same race, just later).

### D6. Backlog ordering stays out

With seeds, known-light candidates already bypass the budget inside the fetched page and the heavy ones are skipped, not blocking; reordering heavy behind light would change fairness between task types and needs its own measurement. Noted as a follow-up in the On Week write-up.

## Observability

- `_health` `adaptive_capacity` gains `seeded_instances` (count of instances seeded from documents since start) next to `estimates`, so a warm start is visible.
- The claim debug line gains `seeded: N`.
- `kibana.task.memory_bytes` in the event log; the benchmark summariser reads it to report bytes p50/p99 per task type.
- OTel: no new instrument; the existing `task_type.memory` gauge reflects seeded instances once they run.

## Risks

- A stale `memoryEstimate` after a rule was edited to read more data under-budgets the first run; the in-process observation replaces it after that run, and the claim gate still bounds admission by the budget.
- `updatedAt` is informational; no expiry is applied in this change.
- The event log mapping change touches a shared plugin; it is additive and the generated files are produced by the plugin's own script.
