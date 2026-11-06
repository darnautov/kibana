## ADDED Requirements

### Requirement: Heap-driven capacity

When `xpack.task_manager.capacity` is `auto`, Task Manager SHALL compute capacity from heap headroom instead of a fixed number: the free heap below `heap_target_ratio × heap limit`, after the idle baseline and the heap the running tasks are expected to need, divided by the learned heap cost of one normal task, plus the slots already in use, clamped to `adaptive_capacity.min_capacity..max_capacity`.

#### Scenario: idle node

- **WHEN** no tasks are running, used heap is 1.0 GB, the heap limit is 2.0 GB, the target ratio is 0.75 and the learned cost is 100 MB per normal task
- **THEN** capacity is 5 free slots (500 MB of budget), subject to the ramp limit

#### Scenario: heap above target

- **WHEN** used heap exceeds the target
- **THEN** capacity equals the slots already in use, floored at `min_capacity`, so no new tasks are claimed until the heap drops

### Requirement: Decisions at claim time and on a timer

Task Manager SHALL re-evaluate adaptive capacity on every `decision_interval` tick and again immediately before each claim cycle. A claim-time decision SHALL only lower capacity; a timer decision SHALL raise it by at most `max_increase_per_decision` per tick and lower it without limit.

#### Scenario: herd lands between ticks

- **WHEN** the heap rises above the target between two ticks
- **THEN** the next claim cycle sees the reduced capacity before admitting tasks

#### Scenario: herd over

- **WHEN** the heap returns below the target
- **THEN** capacity rises by at most `max_increase_per_decision` per tick until the budget is used

### Requirement: Heap cost learned per task instance

Task Manager SHALL attribute heap growth between samples to the tasks running at that moment, weighted by cost, and SHALL fold each finished run's share into a moving average for that task instance and for its task type. The estimate for a task SHALL be its own average if it has run, else its type's average, else `adaptive_capacity.default_bytes_per_task`.

#### Scenario: heavy and light rules of one type

- **WHEN** a rule that reads 46 MB per run and a rule that reads 5 rows per run share the task type `alerting_v2:rule_executor`
- **THEN** each rule is budgeted with its own estimate on its next run, and a rule that has never run is budgeted with the type average

#### Scenario: run shorter than a sample interval

- **WHEN** a run starts and ends between two samples
- **THEN** the heap growth since the last sample is attributed to it when it ends, so it is not recorded as free

### Requirement: Claim admission within the heap budget

In adaptive mode, each claim cycle SHALL admit candidates while the sum of their estimates stays within the heap budget of the latest decision. A candidate that exceeds the remaining budget SHALL be left for a later cycle without ending the cycle; the first candidate of a cycle SHALL always be admitted.

#### Scenario: heavy herd inside a light mix

- **WHEN** the budget is 300 MB, the next candidates are three rules estimated at 128 MB each followed by twenty rules estimated at 1 MB each
- **THEN** two heavy rules and the twenty light rules are claimed and the third heavy rule waits

#### Scenario: task heavier than the budget

- **WHEN** the budget is 0 and the first candidate is estimated at 500 MB
- **THEN** that candidate is claimed and nothing else in that cycle

### Requirement: Light runs are bounded by capacity, not by the heap budget

A candidate whose estimated heap is at or below `adaptive_capacity.light_task_bytes` SHALL be admitted against capacity alone and SHALL NOT consume the heap budget. While the heap budget is exhausted, adaptive capacity SHALL keep at least `adaptive_capacity.light_task_slots` normal-cost slots open beyond the running set, and SHALL NOT admit heavy candidates.

#### Scenario: cheap rules during a heavy herd

- **WHEN** two heavy runs have exhausted the heap budget and sixty light rules come due
- **THEN** the light rules are claimed up to the open slots while further heavy rules wait for budget

#### Scenario: no budget left

- **WHEN** the heap budget is zero and the next candidate is heavy
- **THEN** it is not claimed in that cycle, even as the first candidate

### Requirement: Estimates are calibrated against live heap

Task Manager SHALL observe the heap used after each major garbage collection and SHALL scale the learned heap estimates by the ratio of live heap growth to allocated heap growth over the same period, re-estimated after every `256 MB` of allocation and never below `0.1`. Cold-start defaults SHALL NOT be scaled.

#### Scenario: transient garbage

