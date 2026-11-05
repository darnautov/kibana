/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getHeapStatistics } from 'v8';
import { PerformanceObserver, constants as perfConstants } from 'perf_hooks';
import { BehaviorSubject, type Observable } from 'rxjs';
import type { Logger } from '@kbn/core/server';
import type { JsonObject } from '@kbn/utility-types';
import { TaskCost } from '../../task';
import type { ClaimMemoryGate } from '../../task_claimers';
import type { RunningTaskSnapshot } from '../../task_pool';
import type { RunMemoryObservation, TaskTypeMemoryEstimate } from './task_memory_estimator';
import { TaskMemoryEstimator } from './task_memory_estimator';

export interface HeapStats {
  readonly usedHeapBytes: number;
  readonly heapLimitBytes: number;
}

export interface AdaptiveCapacitySettings {
  /** Lowest capacity the controller will report, even under heap pressure. */
  readonly minCapacity: number;
  /** Highest capacity the controller will report, regardless of headroom. */
  readonly maxCapacity: number;
  /** Share of the heap limit the controller keeps task memory below. */
  readonly heapTargetRatio: number;
  /** Estimate used for task types that have not been observed yet, per normal-cost task. */
  readonly defaultBytesPerTask: number;
  /** Largest step up between two timer decisions; steps down are unbounded and claims never step up. */
  readonly maxIncreasePerDecision: number;
  /** Runs estimated at or below this many bytes bypass the heap budget at claim time. */
  readonly lightTaskBytes: number;
  /** Normal-cost slots kept open for light runs while the heap budget is exhausted. */
  readonly lightTaskSlots: number;
  /** Restore instance estimates from task documents at claim time; off ignores the attribute. */
  readonly persistEstimates: boolean;
}

/** Subscribes to major garbage collections; returns the unsubscribe function. */
export type MajorGcObserver = (onMajorGc: () => void) => () => void;

export type AdaptiveCapacityTrigger = 'tick' | 'claim';

export interface AdaptiveCapacityState extends JsonObject {
  capacity: number;
  heap_used_bytes: number;
  heap_limit_bytes: number;
  heap_target_bytes: number;
  heap_baseline_bytes: number;
  heap_projected_bytes: number;
  heap_budget_bytes: number;
  heap_live_ratio: number;
  bytes_per_normal_task: number;
  running_cost: number;
  free_slots: number;
  decisions: number;
  last_trigger: AdaptiveCapacityTrigger;
  estimates: TaskTypeMemoryEstimate[];
  /** Instances first budgeted from the estimate on their document rather than a cold-start default. */
  seeded_instances: number;
}

export interface AdaptiveCapacityControllerOpts {
  readonly logger: Logger;
  readonly settings: AdaptiveCapacitySettings;
  readonly getRunningTasks: () => readonly RunningTaskSnapshot[];
  readonly getHeapStats?: () => HeapStats;
  readonly estimator?: TaskMemoryEstimator;
  readonly observeMajorGc?: MajorGcObserver;
}

const BASELINE_ALPHA = 0.2;

const MAX_OLD_SPACE_FLAG = /--max-old-space-size(?:=|\s+)(\d+)/g;

/**
 * Old-space limit set through `--max-old-space-size`, in bytes, or undefined
 * when the flag is absent. V8 reports `heap_size_limit` with the young
 * generation and code space added on top of it, so the old space fills, and
 * the process dies, before `used_heap_size` gets anywhere near that figure.
 */
export const readMaxOldSpaceBytes = (
  execArgv: readonly string[] = process.execArgv,
  nodeOptions: string | undefined = process.env.NODE_OPTIONS
): number | undefined => {
  // Command-line flags take precedence over NODE_OPTIONS, so they are scanned last.
  const flags = [nodeOptions ?? '', ...execArgv].join(' ');
  let lastMb: number | undefined;
  for (const match of flags.matchAll(MAX_OLD_SPACE_FLAG)) {
    lastMb = Number(match[1]);
  }
  return lastMb === undefined ? undefined : lastMb * 1024 * 1024;
};

/** Heap used and the limit the process will actually die at: the old-space cap when one is set. */
export const readV8HeapStats = (): HeapStats => {
  const { used_heap_size: usedHeapBytes, heap_size_limit: heapSizeLimit } = getHeapStatistics();
  const maxOldSpaceBytes = readMaxOldSpaceBytes();
  return {
    usedHeapBytes,
    heapLimitBytes:
      maxOldSpaceBytes === undefined ? heapSizeLimit : Math.min(heapSizeLimit, maxOldSpaceBytes),
  };
};

interface GcEntryDetail {
  readonly kind?: number;
}

