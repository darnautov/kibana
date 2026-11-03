# task_manager/capacity Specification

## Purpose

How a Kibana node decides how many background tasks it runs at once. Capacity is counted in normal-cost tasks (cost 2); task types declare a cost of 1, 2, 4 or 10. This spec records the behaviour that exists on `main` today so that changes can be expressed as deltas against it.

## Requirements

### Requirement: Fixed capacity from configuration

Task Manager SHALL run at most `xpack.task_manager.capacity` normal-cost tasks concurrently, where the configured value is an integer between 5 and 50. When the setting is absent it SHALL use 10, or the heap-size based default on Elastic Cloud Hosted when `auto_calculate_default_ech_capacity` is enabled.

#### Scenario: operator sets a number

- **WHEN** `xpack.task_manager.capacity` is `20`
- **THEN** the task pool admits running tasks until their summed cost reaches 40 and the health endpoint reports `capacity.config: 20`, `as_workers: 20`, `as_cost: 40`

#### Scenario: setting absent

- **WHEN** `xpack.task_manager.capacity` and `max_workers` are both absent
- **THEN** capacity is 10

### Requirement: Claim cycles respect available capacity

Each claim cycle SHALL claim candidate tasks in priority order until the next candidate's cost would exceed the capacity available in the pool, and SHALL stop claiming at the first candidate that does not fit so that a large task is not starved by smaller ones.

#### Scenario: large task at the head of the queue

- **WHEN** 2 units of capacity are free and the next candidate costs 10
- **THEN** no further candidates are claimed in that cycle and the large task is retried next cycle

### Requirement: Elasticsearch pressure lowers capacity temporarily

When Elasticsearch returns "too many requests", inline-script or cluster-block errors during a 10 s window, Task Manager SHALL reduce capacity by 20 % per window down to the cost of the largest task, and SHALL raise it by 5 % per error-free window until the configured value is reached.

#### Scenario: back-off and recovery

- **WHEN** a window contains at least one 429 from Elasticsearch
- **THEN** capacity becomes `floor(previous × 0.8)` and a warning is logged on the first reduction
- **WHEN** subsequent windows contain no such errors
- **THEN** capacity becomes `min(configured, ceil(previous × 1.05))` each window

### Requirement: Capacity is visible in the health endpoint

`GET /api/task_manager/_health` SHALL report the capacity currently in effect under `stats.configuration.value.capacity` with `config`, `as_workers` and `as_cost`.

#### Scenario: health reflects a temporary reduction

- **WHEN** capacity has been reduced by Elasticsearch pressure to 8
- **THEN** the health endpoint reports `capacity.config: 8`
