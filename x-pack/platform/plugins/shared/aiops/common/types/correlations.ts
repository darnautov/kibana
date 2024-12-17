/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export interface CorrelationResult {
  id: string;
  entityType: string | 'change_point' | 'alert' | 'anomaly';
  score: number;
}

export { type AiopsCorrelationsRequestBody } from '../../server/routes/correlations/define_route';

export interface CorrelationResponseEvent {
  data: CorrelationResult[];
  type: string;
}