/** Watches V8 garbage-collection entries and calls back after each major (mark-compact) collection. */
export const observeV8MajorGc: MajorGcObserver = (onMajorGc) => {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      // Garbage-collection entries carry `detail.kind`; the typings predate it.
      const { detail } = entry as { detail?: GcEntryDetail };
      if (detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) {
        onMajorGc();
        return;
      }
    }
  });
  observer.observe({ entryTypes: ['gc'] });
  return () => observer.disconnect();
};

/**
 * Sizes Task Manager capacity from heap headroom instead of a fixed number.
 *
 * Each decision projects the heap the running tasks still need on top of the
 * idle baseline, subtracts that from the target, and converts what is left into
 * free slots using the learned heap cost of the recent task mix. The result is
 * the number of normal-cost tasks the pool may hold right now. Decisions run on
 * a timer for observability and again at every claim so the gate reflects the
 * heap at the moment tasks are admitted.
 */
export class AdaptiveCapacityController {
  public readonly estimator: TaskMemoryEstimator;
  private readonly logger: Logger;
  private readonly settings: AdaptiveCapacitySettings;
  private readonly getRunningTasks: () => readonly RunningTaskSnapshot[];
  private readonly getHeapStats: () => HeapStats;
  private readonly capacitySubject: BehaviorSubject<number>;
  private readonly stateSubject: BehaviorSubject<AdaptiveCapacityState>;
  private readonly stopGcObserver: () => void;
  private baselineBytes?: number;
  private liveBaselineSeen = false;
  private currentCapacity: number;
  private decisions = 0;

  constructor({
    logger,
    settings,
    getRunningTasks,
    getHeapStats = readV8HeapStats,
    estimator,
    observeMajorGc = observeV8MajorGc,
  }: AdaptiveCapacityControllerOpts) {
    this.logger = logger;
    this.settings = settings;
    this.getRunningTasks = getRunningTasks;
    this.getHeapStats = getHeapStats;
    this.estimator =
      estimator ??
      new TaskMemoryEstimator({
        defaultBytesPerCostUnit: settings.defaultBytesPerTask / TaskCost.Normal,
        lightBytesPerCostUnit: settings.lightTaskBytes / TaskCost.Normal,
      });
    this.stopGcObserver = observeMajorGc(() => {
      const { usedHeapBytes } = this.getHeapStats();
      this.estimator.liveSample(usedHeapBytes);
      this.observeLiveBaseline(usedHeapBytes);
    });
    this.currentCapacity = settings.minCapacity;
    const initial = this.decide('tick');
    this.currentCapacity = initial.capacity;
    this.stateSubject = new BehaviorSubject<AdaptiveCapacityState>(initial);
    this.capacitySubject = new BehaviorSubject<number>(initial.capacity);
  }

  /** Current capacity in normal-cost tasks; emits on every change. */
  public get capacity$(): Observable<number> {
    return this.capacitySubject.asObservable();
  }

  public get state$(): Observable<AdaptiveCapacityState> {
    return this.stateSubject.asObservable();
  }

  public get state(): AdaptiveCapacityState {
    return this.stateSubject.value;
  }

  /** Feeds the estimator one heap sample and makes a decision. */
  public tick(): number {
    const { usedHeapBytes } = this.getHeapStats();
    this.estimator.sample(usedHeapBytes, this.getRunningTasks());
    return this.refresh('tick');
  }

  /** Releases the garbage-collection observer. */
  public stop(): void {
    this.stopGcObserver();
  }

  /** Heap budget for the claim that follows the latest decision. */
  public memoryGate(): ClaimMemoryGate {
    return {
      budgetBytes: Math.max(0, this.stateSubject.value.heap_budget_bytes),
      lightTaskBytes: this.settings.lightTaskBytes,
      estimateBytes: (taskId, taskType, cost) =>
        this.estimator.estimateBytes(taskId, taskType, cost),
      seed: (taskId, taskType, cost, estimate) =>
        this.settings.persistEstimates &&
        this.estimator.seed(taskId, taskType, cost, estimate.bytes, estimate.samples),
    };
  }

  /**
   * Closes out a run the moment the pool drops it, attributing the heap growth
   * since the last sample to it and whatever else is still running. A run the
   * runner already reported through `observeRunEnd()` is left alone.
   */
  public taskEnded(task: RunningTaskSnapshot): void {
    if (this.estimator.isFinalized(task.executionId)) return;
    const { usedHeapBytes } = this.getHeapStats();
    this.estimator.sample(usedHeapBytes, [...this.getRunningTasks(), task]);
    this.estimator.taskEnded(task);
  }

  /**
   * Closes out a run from inside the runner, before its document is updated,
   * and returns the estimate to persist with it.
   */
  public observeRunEnd(task: RunningTaskSnapshot): RunMemoryObservation | undefined {
    if (this.estimator.isFinalized(task.executionId)) return undefined;
    const { usedHeapBytes } = this.getHeapStats();
    this.estimator.sample(usedHeapBytes, [...this.getRunningTasks(), task]);
    return this.estimator.finalizeRun(task);
  }

