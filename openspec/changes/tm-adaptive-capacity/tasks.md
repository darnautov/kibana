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
- [x] 5.3 1 GB background node leg, locally, from a production build (`node scripts/build --skip-os-packages --skip-archives --skip-cdn-assets --skip-docker-contexts`) against an Elasticsearch 9.7.0 snapshot, one `[ui]` node plus `[background_tasks]` nodes started with `NODE_OPTIONS=--max-old-space-size=819`, the figure kibana-controller gives a 1 GiB serverless pod (80 % of the memory request). Launch scripts under `bench/multi/` (git-excluded). Findings so far, 2026-11-04: fixed 10 dies of heap exhaustion 30 s after start, twice; v7 `auto` dies after 40 s at 819 MB and after 19 s at 1024 MB (idle heap after startup is 636 MB; V8 reports a limit 192 MB above the old-space cap; the first heavy candidate was admitted regardless of budget). Fixed in 6.8; rerun with the fix, then add a second and third background node and compare per-node load, capacity and heap. Done 2026-11-05: v8 at 819 MB stays up with no budget (idle live heap 610 MB); v9 at 1280 MB ran 15 h unattended, 670k runs, 100 % success, 0 restarts (heavy pickup p99 2.8 s, light 0.53 s).
- [x] 5.4 Multi-node distribution: two and three `auto` background nodes on 819 MB against the mixed workload, sampled per node (`bench/multi/sample_node.sh`), summarised with `summarize_samples.ts` per node and with `--all-nodes`. ECH was dropped: without autoscaling it behaves like a single local node, and the plan validator rejects `auto` (6.7). A real QA serverless project still needs a PR-built image and stays a follow-up. Done 2026-11-05: three `auto` nodes at 1280 MB, 10-minute window, 100 % success, totals heavy 20.1/min pickup p99 1.77 s, light 719/min 0.79 s, workflows 20/min 1.85 s; the 59/36/5 % split between nodes is partitioning, not the controller. Node-loss test recorded in the vault note.

## 6. Hardening before a pull request

- [x] 6.1 GC-aware calibration: `perf_hooks` GC observer feeds post-major-GC heap to the estimator; live-to-allocated ratio scales estimates (`heap_live_ratio` in health + OTel). Task-reported hints remain a follow-up.
- [x] 6.1a Light runs bypass the heap budget (`light_task_bytes`, `light_task_slots`); heavy candidates wait when the budget is exhausted. Verified by `strategy_mget.test.ts` and `adaptive_capacity_controller.test.ts`.
- [ ] 6.2 Docs: `docs/reference/configuration-reference/task-manager-settings.yml`, docker environment allowlist.
- [ ] 6.3 FTR scenario with `capacity: auto` asserting the health block and that a numeric capacity is unchanged.
- [ ] 6.4 Decide whether heap-limited leftovers should count toward `tasksLeftUnclaimed` (utilisation and poll-interval signals).
- [ ] 6.5 Serverless autoscaling: confirm with the kibana-controller owners that heap-driven `load` (`.stats.value.load` of `_background_task_utilization`, scraped as `kibana.background_task_utilization.stats.value.load`) triggers scale-out and is not capped by the pending Elasticsearch-pressure hold (`.stats.value.autoscaling.load`); add a unit test for the utilization stat under adaptive capacity. No kibana-controller change in this On Week. Note the security project's `xpack.task_manager.capacity: 20` on 1 GB nodes in `config/serverless.security.yml`.
- [ ] 6.6 Floor: make `min_capacity` default to the largest registered task cost instead of a fixed 5 so 1 GB nodes are not pinned above their budget.
- [ ] 6.7 Elastic Cloud Hosted: the plan validator rejects `xpack.task_manager.capacity: auto` ("has to be a number between [5, 50] inclusive", checked against the QA API on 2026-11-03). Before `auto` can be offered on ECH the setting's validation in the cloud allowlist must accept the literal, as was done for `xpack.alerting_v2.*` in https://github.com/elastic/cloud/pull/158858. Serverless has no user-facing override, so the serverless default is a Kibana-repo decision (`config/serverless.yml`).
- [x] 6.8 Small-heap survival (found on the 819 MB leg): size the target against the old-space cap read from `--max-old-space-size` (V8's `heap_size_limit` is 192 MB higher), admit a heavy run only when its estimate fits the remaining budget (no first-heavy exception), and take the idle baseline from the heap right after each major collection net of the running estimates instead of waiting for an empty pool. Verified by `adaptive_capacity_controller.test.ts` and `strategy_mget.test.ts`.
- [ ] 6.9 Count committed heap: on the 819 MB node the v8 build with `heap_target_ratio: 0.9` died with 730 MB used because `total_heap_size` had reached 901 MB (fragmentation, pooled pages). Project from `max(used_heap_size, total_heap_size - reclaimable)` or lower the target by the observed used-to-committed gap, and verify on a 2 GB node that it does not strangle capacity.
