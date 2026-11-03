/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { metrics, ValueType } from '@opentelemetry/api';
import type { AdaptiveCapacityState } from '../lib/adaptive_capacity';

const METER_NAME = 'kibana.task_manager';

/**
 * Publishes the heap controller's latest decision as pull-based gauges, so the
 * same numbers shown in `_health` can be charted next to process heap metrics.
 */
export const registerAdaptiveCapacityTelemetry = (
  getState: () => AdaptiveCapacityState | undefined
): void => {
  const meter = metrics.getMeter(METER_NAME);

  const capacity = meter.createObservableGauge('kibana.task_manager.adaptive_capacity.capacity', {
    description: 'Capacity chosen by the heap controller, in normal-cost tasks.',
    unit: '{task}',
    valueType: ValueType.INT,
  });
  const heapBudget = meter.createObservableGauge(
    'kibana.task_manager.adaptive_capacity.heap.budget',
    {
      description:
        'Heap left for new tasks after the idle baseline and the running tasks; negative while over target.',
      unit: 'By',
      valueType: ValueType.INT,
    }
  );
  const heapProjected = meter.createObservableGauge(
    'kibana.task_manager.adaptive_capacity.heap.projected',
    {
      description: 'Heap the controller expects the running tasks to reach.',
      unit: 'By',
      valueType: ValueType.INT,
    }
  );
  const slotMemory = meter.createObservableGauge(
    'kibana.task_manager.adaptive_capacity.slot.memory',
    {
      description: 'Heap budgeted for one normal-cost slot, from the recent task mix.',
      unit: 'By',
      valueType: ValueType.INT,
    }
  );
  const liveRatio = meter.createObservableGauge(
    'kibana.task_manager.adaptive_capacity.heap.live_ratio',
    {
      description: 'Live-to-allocated heap ratio applied to the memory estimates.',
      unit: '1',
      valueType: ValueType.DOUBLE,
    }
  );
  const taskTypeMemory = meter.createObservableGauge(
    'kibana.task_manager.adaptive_capacity.task_type.memory',
    {
      description: 'Learned heap per cost unit for a task type.',
      unit: 'By',
      valueType: ValueType.INT,
    }
  );

  meter.addBatchObservableCallback(
    (result) => {
      const state = getState();
      if (!state) return;
      result.observe(capacity, state.capacity);
      result.observe(heapBudget, state.heap_budget_bytes);
      result.observe(heapProjected, state.heap_projected_bytes);
      result.observe(slotMemory, state.bytes_per_normal_task);
      result.observe(liveRatio, state.heap_live_ratio);
      for (const estimate of state.estimates) {
        result.observe(taskTypeMemory, estimate.bytes_per_cost_unit, {
          'task.type': estimate.task_type,
        });
      }
    },
    [capacity, heapBudget, heapProjected, slotMemory, liveRatio, taskTypeMemory]
  );
};
