/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core/server/mocks';
import type { RunningTaskSnapshot } from '../../task_pool';
import { AdaptiveCapacityController } from './adaptive_capacity_controller';
import { TaskMemoryEstimator } from './task_memory_estimator';

const MB = 1024 * 1024;
const LIMIT = 2048 * MB;

const settings = {
  minCapacity: 2,
  maxCapacity: 50,
  heapTargetRatio: 0.75, // 1536 MB
  defaultBytesPerTask: 100 * MB,
  maxIncreasePerDecision: 5,
};

const task = (executionId: string, taskType = 't', cost = 2): RunningTaskSnapshot => ({
  executionId,
  taskId: `task-${executionId}`,
  taskType,
  cost,
});

const setup = (opts: { estimator?: TaskMemoryEstimator } = {}) => {
  let usedHeapBytes = 1000 * MB;
  let running: RunningTaskSnapshot[] = [];
  const controller = new AdaptiveCapacityController({
    logger: loggingSystemMock.createLogger(),
    settings,
    getHeapStats: () => ({ usedHeapBytes, heapLimitBytes: LIMIT }),
    getRunningTasks: () => running,
    estimator: opts.estimator,
  });
  return {
    controller,
    setHeap: (mb: number) => (usedHeapBytes = mb * MB),
    setRunning: (tasks: RunningTaskSnapshot[]) => (running = tasks),
  };
};

describe('AdaptiveCapacityController', () => {
  it('starts from the minimum and steps up by at most maxIncreasePerDecision', () => {
    const { controller } = setup();
    // budget 536 MB / 100 MB per task = 5 free slots, capped by +5 per decision from min 2
    expect(controller.state.free_slots).toBe(5);
    expect(controller.state.capacity).toBe(5);
    expect(controller.refresh('tick')).toBe(5);
  });

  it('keeps room for the tasks already running', () => {
    const { controller, setRunning } = setup();
    setRunning([task('a'), task('b')]);
    controller.refresh('claim');
    // projected = baseline 1000 + 2 * 100 MB = 1200; budget 336 MB -> 3 free + 2 running
    expect(controller.state.heap_projected_bytes).toBe(1200 * MB);
    expect(controller.state.capacity).toBe(5);
  });

  it('drops to the running set when the heap is above target, never below min', () => {
    const { controller, setHeap, setRunning } = setup();
    setRunning([task('a')]);
    setHeap(1700);
    expect(controller.refresh('claim')).toBe(settings.minCapacity);
    expect(controller.state.heap_budget_bytes).toBeLessThan(0);
    expect(controller.state.free_slots).toBe(0);
  });

  it('uses learned per-type estimates and recovers once the heap is released', () => {
    const estimator = new TaskMemoryEstimator({ defaultBytesPerCostUnit: 50 * MB });
    const { controller, setHeap, setRunning } = setup({ estimator });
    const tasks = [1, 2, 3, 4].map((i) => task(`${i}`, 'heavy'));
    setRunning(tasks);
    controller.tick();
    setHeap(1400); // +400 MB while 4 tasks ran -> 50 MB per cost unit, 100 MB per task
    controller.tick();
    setRunning([]);
    controller.tick();
    expect(estimator.estimateBytes('task-1', 'heavy', 2)).toBe(100 * MB);

    // heap still holds garbage: projected = max(1400, baseline) -> 136 MB budget -> 1 slot, min applies
    expect(controller.state.capacity).toBe(settings.minCapacity);
    setHeap(1000);
    controller.tick();
    // baseline drifts down from 1400 towards 1000, so the budget opens gradually
    expect(controller.state.capacity).toBeGreaterThan(settings.minCapacity);
    expect(controller.state.estimates[0]).toEqual({
      task_type: 'heavy',
      bytes_per_cost_unit: 50 * MB,
      samples: 4,
    });
  });

  it('never exceeds maxCapacity and emits only on change', () => {
    const estimator = new TaskMemoryEstimator({ defaultBytesPerCostUnit: 5 * MB });
    const { controller, setHeap } = setup({ estimator });
    const seen: number[] = [];
    controller.capacity$.subscribe((value) => seen.push(value));
    setHeap(100);
    for (let i = 0; i < 20; i++) controller.refresh('tick');
    expect(controller.state.capacity).toBe(settings.maxCapacity);
    // the first decision runs in the constructor: min 2 + 5, then +5 per refresh
    expect(seen).toEqual([7, 12, 17, 22, 27, 32, 37, 42, 47, 50]);
  });

  it('only lowers capacity at claim time and raises it on the timer', () => {
    const estimator = new TaskMemoryEstimator({ defaultBytesPerCostUnit: 5 * MB });
    const { controller, setHeap } = setup({ estimator });
    const start = controller.state.capacity;
    setHeap(100);
    expect(controller.refresh('claim')).toBe(start);
    expect(controller.refresh('tick')).toBe(start + settings.maxIncreasePerDecision);
    setHeap(1700);
    expect(controller.refresh('claim')).toBe(settings.minCapacity);
  });

  it('attributes the growth since the last sample to a run that ends between ticks', () => {
    const estimator = new TaskMemoryEstimator({ defaultBytesPerCostUnit: 5 * MB });
    const { controller, setHeap, setRunning } = setup({ estimator });
    controller.tick();
    const fast = task('fast', 'quick', 1);
    setRunning([fast]);
    setHeap(1040);
    setRunning([]);
    controller.taskEnded(fast);
    expect(estimator.estimateBytes('task-fast', 'quick', 1)).toBe(40 * MB);
  });

  it('lowers the idle baseline slowly so garbage does not read as demand for long', () => {
    const { controller, setHeap } = setup();
    setHeap(1400);
    controller.refresh('tick');
    expect(controller.state.heap_baseline_bytes).toBe(1080 * MB);
    expect(controller.state.heap_projected_bytes).toBe(1400 * MB);
  });
});
