## Why

`xpack.task_manager.capacity` is a static guess made at install time. The right value depends on what the tasks do and how much heap the node has, and neither is known when the number is chosen. On a 2 GB node with twenty alerting v2 rules that each read 46 MB per run, capacity 10 is stable for 19 hours, capacity 20 kills Kibana with an out-of-memory fatal four seconds after Task Manager starts. Memory-heavy task types (alerting v2 rules, workflows) make this gap wider every release. Operators cannot read the safe number off a config reference, and Task Manager does not look at memory at runtime at all.

## What Changes

- Add `xpack.task_manager.capacity: auto`. The node sizes its own capacity from heap headroom: a target share of the heap limit, minus the idle baseline, minus what the running tasks still need, converted into free slots with a learned per-task heap estimate.
- Learn heap per task from execution history: heap growth between samples is attributed to the running tasks by cost; each task instance (rule, workflow) and each task type keeps a moving average. Recurring tasks have stable ids, so a rule's own past runs predict its next run.
- Gate admission at claim time: candidates are admitted while the sum of their estimates fits the heap budget; a candidate over budget is skipped for that cycle, not the whole cycle.
- Expose every decision: `capacity.mode` and an `adaptive_capacity` block in `/api/task_manager/_health`, OpenTelemetry gauges, one debug log line per change.
- Keep Elasticsearch-pressure backoff; it applies as a ratio on top of the heap-driven value.
- Count memory outside the V8 heap (external allocations such as streamed Arrow responses) in the sampled bytes, and bound capacity by the container's memory limit when one is known, so a node is protected from the kernel kill as well as from V8's heap abort.
- **Kill switch:** any numeric `capacity` keeps today's behaviour unchanged. Tuning lives under `xpack.task_manager.adaptive_capacity.*` and is ignored when capacity is a number.

## Out of scope

- Per-task memory limits, isolation or quarantine of a single runaway task.
- Letting a task report or reserve memory itself: change `tm-task-memory-reporting`.
- Changing the ECH default-capacity table or Elastic Cloud autoscaling.
- Making the health endpoint's `capacity_estimation` memory-aware (follow-up: heap-seconds model).
- Serverless rollout; the controller is evaluated locally first.
- Any change to kibana-controller (https://github.com/elastic/kibana-controller), which scales serverless background-task nodes on the `load` reported by `/api/task_manager/_background_task_utilization`. This change keeps that signal meaningful (load is computed against the capacity in effect) and documents the interaction; adjusting the scaling logic itself is a separate piece of work.

## Measurement

Benchmark scripts under `x-pack/platform/plugins/shared/task_manager/scripts/benchmark/` create a 46 MB-per-read ES|QL index, N alerting v2 rules and N scheduled workflows, sample heap and Task Manager health every 5 s, and summarise runs per minute, duration and pickup-delay percentiles from the event log. Same workload, same node, fixed versus auto. Success: no OOM on the herd that kills fixed 20, pickup p99 and heap peak at or below fixed 10, and the fixed-capacity path byte-identical in unit and FTR tests.
