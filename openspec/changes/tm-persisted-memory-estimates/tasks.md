## 1. Document schema and config

- [x] 1.1 `server/saved_objects/schemas/task.ts`: `taskSchemaV15` adds `memoryEstimate: schema.maybe(schema.object({ bytes, samples, updatedAt }))`; `server/saved_objects/model_versions/task_model_versions.ts`: version `15` with `changes: []`. Verified by `task_model_versions.test.ts` and `task.test.ts`.
- [x] 1.2 `server/task.ts`: `memoryEstimate` on `ConcreteTaskInstance` (and so on the partial and claim-candidate types); the `task` type is a plain saved object (no ESO registration, credentials are encrypted through the store's own client), `partialTaskInstanceToAttributes` passes the attribute through and the claim search does not exclude it. Verified by the claimer and runner tests.
- [x] 1.3 `server/config.ts`: `adaptive_capacity.persist_estimates` (boolean, default `true`). Verified by `config.test.ts` snapshots.

## 2. Estimator and controller

- [x] 2.1 `server/lib/adaptive_capacity/task_memory_estimator.ts`: `seed()` (instance only, no type ring), `finalizeRun(executionId)` returning `{ bytes, instanceBytes, samples }` and idempotent on a second call; `taskEnded` reuses it. Verified by `task_memory_estimator.test.ts`.
- [x] 2.2 `server/lib/adaptive_capacity/adaptive_capacity_controller.ts`: `observeRunEnd(snapshot)` (sample with the run still running, then finalise) and `seed()` passthrough on the memory gate; `seeded_instances` in the health state. Verified by `adaptive_capacity_controller.test.ts`.

## 3. Write path

- [x] 3.1 `server/task_running/task_runner.ts`: optional `observeRunEnd` in the runner options; call it in `processResult`; add `memoryEstimate` to the recurring-task partial update when `persist_estimates` is on; add `kibana.task.memory_bytes` to the `task-run` event. `server/polling_lifecycle.ts`: pass the callback in adaptive mode only. Verified by `task_runner.test.ts` (recurring writes, one-off does not, fixed mode untouched, kill switch) and `polling_lifecycle.test.ts`.
- [x] 3.2 `x-pack/platform/plugins/shared/event_log/generated/mappings.json` and `schemas.ts`: `kibana.task.memory_bytes` (long), added to `scripts/mappings.js` and mirrored by hand into the generated files in the generator's format because the generator needs an ECS checkout next to the repo; re-run `node x-pack/platform/plugins/shared/event_log/scripts/create_schemas.js` before the PR. Verified by the event log unit tests.

## 4. Read path

- [x] 4.1 `server/task_claimers/strategy_mget.ts`: seed the gate from each candidate's `memoryEstimate` before admission; `seeded` in the claim debug line. Verified by `strategy_mget.test.ts` (seeded light bypasses the budget, seeded heavy is budgeted, local observation wins, `persist_estimates: false` ignores the attribute).
- [x] 4.2 `server/monitoring/configuration_statistics.ts` and fixtures: `seeded_instances`. Verified by `configuration_statistics.test.ts` and the health FTR expectation.

## 4b. Cold-start fix

- [x] 4b.1 `server/lib/adaptive_capacity/task_memory_estimator.ts`: unseen instances priced at `max(type p90 × ratio, default)`. Verified by `task_memory_estimator.test.ts` ("prices an unseen instance at the default while only cheap instances of its type have run"). Evidence: `bench/multi/samples/v10a-first-start-typefallback-bg1.ndjson` and `bench/multi/logs/bg1-auto-1280-v10a-first-start-oom.log` (OOM at 22 s, 62 light runs, type estimate 3.9 MB, heap 762 → 956 MB in 3 s).

## 5. Evidence

- [x] 5.1 Benchmark: cold restart of one `auto` background node at 1280 MB against the mixed workload with all 100 tasks overdue, four minutes per leg (`bench/multi/cold_start.sh`, `cold_start_stats.py`, chart `10_cold_start_backlog.png`). Done 2026-11-05: backlog served 50 % / 90 % / all at 87 / 115 / 131 s on a first start with nothing on the documents, 22 / 67 / 83 s on a restart with `persist_estimates: false` (0 seeded, nothing written), 2 / 11 / 23 s on a restart with persisted estimates (112 seeded). Heavy pickup p99 in the first minute: backlog vs 48 s; light runs in the first minute 0 vs 705; heap peak 983 / 1052 / 1055 MB; 100 % success in all legs. The first kill-switch leg came back seeded (the switch only guarded the write): fixed in the controller and rerun on a rebuilt node.
- [x] 5.2 `scripts/benchmark/summarize_samples.ts`: bytes p50/p99 per task type from `kibana.task.memory_bytes`.
