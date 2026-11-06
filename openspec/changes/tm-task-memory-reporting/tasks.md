## 1. Reporter and config

- [x] 1.1 `server/task.ts`: `TaskMemoryReporter` interface (`reserve(bytes)`, `release()`, `report(bytes)`) and `RunContext.memory`; `server/task_running/task_memory_reporter.ts`: live implementation (peak of reports, current reservation, closed after the run) and no-op implementation. Verified by `task_memory_reporter.test.ts`.
- [x] 1.2 `server/config.ts`: `adaptive_capacity.task_reports` (boolean, default `true`). Verified by `config.test.ts` snapshots.

## 2. Runner and pool

- [x] 2.1 `server/task_running/task_runner.ts`: build the reporter per run (no-op in fixed mode or with `task_reports: false`), pass it as `context.memory`, close it in `processResult`, pass the reported peak to `observeRunEnd`, add `kibana.task.memory_reported_bytes` to the `task-run` event when a report exists. Verified by `task_runner.test.ts` (report reaches the event and the controller; no-op in fixed mode; call after the run is ignored).
- [x] 2.2 `server/task_pool/task_pool.ts`: the running-task record exposes the current reservation so `getRunningTasks()` carries it. Verified by `task_pool.test.ts`.

## 3. Estimator and controller

- [x] 3.1 `server/lib/adaptive_capacity/task_memory_estimator.ts`: `finalizeRun(executionId, reportedBytes?)` records `max(reported, measured)`. Verified by `task_memory_estimator.test.ts` (report above, report below, no report).
- [x] 3.2 `server/lib/adaptive_capacity/adaptive_capacity_controller.ts`: projection and memory gate use `max(estimate, reserved)` per running task; `reservations` and `reported_runs` in the state. Verified by `adaptive_capacity_controller.test.ts` (reservation above the estimate cuts the budget on the next decision; release restores it; reservation below the estimate is ignored).

## 4. Observability

- [x] 4.1 `server/monitoring/configuration_statistics.ts` and fixtures, `server/otel/adaptive_capacity_telemetry.ts`: reservation gauges and `reported_runs`; FTR health expectation. Verified by `configuration_statistics.test.ts` and the health FTR suite.
- [x] 4.2 `x-pack/platform/plugins/shared/event_log/scripts/mappings.js` and generated files: `kibana.task.memory_reported_bytes` (long). Verified by the event log unit tests.
- [x] 4.3 `scripts/benchmark/summarize_samples.ts`: reported vs measured bytes p50/p99 per task type (`bench/multi/window_stats.py` covers the per-window comparison from the event log).

## 5. Evidence

- [ ] 5.1 Benchmark: heavy alerting v2 workload with the Arrow response format on a 1280 MB node, with a local patch of the alerting v2 query service reserving `max alerts × observed row size` and reporting received bytes per batch, compared with the 2026-11-06 Arrow leg (`bench/multi/stats/windows.json` `v11-arrow`): first-herd heap and RSS peak, heavy pickup p99, and the per-rule gap between `memory_bytes` and `memory_reported_bytes`.
- [ ] 5.2 Hand the call-site patch to the alerting v2 owners as a proposal (not part of this change). The patch is the separate commit "[alerting_v2] Report streamed ES|QL bytes to Task Manager" on the branch: `formats/types.ts` `onBytes` on the format options (kept off the transport options), `arrow_format.ts` reports `batch.data.byteLength`, `query_service.ts` passes it through, `execute_rule_query_step.ts` reports the running total and reserves `min(maxResponseSize, bytes per row × row limit)` after the first batch, `task_run_scope_service/create_task_runner.ts`, `rule_executor/task_runner.ts` and `execution_pipeline.ts` thread `memory` from the run context (the scope service narrows the context, which is where the first benchmark attempt lost the reporter). Unit tests in `arrow_format.test.ts` and `execute_rule_query_step.test.ts`.
