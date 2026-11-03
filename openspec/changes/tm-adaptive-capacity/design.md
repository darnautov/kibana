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

## Observability

- `_health` → `stats.configuration.value.capacity.mode` (`fixed` | `auto`) and `adaptive_capacity` (heap used/limit/target/baseline/projected/budget, bytes per task, running cost, free slots, decisions, last trigger, top-10 per-type estimates).
- OTel observable gauges under `kibana.task_manager.adaptive_capacity.*` (capacity, heap.budget, heap.projected, slot.memory, task_type.memory by `task.type`).
- Debug log per capacity change with the full arithmetic; the claim debug line gains `heap budget / planned / heap limited`.

## Risks

- Over-estimation makes the node conservative on mixed workloads (measured 2–3 s p99 tax at 0.75, ~1 s at 0.82). Mitigation: ratio is configurable; GC-aware estimates next.
- If the idle baseline alone exceeds the target the node pins at `min_capacity`; same trade-off as today's Elasticsearch backoff floor.
- Attribution across many concurrent runs is approximate; per-instance EWMA smooths it.
