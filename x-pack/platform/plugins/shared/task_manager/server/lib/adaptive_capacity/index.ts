/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export { AdaptiveCapacityController, readV8HeapStats } from './adaptive_capacity_controller';
export type {
  AdaptiveCapacitySettings,
  AdaptiveCapacityState,
  AdaptiveCapacityTrigger,
  HeapStats,
} from './adaptive_capacity_controller';
export { TaskMemoryEstimator } from './task_memory_estimator';
export type { TaskTypeMemoryEstimate } from './task_memory_estimator';
