# Spec Delta

## Purpose
How a running task tells Task Manager how much memory it holds or expects to hold, how that enters the adaptive capacity budget, and how it is folded into the learned estimates without replacing the measured signal.

## ADDED Requirements

### Requirement: A running task can reserve memory

Task Manager SHALL expose on the run context a `memory.reserve(bytes)` call that declares an upper bound on the memory the current run will hold. In adaptive mode the next capacity decision SHALL count, for each running task, the larger of its reservation and its learned estimate.

#### Scenario: streaming task declares its bound

- **WHEN** a run estimated at 64 MB calls `reserve(200 MB)` before it starts decoding a streamed response
- **THEN** the next claim cycle budgets that run at 200 MB and admits heavy candidates only within the remaining budget

#### Scenario: early release

- **WHEN** the same run calls `release()` after it has written its results and dropped the buffers
- **THEN** the next decision budgets it at its learned estimate again

### Requirement: A reservation is replaced, released, and ends with the run

A later `reserve` call SHALL replace the earlier value rather than add to it, `memory.release()` SHALL clear it, and a reservation SHALL end when the run ends. A reservation below the learned estimate SHALL have no effect on the budget.

#### Scenario: repeated calls

- **WHEN** a run calls `reserve(100 MB)` and then `reserve(50 MB)`
- **THEN** it is budgeted at the larger of 50 MB and its learned estimate, not 150 MB

#### Scenario: reservation is not a limit

- **WHEN** a run holds more than it reserved
- **THEN** it is not cancelled, and the measured attribution records what it actually held

### Requirement: A running task can report what it holds

Task Manager SHALL expose on the run context a `memory.report(bytes)` call that records how much memory the run holds at that moment. The reporter SHALL keep the peak of the values reported during the run. When the run ends, the estimator SHALL fold the larger of the reported peak and the measured attribution into the instance and type history; a report SHALL never lower an observation below the measured share.

#### Scenario: report above measurement

- **WHEN** a run reports a peak of 150 MB and the measured attribution gives it 40 MB because twelve runs overlapped
- **THEN** the run's estimate after live-ratio scaling is 150 MB (a report is live bytes, so it is lifted into the allocation domain before the larger value is kept)

#### Scenario: report below measurement

- **WHEN** a run reports 10 MB and the measured attribution gives it 90 MB
- **THEN** the run is recorded at 90 MB

#### Scenario: no report

- **WHEN** a run never calls the reporter
- **THEN** it is recorded exactly as it is today, from the measured attribution alone

### Requirement: Reports are visible per run and per node

The `task-run` event SHALL carry `kibana.task.memory_reported_bytes` (the reported peak, absent when the run did not report) next to `kibana.task.memory_bytes`. `GET /api/task_manager/_health` SHALL report under `adaptive_capacity` the number of running tasks holding a reservation, the reserved total in bytes, and the number of runs that have reported since the node started; the reservation values SHALL be exposed as OpenTelemetry gauges.

#### Scenario: comparing signals

- **WHEN** an operator queries the event log for a task type
- **THEN** every run of that type shows both the measured and the reported bytes, so a type that under-reports can be found

### Requirement: Reporting can be switched off and is inert in fixed mode

When `xpack.task_manager.adaptive_capacity.task_reports` is `false`, or when `xpack.task_manager.capacity` is a number, both calls SHALL be no-ops: no reservation enters any budget, no report is folded or recorded, and the task code SHALL NOT need to check the mode before calling them.

#### Scenario: kill switch

- **WHEN** an operator sets `task_reports: false` and a run calls `reserve(1 GB)`
- **THEN** capacity and the next claim cycle are unaffected and the event has no `memory_reported_bytes`

#### Scenario: fixed capacity

- **WHEN** capacity is `10` and a task calls `report(500 MB)` on every run
- **THEN** nothing is written to the task document or the event log and capacity stays 10
