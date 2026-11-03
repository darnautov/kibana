## 1. Configuration

- [x] 1.1 `server/config.ts`: accept `capacity: 'auto'` next to the numeric range; add `adaptive_capacity` block (`min_capacity`, `max_capacity`, `heap_target_ratio`, `default_bytes_per_task`, `max_increase_per_decision`, `decision_interval`) with min ≤ max validation. Verified by `config.test.ts` (snapshots updated).
- [x] 1.2 `server/lib/create_managed_configuration.ts`: `isAdaptiveCapacity`, starting capacity = ceiling in auto mode. Verified by `create_managed_configuration.test.ts`.

## 2. Estimator and controller

- [x] 2.1 `server/lib/adaptive_capacity/task_memory_estimator.ts`: cost-weighted attribution, per-instance and per-type EWMA, p90 slot sizing, bounded instance map. Verified by `task_memory_estimator.test.ts`.
- [x] 2.2 `server/lib/adaptive_capacity/adaptive_capacity_controller.ts`: budget arithmetic, tick and claim triggers, ramp rules, `memoryGate()`, state for health. Verified by `adaptive_capacity_controller.test.ts`.

## 3. Wiring

- [x] 3.1 `server/task_pool/task_pool.ts`: `getRunningTasks()` and `onTaskEnded` hook; mark-as-running failures are not observations. Verified by `task_pool.test.ts`.
- [x] 3.2 `server/polling_lifecycle.ts`: controller construction, `min`/ratio composition with the pressure scan, claim-time refresh, timer start/stop guards, telemetry registration. Verified by `polling_lifecycle.test.ts`.
- [x] 3.3 `server/task_claimers/strategy_mget.ts` and `queries/task_claiming.ts`: `ClaimMemoryGate`, skip-on-memory, heap-limited counter. Verified by `strategy_mget.test.ts`.

## 4. Observability

- [x] 4.1 `server/monitoring/configuration_statistics.ts`: `capacity.mode`, `adaptive_capacity` state; fixtures and the FTR health expectation updated.
- [x] 4.2 `server/otel/adaptive_capacity_telemetry.ts`: observable gauges.

## 5. Evidence

- [x] 5.1 Benchmark scripts and README under `scripts/benchmark/`.
- [x] 5.2 Fixed 10 vs fixed 20 vs auto on the heavy workload; fixed 10 vs auto on the mixed workload. Results in the On Week write-up.
- [ ] 5.3 Serverless-profile leg: lean build (`--serverless=es` against a serverless Elasticsearch) with the `background_tasks` node role at a 1 GB heap, the fixed size of serverless background nodes. The full dev build needs more than 1 GB just to start, so this leg cannot reuse the stateful setup. Expect the 128 MB cold-start estimate and the `min_capacity` floor of 5 to matter more than on 2 GB: with ~450 MB of budget the capacity number pins at the floor and the per-task claim gate does the real work, so verify that path and whether the floor should follow the largest task's cost instead of 5.
- [ ] 5.4 4 GB-heap leg (ECH-sized node) to show scale-up above fixed 10.

## 6. Hardening before a pull request

- [ ] 6.1 GC-aware estimation (heap after GC via `perf_hooks` GC observer) or task-reported hints.
- [ ] 6.2 Docs: `docs/reference/configuration-reference/task-manager-settings.yml`, docker environment allowlist.
- [ ] 6.3 FTR scenario with `capacity: auto` asserting the health block and that a numeric capacity is unchanged.
- [ ] 6.4 Decide whether heap-limited leftovers should count toward `tasksLeftUnclaimed` (utilisation and poll-interval signals).
- [ ] 6.5 Serverless autoscaling: confirm with the kibana-controller owners that heap-driven `load` (`.stats.value.load` of `_background_task_utilization`, scraped as `kibana.background_task_utilization.stats.value.load`) triggers scale-out and is not capped by the pending Elasticsearch-pressure hold (`.stats.value.autoscaling.load`); add a unit test for the utilization stat under adaptive capacity. No kibana-controller change in this On Week. Note the security project's `xpack.task_manager.capacity: 20` on 1 GB nodes in `config/serverless.security.yml`.
- [ ] 6.6 Floor: make `min_capacity` default to the largest registered task cost instead of a fixed 5 so 1 GB nodes are not pinned above their budget.