- **WHEN** runs allocate 400 MB between two samples and the heap after the next major collection grew by 100 MB
- **THEN** the ratio moves toward 0.25 and a run previously estimated at 200 MB is budgeted at 50 MB

### Requirement: Elasticsearch pressure composes with adaptive capacity

In adaptive mode the Elasticsearch-pressure reduction SHALL apply as a ratio of the heap-driven capacity, floored at the cost of the largest task, so that a reduction takes effect in the next window rather than decaying from the ceiling.

#### Scenario: 429 while heap holds capacity at 10

- **WHEN** heap-driven capacity is 10 and a window contains Elasticsearch 429 errors
- **THEN** effective capacity becomes 8 in that window

### Requirement: Numeric capacity is unchanged

When `xpack.task_manager.capacity` is a number, Task Manager SHALL behave exactly as before this change: no heap sampling, no claim-time memory gate, and `adaptive_capacity.*` settings SHALL be ignored.

#### Scenario: kill switch

- **WHEN** an operator replaces `capacity: auto` with `capacity: 10` and restarts
- **THEN** capacity is fixed at 10 and the health endpoint reports `capacity.mode: fixed` and `adaptive_capacity: null`

### Requirement: Utilization reflects heap-driven capacity

The background task utilization reported for autoscaling SHALL compute `load` against the capacity currently in effect, so that a node whose capacity is reduced by heap pressure reports high utilization, and SHALL keep `es_backpressure_active` tied to Elasticsearch-pressure reductions only.

#### Scenario: heap-limited node

- **WHEN** the heap controller has reduced capacity to the running set and every slot is busy
- **THEN** utilization reports `load` of 100 and `es_backpressure_active` is false, so the autoscaler may add nodes

#### Scenario: Elasticsearch-limited node

- **WHEN** capacity is reduced by Elasticsearch 429 errors
- **THEN** `es_backpressure_active` is true regardless of the heap-driven value

### Requirement: Memory outside the V8 heap counts toward the budget

In adaptive mode Task Manager SHALL include the memory V8 tracks outside its heap (Buffers, ArrayBuffers and other external allocations) in the bytes it samples, so that a task's learned estimate covers the buffers it holds outside the heap and the projected total counts them.

#### Scenario: streaming task

- **WHEN** a run decodes a 300 MB streamed response into ArrayBuffers while used heap grows by 6 MB
- **THEN** the run's estimate reflects roughly 306 MB scaled by the live ratio, not 6 MB, and the budget for the next claim cycle is reduced accordingly

### Requirement: The container memory limit bounds capacity

When the process runs under a memory limit (the cgroup limit reported by Node, or `adaptive_capacity.memory_limit_bytes`), Task Manager SHALL keep a second budget of `memory_target_ratio × limit`, less the resident set size and the estimates of the running tasks, and SHALL admit candidates only within the smaller of the heap budget and the memory budget. Without a known limit the heap budget alone SHALL apply.

#### Scenario: external memory fills the pod

- **WHEN** the heap budget still has 400 MB free, the limit is 2 GiB, the resident set size is 1.9 GiB and the target ratio is 0.85
- **THEN** the memory budget is zero and no heavy candidate is admitted until the resident set size falls

#### Scenario: laptop without a limit

- **WHEN** Node reports no constrained memory and `memory_limit_bytes` is unset
- **THEN** capacity is computed from the heap budget exactly as before

## MODIFIED Requirements

### Requirement: Capacity is visible in the health endpoint

`GET /api/task_manager/_health` SHALL report the capacity currently in effect under `stats.configuration.value.capacity` with `config`, `as_workers`, `as_cost` and `mode` (`fixed` or `auto`), and in adaptive mode SHALL report the latest decision under `stats.configuration.value.adaptive_capacity` (heap used, external, limit, target, baseline, projected and budget in bytes; resident set size, memory limit, target and budget in bytes when a limit is known; bytes per normal task; running cost; free slots; decision count; last trigger; the ten largest per-type estimates). In fixed mode `adaptive_capacity` SHALL be `null`.

#### Scenario: health reflects a temporary reduction

- **WHEN** capacity has been reduced by Elasticsearch pressure to 8
- **THEN** the health endpoint reports `capacity.config: 8`

#### Scenario: health in adaptive mode

- **WHEN** capacity is `auto` and the controller has made a decision
- **THEN** the health endpoint reports `capacity.mode: auto` and the decision under `adaptive_capacity`
