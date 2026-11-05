/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { JsonObject } from '@kbn/utility-types';
import type { RunningTaskSnapshot } from '../../task_pool';

export interface TaskMemoryEstimatorOpts {
  /** Estimate used for a task that has never been observed, per cost unit. */
  readonly defaultBytesPerCostUnit: number;
  /** Lower bound for any estimate, per cost unit. */
  readonly minBytesPerCostUnit?: number;
  /** Weight of the newest observation in the moving averages (0..1). */
  readonly alpha?: number;
  /** Percentile of recent runs used to size a free slot (0..1); high values favour the heavy runs in the mix. */
  readonly slotPercentile?: number;
  /** How many recent runs the slot percentile is computed over. */
  readonly windowSize?: number;
  /** How many task instances keep their own estimate before the oldest is dropped. */
  readonly maxInstances?: number;
  /** Allocation volume after which the live-to-allocated ratio is re-estimated. */
  readonly calibrationBytes?: number;
  /** Runs at or below this many bytes per cost unit are light and do not take part in slot sizing. */
  readonly lightBytesPerCostUnit?: number;
}

export interface TaskTypeMemoryEstimate extends JsonObject {
  task_type: string;
  bytes_per_cost_unit: number;
  samples: number;
}

interface Estimate {
  bytesPerCostUnit: number;
  samples: number;
  /** Restored from the task document; already scaled by the writer's live ratio and replaced by the first local observation. */
  seeded?: boolean;
}

export interface RunMemoryObservation {
  /** Heap attributed to the run that just ended, scaled by the live ratio. */
  readonly bytes: number;
  /** The instance's moving average per run after this observation, scaled by the live ratio. */
  readonly instanceBytes: number;
  /** Runs the instance average is built from. */
  readonly samples: number;
}

interface TypeEstimate {
  /** Most recent observations of this type, per cost unit, oldest first. */
  readonly recent: number[];
  samples: number;
}

interface InFlightRun {
  readonly taskId: string;
  readonly taskType: string;
  readonly cost: number;
  bytes: number;
}

const DEFAULT_ALPHA = 0.3;
const DEFAULT_MIN_BYTES_PER_COST_UNIT = 512 * 1024;
const DEFAULT_SLOT_PERCENTILE = 0.9;
const DEFAULT_WINDOW_SIZE = 200;
const TYPE_WINDOW_SIZE = 32;
const DEFAULT_MAX_INSTANCES = 10_000;
const DEFAULT_CALIBRATION_BYTES = 256 * 1024 * 1024;
const MIN_LIVE_RATIO = 0.1;
const DEFAULT_LIGHT_BYTES_PER_COST_UNIT = 0;
const MAX_FINALIZED_RUNS = 10_000;

/**
 * Learns how much heap each task needs from what the pool is running.
 *
 * Every sample compares the heap used now with the previous sample. Heap growth
 * is attributed to the tasks that were running during the interval, weighted by
 * their cost. When a run ends its accumulated share becomes one observation,
 * folded into a moving average for that task instance and another for its type.
 * Recurring tasks keep a stable id, so the instance average predicts the next
 * run of the same rule or workflow. Instances that have not run yet take the
 * cold-start default, or the heavy end (`slotPercentile`) of their type's
 * recent runs when that is larger: one type can hold a 230 KB rule and a 46 MB
 * rule, and cheap instances must never make an unseen expensive one look
 * light, however many of them ran first. Heap released by
 * garbage collection is ignored, so the estimate
 * is an allocation footprint, which errs on the side of claiming less rather
 * than more. Free slots are sized from a high percentile of the recent runs, so
 * a mix of heavy and cheap runs is budgeted for the heavy ones rather than for
 * whichever finished last. Light runs (at or below `lightBytesPerCostUnit`) are
 * left out of that percentile: they are admitted against capacity rather than
 * the heap budget, so a mix dominated by them must not shrink the slot that
 * heavy runs are budgeted with.
 *
 * The allocation footprint is calibrated against live heap: `liveSample()` is
 * fed the heap used right after each major garbage collection, and the ratio of
 * live growth to allocated growth over the same period scales every estimate.
 * Transient garbage inflates allocation but not live heap, so the ratio brings
 * the budget closer to what the runs actually occupy at once.
 */
export class TaskMemoryEstimator {
  private readonly defaultBytesPerCostUnit: number;
  private readonly minBytesPerCostUnit: number;
  private readonly alpha: number;
  private readonly slotPercentile: number;
  private readonly windowSize: number;
  private readonly maxInstances: number;
  private readonly calibrationBytes: number;
  private readonly lightBytesPerCostUnit: number;
  private readonly byInstance = new Map<string, Estimate>();
  private readonly byType = new Map<string, TypeEstimate>();
  private readonly inFlight = new Map<string, InFlightRun>();
  /** Runs already finalised through `finalizeRun()`, so a later pool notification does not count them twice. */
  private readonly finalized = new Set<string>();
  private readonly recent: number[] = [];
  private seededInstances = 0;
  private lastUsedHeapBytes?: number;
  private lastLiveHeapBytes?: number;
  private allocatedGrowth = 0;
  private liveGrowth = 0;
  private ratio = 1;

