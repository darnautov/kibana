/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getHeapStatistics } from 'v8';
import { BehaviorSubject, type Observable } from 'rxjs';
import type { Logger } from '@kbn/core/server';
import type { JsonObject } from '@kbn/utility-types';
import { TaskCost } from '../../task';
import type { ClaimMemoryGate } from '../../task_claimers';
import type { RunningTaskSnapshot } from '../../task_pool';
import type { TaskTypeMemoryEstimate } from './task_memory_estimator';
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
}

export type AdaptiveCapacityTrigger = 'tick' | 'claim';

export interface AdaptiveCapacityState extends JsonObject {
  capacity: number;
  heap_used_bytes: number;
  heap_limit_bytes: number;
  heap_target_bytes: number;
  heap_baseline_bytes: number;
  heap_projected_bytes: number;
  heap_budget_bytes: number;
  bytes_per_normal_task: number;
  running_cost: number;
  free_slots: number;
  decisions: number;
  last_trigger: AdaptiveCapacityTrigger;
  estimates: TaskTypeMemoryEstimate[];
}

export interface AdaptiveCapacityControllerOpts {
  readonly logger: Logger;
  readonly settings: AdaptiveCapacitySettings;
  readonly getRunningTasks: () => readonly RunningTaskSnapshot[];
  readonly getHeapStats?: () => HeapStats;
  readonly estimator?: TaskMemoryEstimator;
}

const BASELINE_ALPHA = 0.2;

export const readV8HeapStats = (): HeapStats => {
  const { used_heap_size: usedHeapBytes, heap_size_limit: heapLimitBytes } = getHeapStatistics();
  return { usedHeapBytes, heapLimitBytes };
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
  private baselineBytes?: number;
  private currentCapacity: number;
  private decisions = 0;

  constructor({
    logger,
    settings,
    getRunningTasks,
    getHeapStats = readV8HeapStats,
    estimator,
  }: AdaptiveCapacityControllerOpts) {
    this.logger = logger;
    this.settings = settings;
    this.getRunningTasks = getRunningTasks;
    this.getHeapStats = getHeapStats;
    this.estimator =
      estimator ??
      new TaskMemoryEstimator({
        defaultBytesPerCostUnit: settings.defaultBytesPerTask / TaskCost.Normal,
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

  /** Heap budget for the claim that follows the latest decision. */
  public memoryGate(): ClaimMemoryGate {
    return {
      budgetBytes: Math.max(0, this.stateSubject.value.heap_budget_bytes),
      estimateBytes: (taskId, taskType, cost) =>
        this.estimator.estimateBytes(taskId, taskType, cost),
    };
  }

  /**
   * Closes out a run the moment the pool drops it, attributing the heap growth
   * since the last sample to it and whatever else is still running.
   */
  public taskEnded(task: RunningTaskSnapshot): void {
    const { usedHeapBytes } = this.getHeapStats();
    this.estimator.sample(usedHeapBytes, [...this.getRunningTasks(), task]);
    this.estimator.taskEnded(task);
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
    const { minCapacity, maxCapacity, heapTargetRatio, maxIncreasePerDecision } = this.settings;

    if (running.length === 0) {
      this.baselineBytes =
        this.baselineBytes === undefined
          ? usedHeapBytes
          : BASELINE_ALPHA * usedHeapBytes + (1 - BASELINE_ALPHA) * this.baselineBytes;
    }
    const baseline = this.baselineBytes ?? usedHeapBytes;

    const runningCost = running.reduce((sum, task) => sum + task.cost, 0);
    const committedBytes = running.reduce(
      (sum, task) => sum + this.estimator.estimateBytes(task.taskId, task.taskType, task.cost),
      0
    );
    const targetBytes = heapLimitBytes * heapTargetRatio;
    const projectedBytes = Math.max(usedHeapBytes, baseline + committedBytes);
    const budgetBytes = targetBytes - projectedBytes;
    const bytesPerNormalTask = this.estimator.bytesPerCostUnit() * TaskCost.Normal;
    const freeSlots = budgetBytes > 0 ? Math.floor(budgetBytes / bytesPerNormalTask) : 0;
    const runningSlots = Math.ceil(runningCost / TaskCost.Normal);

    const previous = this.currentCapacity;
    const wanted = Math.min(maxCapacity, Math.max(minCapacity, runningSlots + freeSlots));
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
      bytes_per_normal_task: Math.round(bytesPerNormalTask),
      running_cost: runningCost,
      free_slots: freeSlots,
      decisions: this.decisions,
      last_trigger: trigger,
      estimates: this.estimator.snapshot(),
    };
  }
}

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(0);
