## ADDED Requirements

### Requirement: Heap estimate persisted on the task document

In adaptive mode, when a recurring task's run ends, Task Manager SHALL store the run's heap estimate on the task document as `memoryEstimate` with `bytes` (the instance's moving average after this run), `samples` (runs observed) and `updatedAt`, as part of the partial update that reschedules the task, and SHALL NOT issue an additional write for it. Non-recurring tasks SHALL NOT be updated.

#### Scenario: recurring rule finishes a run

- **WHEN** a rule task with a 1 m schedule finishes a run that the estimator attributed 46 MB to, and the instance had one earlier sample of 50 MB
- **THEN** the same partial update that sets the next `runAt` also sets `memoryEstimate.bytes` to the updated moving average, `samples` to 2 and `updatedAt` to the run's end time

#### Scenario: one-off task finishes

- **WHEN** a task without a schedule finishes
- **THEN** its document is removed as before and no `memoryEstimate` is written

### Requirement: Claim admission uses the persisted estimate

In adaptive mode, a claim cycle SHALL budget each candidate that carries `memoryEstimate` by that value whenever the in-process estimator has no observation of the instance, and SHALL prefer the in-process observation once one exists. A persisted estimate at or below `adaptive_capacity.light_task_bytes` SHALL make the candidate light.

#### Scenario: first claim after a restart

- **WHEN** Kibana restarts with sixty overdue light rules (`memoryEstimate.bytes` 1 MB) and twenty overdue heavy rules (`memoryEstimate.bytes` 46 MB) and a heap budget of 350 MB
- **THEN** the first claim cycle admits the light rules against capacity only and up to seven heavy rules against the budget, instead of pricing all eighty at `default_bytes_per_task`

#### Scenario: another node already learned the task

- **WHEN** node A has run a rule four times and node B claims the same rule for the first time
- **THEN** node B budgets the rule with the `memoryEstimate` node A wrote, not with the type average

#### Scenario: local observation wins

- **WHEN** a node has observed an instance itself and the document carries an older `memoryEstimate`
- **THEN** the node's own moving average is used for admission

### Requirement: Unseen instances are never priced below the cold-start default

An instance with no history of its own (neither observed on this node nor carried by its document) SHALL be budgeted at `adaptive_capacity.default_bytes_per_task` or at the heavy end of its type's recent runs, whichever is larger. The type history SHALL NOT lower an unseen instance's estimate below the default. The default SHALL apply per run regardless of the task's `cost`: cost describes CPU and Elasticsearch load, and scaling the default by it would price an ExtraLarge task above a small node's idle budget, so it would never run and never be learned.

#### Scenario: an unseen ExtraLarge task is priced at the default

- **GIVEN** `default_bytes_per_task` is 128 MB and no `siem.indicatorRule` task has run on this node
- **WHEN** an indicator match rule (cost 10) is a claim candidate
- **THEN** it is budgeted at 128 MB, not 640 MB, and fits the idle budget of a 1280 MB node

#### Scenario: first start with the cheap rules due first

- **WHEN** a fresh node has run sixty light rules of `alerting_v2:rule_executor` (under 1 MB each) and no heavy one, and twenty unseen rules of the same type come due
- **THEN** each unseen rule is budgeted at the default (128 MB), so at most a budget's worth of them is admitted per cycle, instead of all twenty being treated as light

#### Scenario: type heavier than the default

- **WHEN** a type's recent runs put its heavy end at 300 MB per run
- **THEN** an unseen instance of that type is budgeted at 300 MB

### Requirement: Heap estimate recorded in the event log

In adaptive mode the `task-run` event SHALL carry `kibana.task.memory_bytes`, the heap estimate attributed to that run, so that memory history is queryable per task type and instance alongside duration and schedule delay.

#### Scenario: run completes

- **WHEN** a run ends in adaptive mode
- **THEN** its `task-run` event has `kibana.task.memory_bytes` equal to the bytes the estimator attributed to the run

#### Scenario: fixed capacity

- **WHEN** `xpack.task_manager.capacity` is a number
- **THEN** `task-run` events have no `kibana.task.memory_bytes`

### Requirement: Persistence can be switched off

When `xpack.task_manager.adaptive_capacity.persist_estimates` is `false`, or `capacity` is a number, Task Manager SHALL NOT write `memoryEstimate` and SHALL ignore any `memoryEstimate` present on claimed documents. Documents carrying the attribute SHALL remain readable and writable by that configuration.

#### Scenario: kill switch

- **WHEN** an operator sets `persist_estimates: false` and restarts
- **THEN** run-end updates omit `memoryEstimate`, existing values are left untouched, and claims budget every unseen instance by its type average or the default

#### Scenario: downgrade reads documents with the attribute

- **WHEN** a Kibana without this change reads a task document that carries `memoryEstimate`
- **THEN** the task is read and rescheduled normally and the attribute is dropped on the next full write
