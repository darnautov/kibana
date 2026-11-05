# Proposal

## Why

Adaptive capacity (https://github.com/elastic/response-ops-team/issues/840, change `tm-adaptive-capacity`) learns the heap cost of every task instance, but only in process memory. Every restart, deploy and new background node starts from an empty estimator: each unseen instance is priced at `default_bytes_per_task` (128 MB), which is above the light threshold, so after a restart even the sixty cheap rules of the mixed benchmark queue behind the heap budget and the overdue backlog drains two or three tasks at a time until every instance has run once. On the 1280 MB node this costs the first minutes after every start (the benchmark windows skip them with `--skip-minutes`), and three nodes learn the same rule three times.

## What Changes

- In adaptive mode, when a recurring task's run ends, Task Manager writes the run's heap estimate to the task document (`memoryEstimate: { bytes, samples, updatedAt }`) inside the partial update it already performs, so the estimate costs no extra request and is shared by every node that claims the task.
- The claim cycle reads `memoryEstimate` from the candidate documents it already fetches and seeds the in-process estimator with it before admission, so a task that has ever run is budgeted by its own history on the first claim after a restart and on any node, and a known light task bypasses the heap budget immediately.
- The `task-run` event log event gains `kibana.task.memory_bytes` (the same estimate), so the history is queryable for the health capacity-estimation model and for benchmarks.
- Found while measuring the first start: with the cheap rules due first, the type's recent window held only light runs and the twenty unseen heavy rules were priced at 3.9 MB and admitted together (OOM at 22 s on 1280 MB). An unseen instance is now never priced below `default_bytes_per_task`; the type history can only raise it.
- Kill switch: `xpack.task_manager.adaptive_capacity.persist_estimates: false` stops both the write and the seed. With a numeric `capacity` nothing is written or read, so the default path stays byte-identical.
- Out of scope: reordering the overdue backlog by known cost (changes claim fairness between light and heavy tasks; with persisted estimates known-light tasks already bypass the budget within the fetched page, so measure first), seeding the per-type prior from the event log at start (the task document carries the estimate for every task that has run, which covers the restart case), task-reported memory hints from alerting v2, non-recurring tasks (their document is deleted when the run ends).

## Capabilities

### New Capabilities
- `task_manager/memory-estimates`: how the heap estimate of a task instance is persisted on its document, restored at claim time, recorded in the event log, and switched off.

### Modified Capabilities
- (none) `task_manager/capacity` keeps its requirements; the lookup order of the in-process estimate (own history, type, default) is unchanged, this change only fills "own history" from the document.

## Impact

- `server/saved_objects/schemas/task.ts`, `server/saved_objects/model_versions/task_model_versions.ts`: model version 15 adds the optional, unindexed `memoryEstimate` attribute (no mapping change). The attribute stays outside the encrypted saved object's AAD so a partial update of it never needs decryption.
- `server/task.ts`, `server/task_store.ts`: type and partial-update plumbing; the claim candidate search must keep the attribute in `_source`.
- `server/task_running/task_runner.ts`: asks the controller for the ending run's estimate, writes it into the recurring-task partial update and into the `task-run` event.
- `server/lib/adaptive_capacity/task_memory_estimator.ts` and `adaptive_capacity_controller.ts`: `seed()` and a run-end observation that returns the bytes.
- `server/task_claimers/strategy_mget.ts`: seeds the gate from `memoryEstimate` on each candidate before admission.
- `x-pack/platform/plugins/shared/event_log/generated/*`: `kibana.task.memory_bytes` (long).
- `server/config.ts`: `adaptive_capacity.persist_estimates` (default `true`).
- Measurement: the benchmark harness restarts a 1280 MB background node against the mixed workload (20 heavy, 60 light, 20 workflows, all overdue) with and without the setting, and compares the first three minutes: minutes until the overdue count returns to its steady state, light and heavy pickup p99 in minute 1, heap peak, and the number of candidates the claim log reports as heap-limited. Unit tests cover the schema, the seed, the write and the kill switch.