  /**
   * Right after a major collection the heap holds live data only: the idle
   * baseline plus what the running tasks still need. Taking the running
   * estimates off gives a baseline free of garbage that keeps tracking under
   * steady load, when the pool never empties.
   */
  private observeLiveBaseline(liveHeapBytes: number): void {
    const observed = Math.max(0, liveHeapBytes - this.committedBytes(this.getRunningTasks()));
    this.baselineBytes =
      this.baselineBytes === undefined || !this.liveBaselineSeen
        ? observed
        : BASELINE_ALPHA * observed + (1 - BASELINE_ALPHA) * this.baselineBytes;
    this.liveBaselineSeen = true;
  }

  private committedBytes(running: readonly RunningTaskSnapshot[]): number {
    return running.reduce(
      (sum, task) => sum + this.estimator.estimateBytes(task.taskId, task.taskType, task.cost),
      0
    );
  }

  /** Re-evaluates capacity now; returns the new value and emits it if it changed. */
  public refresh(trigger: AdaptiveCapacityTrigger): number {
    const state = this.decide(trigger);
    const previous = this.currentCapacity;
    this.currentCapacity = state.capacity;
    this.stateSubject.next(state);
    if (state.capacity !== previous) {
      this.logger.debug(
        `Adaptive capacity ${previous} -> ${state.capacity} on ${trigger}: heap ${mb(
          state.heap_used_bytes
        )}/${mb(state.heap_limit_bytes)} MB, projected ${mb(
          state.heap_projected_bytes
        )} MB, budget ${mb(state.heap_budget_bytes)} MB at ${mb(
          state.bytes_per_normal_task
        )} MB per task, running cost ${state.running_cost}`
      );
      this.capacitySubject.next(state.capacity);
    }
    return state.capacity;
  }

  private decide(trigger: AdaptiveCapacityTrigger): AdaptiveCapacityState {
    const { usedHeapBytes, heapLimitBytes } = this.getHeapStats();
    const running = this.getRunningTasks();
    const { minCapacity, maxCapacity, heapTargetRatio, maxIncreasePerDecision, lightTaskSlots } =
      this.settings;

    // Until a major collection has been observed, an idle heap (garbage included) is
    // the only baseline available; it errs on the safe side.
    if (running.length === 0 && !this.liveBaselineSeen) {
      this.baselineBytes =
        this.baselineBytes === undefined
          ? usedHeapBytes
          : BASELINE_ALPHA * usedHeapBytes + (1 - BASELINE_ALPHA) * this.baselineBytes;
    }
    const baseline = this.baselineBytes ?? usedHeapBytes;

    const runningCost = running.reduce((sum, task) => sum + task.cost, 0);
    const committedBytes = this.committedBytes(running);
    const targetBytes = heapLimitBytes * heapTargetRatio;
    const projectedBytes = Math.max(usedHeapBytes, baseline + committedBytes);
    const budgetBytes = targetBytes - projectedBytes;
    const bytesPerNormalTask = this.estimator.bytesPerCostUnit() * TaskCost.Normal;
    const freeSlots = budgetBytes > 0 ? Math.floor(budgetBytes / bytesPerNormalTask) : 0;
    const runningSlots = Math.ceil(runningCost / TaskCost.Normal);

    const previous = this.currentCapacity;
    // Light runs are admitted against capacity only, so keep `lightTaskSlots`
    // open beyond the running set even when the heap budget is exhausted.
    const wanted = Math.min(
      maxCapacity,
      Math.max(minCapacity, runningSlots + Math.max(freeSlots, lightTaskSlots))
    );
    // A claim-time decision only lowers capacity; the timer raises it, one bounded step at a time.
    const capacity =
      wanted <= previous
        ? wanted
        : trigger === 'claim'
        ? previous
        : Math.min(wanted, previous + maxIncreasePerDecision);
    this.decisions++;

    return {
      capacity,
      heap_used_bytes: usedHeapBytes,
      heap_limit_bytes: heapLimitBytes,
      heap_target_bytes: Math.round(targetBytes),
      heap_baseline_bytes: Math.round(baseline),
      heap_projected_bytes: Math.round(projectedBytes),
      heap_budget_bytes: Math.round(budgetBytes),
      heap_live_ratio: Number(this.estimator.liveRatio().toFixed(3)),
      bytes_per_normal_task: Math.round(bytesPerNormalTask),
      running_cost: runningCost,
      free_slots: freeSlots,
      decisions: this.decisions,
      last_trigger: trigger,
      estimates: this.estimator.snapshot(),
      seeded_instances: this.estimator.seededCount(),
    };
  }
}

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(0);
