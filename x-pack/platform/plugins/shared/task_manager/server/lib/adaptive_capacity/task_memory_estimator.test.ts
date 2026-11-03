/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { TaskMemoryEstimator } from './task_memory_estimator';

const MB = 1024 * 1024;

const run = (executionId: string, taskType: string, cost = 2, taskId = `task-${executionId}`) => ({
  executionId,
  taskId,
  taskType,
  cost,
});

describe('TaskMemoryEstimator', () => {
  it('uses the default for unobserved types', () => {
    const estimator = new TaskMemoryEstimator({ defaultBytesPerCostUnit: 64 * MB });
    expect(estimator.estimateBytes('task-x', 'unknown', 2)).toBe(128 * MB);
    expect(estimator.bytesPerCostUnit()).toBe(64 * MB);
    expect(estimator.hasObservations()).toBe(false);
  });

  it('attributes heap growth to the running tasks by cost', () => {
    const estimator = new TaskMemoryEstimator({ defaultBytesPerCostUnit: 64 * MB });
    const heavy = run('a', 'heavy', 4);
    const light = run('b', 'light', 1);
    estimator.sample(1000 * MB, [heavy, light]);
    estimator.sample(1100 * MB, [heavy, light]);
    estimator.sample(1050 * MB, [heavy, light]); // garbage collected, ignored
    estimator.sample(1050 * MB, []);

    // 100 MB growth split 4:1 by cost, then divided by cost -> 20 MB per cost unit each
    expect(estimator.estimateBytes('task-a', 'heavy', 4)).toBe(80 * MB);
    expect(estimator.estimateBytes('task-b', 'light', 1)).toBe(20 * MB);
    // an unseen instance of a seen type falls back to the type estimate
    expect(estimator.estimateBytes('task-new', 'heavy', 4)).toBe(80 * MB);
    expect(estimator.snapshot()).toEqual([
      { task_type: 'heavy', bytes_per_cost_unit: 20 * MB, samples: 1 },
      { task_type: 'light', bytes_per_cost_unit: 20 * MB, samples: 1 },
    ]);
  });

  it('smooths repeated observations of one type', () => {
    const estimator = new TaskMemoryEstimator({ defaultBytesPerCostUnit: 64 * MB, alpha: 0.5 });
    estimator.sample(0, [run('a', 't')]);
    estimator.sample(100 * MB, [run('a', 't')]);
    estimator.sample(100 * MB, []);
    expect(estimator.estimateBytes('task-a', 't', 2)).toBe(100 * MB);

    estimator.sample(100 * MB, [run('b', 't')]);
    estimator.sample(300 * MB, [run('b', 't')]);
    estimator.sample(300 * MB, []);
    // type: 0.5 * 100 + 0.5 * 50 = 75 MB per cost unit; instances keep their own history
    expect(estimator.estimateBytes('task-unseen', 't', 2)).toBe(150 * MB);
    expect(estimator.estimateBytes('task-a', 't', 2)).toBe(100 * MB);
    expect(estimator.estimateBytes('task-b', 't', 2)).toBe(200 * MB);
    expect(estimator.snapshot()[0].samples).toBe(2);
  });

  it('sizes a slot from the heavy end of the recent mix', () => {
    const estimator = new TaskMemoryEstimator({ defaultBytesPerCostUnit: 64 * MB });
    for (let i = 0; i < 9; i++) estimator.taskEnded(run(`cheap-${i}`, 'cheap', 1));
    estimator.sample(0, [run('heavy', 'heavy', 1)]);
    estimator.sample(30 * MB, [run('heavy', 'heavy', 1)]);
    estimator.taskEnded(run('heavy', 'heavy', 1));
    // 9 cheap runs at the floor and one 30 MB run: p90 lands on the heavy one
    expect(estimator.bytesPerCostUnit()).toBe(30 * MB);
  });

  it('scales estimates by the live-to-allocated ratio once calibrated', () => {
    const estimator = new TaskMemoryEstimator({
      defaultBytesPerCostUnit: 64 * MB,
      calibrationBytes: 100 * MB,
      alpha: 1,
    });
    estimator.sample(0, [run('a', 't', 1)]);
    estimator.liveSample(0);
    estimator.sample(200 * MB, [run('a', 't', 1)]); // 200 MB allocated by run a
    estimator.sample(200 * MB, []);
    expect(estimator.estimateBytes('task-a', 't', 1)).toBe(200 * MB);
    expect(estimator.liveRatio()).toBe(1);

    estimator.liveSample(50 * MB); // only 50 MB of it is live after GC -> ratio 0.25
    expect(estimator.liveRatio()).toBe(0.25);
    expect(estimator.estimateBytes('task-a', 't', 1)).toBe(50 * MB);
    expect(estimator.bytesPerCostUnit()).toBe(50 * MB);
    // the cold-start default is not scaled: it is a guess, not an allocation
    expect(estimator.estimateBytes('task-new', 'other', 1)).toBe(64 * MB);
  });

  it('sizes slots from heavy runs only, even when light runs dominate', () => {
    const estimator = new TaskMemoryEstimator({
      defaultBytesPerCostUnit: 64 * MB,
      lightBytesPerCostUnit: 4 * MB,
    });
    // 20 light runs at 1 MB and two heavy runs at 50 MB
    for (let i = 0; i < 20; i++) {
      estimator.sample(0, [run(`l${i}`, 'light', 1)]);
      estimator.sample(MB, [run(`l${i}`, 'light', 1)]);
      estimator.sample(MB, []);
    }
    for (const id of ['h1', 'h2']) {
      estimator.sample(0, [run(id, 'heavy', 1)]);
      estimator.sample(50 * MB, [run(id, 'heavy', 1)]);
      estimator.sample(50 * MB, []);
    }
    expect(estimator.bytesPerCostUnit()).toBe(50 * MB);
    // with no heavy run observed yet the cold-start default applies
    const fresh = new TaskMemoryEstimator({
      defaultBytesPerCostUnit: 64 * MB,
      lightBytesPerCostUnit: 4 * MB,
    });
    fresh.taskEnded(run('l', 'light', 1));
    expect(fresh.bytesPerCostUnit()).toBe(64 * MB);
  });

  it('records a run that ends between samples, clamped to the minimum', () => {
    const estimator = new TaskMemoryEstimator({
      defaultBytesPerCostUnit: 64 * MB,
      minBytesPerCostUnit: MB,
    });
    estimator.taskEnded(run('fast', 'tiny', 1));
    expect(estimator.hasObservations()).toBe(true);
    expect(estimator.estimateBytes('task-fast', 'tiny', 1)).toBe(MB);
  });

  it('does not count a run twice when it ends and then leaves the sample', () => {
    const estimator = new TaskMemoryEstimator({ defaultBytesPerCostUnit: 64 * MB });
    estimator.sample(0, [run('a', 't')]);
    estimator.sample(50 * MB, [run('a', 't')]);
    estimator.taskEnded(run('a', 't'));
    estimator.sample(50 * MB, []);
    expect(estimator.snapshot()[0].samples).toBe(1);
  });
});
