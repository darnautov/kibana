## Context

Task Manager reads the heap limit once at start, only to pick the ECH default. `create_managed_configuration.ts` moves capacity only on Elasticsearch errors. The pool (`CostCapacity`) and the mget claimer both consume a single `capacity$` observable, which is the seam this change uses: the controller is one more producer feeding that observable, so health, metrics and the claimer follow without new plumbing.

## Decisions

### D1. Heap is the signal, read from V8 at every claim

`v8.getHeapStatistics()` costs about 2.5 µs, so the controller decides on a 1 s timer and again inside `getCapacity()` right before each claim. Core's ops metrics stream updates every 5 s, too slow for a 500 ms claim loop. Event-loop utilisation was rejected as the primary signal: in the OOM run ELU never exceeded 0.4 while the process died.

### D2. Budget arithmetic

`target = limit × heap_target_ratio` (0.75). `baseline` is an EWMA of used heap taken only when the pool is empty. `projected = max(used, baseline + Σ estimate(running))`. `budget = target − projected`. `freeSlots = floor(budget / bytesPerNormalTask)`, where `bytesPerNormalTask` is the p90 of the last 200 finished runs' bytes per cost unit. `capacity = clamp(runningSlots + freeSlots, min_capacity, max_capacity)`.

Rejected: a pure feedback loop (step +1 every 10 s while ELU/heap are under thresholds, as in the earlier PoC https://github.com/elastic/kibana/pull/262606). A herd of twenty 46 MB runs arrives within one claim cycle; a step controller reacts after the allocations, which is after the OOM.

### D3. Per-instance estimates with type fallback

Heavy and light alerting rules share one task type. A per-type estimate is dragged to the floor by frequent light runs and then waves a heavy herd through. Estimates are therefore keyed by task instance id (bounded map, 10k entries, insertion-order eviction), fall back to the type average, then to `default_bytes_per_task` (128 MB) for cold start. The estimate is an allocation footprint (positive heap deltas only), which over-counts live memory by roughly 2× and errs toward claiming less. GC-aware measurement is the follow-up.

### D4. Claims lower, the timer raises

A claim-time decision may only lower capacity; the timer raises it by at most `max_increase_per_decision` (5). Otherwise the ramp rate is tied to the poll interval and claim nudges.

### D5. Memory gate inside the claim

The mget claimer receives a `ClaimMemoryGate` (`budgetBytes`, `estimateBytes(taskId, taskType, cost)`) and admits candidates while the running sum fits. A candidate that fails only the memory check is skipped and the loop continues; a candidate that fails the cost check still ends the cycle (existing starvation guard). The first candidate of a cycle is always admitted so a task heavier than the whole budget cannot starve. Measured: ending the cycle on a memory rejection cost light rules 11 % of their runs and 5 s pickup p99.

### D6. Composition with Elasticsearch backoff

The pressure scan starts from the ceiling, so it is applied as a ratio: `effective = floor(heapCapacity × pressureCapacity / ceiling)`, floored at the largest task cost. Backpressure detection reads the pressure scan only, otherwise adaptive scale-down would look like Elasticsearch pressure and suppress claim nudges.

### D7. Serverless: many identical 1 GB nodes, so the signal matters more than the number

Serverless runs dedicated background-task nodes, all 1 GB, autoscaled horizontally (6 today, 16 planned). Most project types leave capacity at the default 10; the security project sets 20 on the same 1 GB nodes. There the controller's job is not to find a bigger number but to (a) keep one herd from killing a node and (b) report honestly to the autoscaler. The autoscaler is kibana-controller (https://github.com/elastic/kibana-controller): its HPA scales the background-tasks deployment on `kibana.background_task_utilization.stats.value.load`, the `.stats.value.load` field of `/api/task_manager/_background_task_utilization` scraped as a pod metric, with `.stats.value.autoscaling.load` (load capped while Elasticsearch is under pressure) pending from https://github.com/elastic/response-ops-team/issues/685. `load` is running cost over the capacity currently in effect. With adaptive capacity, `load` is computed against the heap-driven capacity, so a heap-limited node reports high load and the autoscaler adds nodes, which is the right remedy for a memory-bound fleet; a light workload lets capacity rise, load falls and nodes are released. A heap-driven reduction must not be treated like Elasticsearch backpressure (which holds autoscaling because more Kibana nodes make a struggling cluster worse): `es_backpressure_active` stays tied to the Elasticsearch-pressure scan only. At 1 GB the budget is ~450 MB, so the capacity number mostly sits at `min_capacity` and the per-task claim gate carries the behaviour; the floor should follow the largest registered task cost rather than a fixed 5.

### D8. Light runs bypass the heap budget

On the mixed workload the capacity number sat at the floor during each heavy herd and two heavy runs held most of it, so cheap rules queued behind them although each needs ~1 MB (pickup p99 ~5 s vs ~1 s fixed). Runs estimated at or below `adaptive_capacity.light_task_bytes` (8 MB) are admitted against capacity only and do not consume the heap budget; the controller keeps `light_task_slots` (10) open beyond the running set whenever the heap budget is exhausted. Heavy candidates still wait for budget, and with no budget left none is admitted (the "first candidate always admitted" rule now requires budget > 0). `load` for autoscaling is computed against this capacity, so a heap-limited node reports a lower load than before; the claim log's heap-limited counter and `heap_budget_bytes` carry the memory-bound signal.

### D9. Live-heap calibration of the estimates

The attribution counts allocation (positive heap deltas), which measured ~2× the live peak. A `PerformanceObserver` on V8 garbage-collection entries feeds the heap used right after each major collection to the estimator; the ratio of live growth to allocated growth over the same period (re-estimated every 256 MB of allocation, EWMA, floored at 0.1) scales every learned estimate and the slot size. Cold-start defaults are not scaled. The ratio is exposed as `heap_live_ratio` in health and as an OTel gauge. Rejected: forcing GC or `--expose-gc` (not available in production), and heap snapshots (far too expensive per decision).

## Observability

- `_health` → `stats.configuration.value.capacity.mode` (`fixed` | `auto`) and `adaptive_capacity` (heap used/limit/target/baseline/projected/budget, bytes per task, running cost, free slots, decisions, last trigger, top-10 per-type estimates).
- OTel observable gauges under `kibana.task_manager.adaptive_capacity.*` (capacity, heap.budget, heap.projected, slot.memory, task_type.memory by `task.type`).
- Debug log per capacity change with the full arithmetic; the claim debug line gains `heap budget / planned / heap limited`.

## Risks

- Over-estimation makes the node conservative on mixed workloads (measured 2–3 s p99 tax at 0.75, ~1 s at 0.82). Mitigation: ratio is configurable; GC-aware estimates next.
- If the idle baseline alone exceeds the target the node pins at `min_capacity`; same trade-off as today's Elasticsearch backoff floor.
- Attribution across many concurrent runs is approximate; per-instance EWMA smooths it.