  constructor({
    defaultBytesPerCostUnit,
    minBytesPerCostUnit = DEFAULT_MIN_BYTES_PER_COST_UNIT,
    alpha = DEFAULT_ALPHA,
    slotPercentile = DEFAULT_SLOT_PERCENTILE,
    windowSize = DEFAULT_WINDOW_SIZE,
    maxInstances = DEFAULT_MAX_INSTANCES,
    calibrationBytes = DEFAULT_CALIBRATION_BYTES,
    lightBytesPerCostUnit = DEFAULT_LIGHT_BYTES_PER_COST_UNIT,
  }: TaskMemoryEstimatorOpts) {
    this.defaultBytesPerCostUnit = defaultBytesPerCostUnit;
    this.minBytesPerCostUnit = minBytesPerCostUnit;
    this.alpha = alpha;
    this.slotPercentile = slotPercentile;
    this.windowSize = windowSize;
    this.maxInstances = maxInstances;
    this.calibrationBytes = calibrationBytes;
    this.lightBytesPerCostUnit = lightBytesPerCostUnit;
  }

  /** Records one heap sample together with the tasks that were running when it was taken. */
  public sample(usedHeapBytes: number, running: readonly RunningTaskSnapshot[]): void {
    for (const task of running) {
      if (!this.inFlight.has(task.executionId) && !this.finalized.has(task.executionId)) {
        this.inFlight.set(task.executionId, {
          taskId: task.taskId,
          taskType: task.taskType,
          cost: task.cost,
          bytes: 0,
        });
      }
    }

    const delta = this.lastUsedHeapBytes === undefined ? 0 : usedHeapBytes - this.lastUsedHeapBytes;
    this.lastUsedHeapBytes = usedHeapBytes;

    if (delta > 0) this.allocatedGrowth += delta;
    if (delta > 0 && running.length > 0) {
      const totalCost = running.reduce((sum, task) => sum + task.cost, 0);
      for (const task of running) {
        const run = this.inFlight.get(task.executionId);
        if (run) run.bytes += (delta * task.cost) / totalCost;
      }
    }

    const runningIds = new Set(running.map((task) => task.executionId));
    for (const [executionId, run] of this.inFlight) {
      if (!runningIds.has(executionId)) {
        this.inFlight.delete(executionId);
        this.observe(run);
      }
    }
  }

  /**
   * Finalises a run the moment it ends. Callers should `sample()` first with the
   * ending run still in the running set, so growth since the last sample is
   * attributed to it; otherwise runs shorter than the sample interval would
   * look free.
   */
  public taskEnded(task: RunningTaskSnapshot): void {
    if (this.finalized.has(task.executionId)) return;
    const run = this.inFlight.get(task.executionId) ?? {
      taskId: task.taskId,
      taskType: task.taskType,
      cost: task.cost,
      bytes: 0,
    };
    this.inFlight.delete(task.executionId);
    this.observe(run);
  }

  /**
   * Finalises a run from inside the runner, before the task document is
   * updated, and returns what was learned so it can be written to the document
   * and the event log. A later `taskEnded()` for the same execution is a no-op.
   */
  public finalizeRun(task: RunningTaskSnapshot): RunMemoryObservation | undefined {
    if (this.finalized.has(task.executionId)) return undefined;
    this.taskEnded(task);
    this.finalized.add(task.executionId);
    if (this.finalized.size > MAX_FINALIZED_RUNS) {
      const oldest = this.finalized.values().next().value;
      if (oldest !== undefined) this.finalized.delete(oldest);
    }
    const instance = this.byInstance.get(task.taskId);
    if (instance === undefined) return undefined;
    const lastObserved = this.recent[this.recent.length - 1] ?? 0;
    return {
      bytes: Math.round(lastObserved * task.cost * this.ratio),
      instanceBytes: Math.round(this.instanceBytesPerRun(instance, task.cost)),
      samples: instance.samples,
    };
  }

  /** Whether `finalizeRun()` already closed out this execution. */
  public isFinalized(executionId: string): boolean {
    return this.finalized.has(executionId);
  }

  /**
   * Restores an instance estimate from its task document. Only an instance this
   * node has not observed takes the seed; the type history is left alone so a
   * restart does not replay stale runs into the type percentile.
   */
  public seed(
    taskId: string,
    taskType: string,
    cost: number,
    bytes: number,
    samples: number
  ): boolean {
    if (this.byInstance.has(taskId) || cost <= 0 || !(bytes >= 0)) return false;
    this.byInstance.set(taskId, {
      bytesPerCostUnit: bytes / cost,
      samples: Math.max(1, Math.floor(samples)),
      seeded: true,
    });
    this.trimInstances();
    this.seededInstances++;
    return true;
  }

  /** Instances whose first estimate on this node came from their document. */
  public seededCount(): number {
    return this.seededInstances;
  }

  /**
   * Records the heap used right after a major garbage collection. Growth between
   * two such samples is live data; comparing it with the allocation seen by
   * `sample()` over the same period calibrates the estimates.
   */
  public liveSample(usedHeapBytes: number): void {
    if (this.lastLiveHeapBytes !== undefined) {
      const delta = usedHeapBytes - this.lastLiveHeapBytes;
      if (delta > 0) this.liveGrowth += delta;
    }
    this.lastLiveHeapBytes = usedHeapBytes;
    if (this.allocatedGrowth < this.calibrationBytes) return;
    const observed = Math.min(1, Math.max(MIN_LIVE_RATIO, this.liveGrowth / this.allocatedGrowth));
    this.ratio = this.alpha * observed + (1 - this.alpha) * this.ratio;
    this.allocatedGrowth = 0;
    this.liveGrowth = 0;
  }

  /** Live-to-allocated heap ratio applied to every estimate; 1 until calibrated. */
  public liveRatio(): number {
    return this.ratio;
  }

  /**
   * Estimated heap for one run of this task: its own history when it has one,
   * otherwise the cold-start default, raised to the heavy end of its type when
   * that is larger. The type history never lowers an unseen instance below the
   * default: on a fresh node the cheap instances of a type run first, and for a
   * while they are all the type has seen, so an estimate taken from them would
   * admit every unseen heavy instance at once.
   */
  public estimateBytes(taskId: string, taskType: string, cost: number): number {
    const instance = this.byInstance.get(taskId);
    if (instance !== undefined) {
      return (
        Math.max(this.instanceBytesPerRun(instance, cost) / cost, this.minBytesPerCostUnit) * cost
      );
    }
    const learned = this.typeBytesPerCostUnit(taskType);
    const perCostUnit =
      learned === undefined
        ? this.defaultBytesPerCostUnit
        : Math.max(learned * this.ratio, this.defaultBytesPerCostUnit);
    return Math.max(perCostUnit, this.minBytesPerCostUnit) * cost;
  }

  /** Bytes per run for an instance; a seeded value already carries the writer's live ratio. */
  private instanceBytesPerRun(instance: Estimate, cost: number): number {
    return instance.bytesPerCostUnit * cost * (instance.seeded ? 1 : this.ratio);
  }

  /** Heap per cost unit at the slot percentile of the recent heavy runs, used to size free slots. */
  public bytesPerCostUnit(): number {
    const heavy = this.recent
      .map((bytes) => bytes * this.ratio)
      .filter((bytes) => bytes > this.lightBytesPerCostUnit);
    if (heavy.length === 0) {
      return Math.max(this.defaultBytesPerCostUnit, this.minBytesPerCostUnit);
    }
    return Math.max(percentile(heavy, this.slotPercentile), this.minBytesPerCostUnit);
  }

  private typeBytesPerCostUnit(taskType: string): number | undefined {
    const estimate = this.byType.get(taskType);
    return estimate === undefined ? undefined : percentile(estimate.recent, this.slotPercentile);
  }

  public hasObservations(): boolean {
    return this.byType.size > 0;
  }

  /** The largest per-type estimates, for the health endpoint. */
  public snapshot(limit = 10): TaskTypeMemoryEstimate[] {
    return Array.from(this.byType, ([taskType, estimate]) => ({
      task_type: taskType,
      bytes_per_cost_unit: Math.round(percentile(estimate.recent, this.slotPercentile)),
      samples: estimate.samples,
    }))
      .sort((a, b) => b.bytes_per_cost_unit - a.bytes_per_cost_unit)
      .slice(0, limit);
  }

  private observe(run: InFlightRun): void {
    const observed = run.cost > 0 ? run.bytes / run.cost : run.bytes;
    const type = this.byType.get(run.taskType) ?? { recent: [], samples: 0 };
    type.recent.push(observed);
    if (type.recent.length > TYPE_WINDOW_SIZE) type.recent.shift();
    type.samples++;
    this.byType.set(run.taskType, type);
    this.fold(this.byInstance, run.taskId, observed);
    this.trimInstances();
    this.recent.push(observed);
    if (this.recent.length > this.windowSize) this.recent.shift();
  }

  private trimInstances(): void {
    if (this.byInstance.size > this.maxInstances) {
      const oldest = this.byInstance.keys().next().value;
      if (oldest !== undefined) this.byInstance.delete(oldest);
    }
  }

  private fold(estimates: Map<string, Estimate>, key: string, observed: number): void {
    const current = estimates.get(key);
    if (current?.seeded) {
      // The node's own observation replaces the document's value outright.
      estimates.set(key, { bytesPerCostUnit: observed, samples: current.samples + 1 });
      return;
    }
    if (current) {
      current.bytesPerCostUnit =
        this.alpha * observed + (1 - this.alpha) * current.bytesPerCostUnit;
      current.samples++;
      return;
    }
    estimates.set(key, { bytesPerCostUnit: observed, samples: 1 });
  }
}

/** Value at `fraction` of the way through `values` once sorted; `values` must not be empty. */
const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index];
};
