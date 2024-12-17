/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AIOPS_API_ENDPOINT } from '@kbn/aiops-common/constants';
import type { TypeOf } from '@kbn/config-schema';
import { schema } from '@kbn/config-schema';
import type { CoreStart, IRouter, Logger } from '@kbn/core/server';
import type { DataRequestHandlerContext } from '@kbn/data-plugin/server';
import { observableIntoEventSourceStream } from '@kbn/sse-utils-server';
import type { UsageCounter } from '@kbn/usage-collection-plugin/server';
import type { AiopsLicense } from '../../types';
import { CorrelationsFinder } from './correlations_finder';

export const aiopsCorrelationMetricsSchema = schema.object({
  dataViewId: schema.string(),
  indexPattern: schema.string(),
  metricField: schema.string(),
  operationType: schema.string(),
  splitField: schema.maybe(schema.string()),
  timeField: schema.string(),
  timeRange: schema.object({
    from: schema.string(),
    to: schema.string(),
  }),
});

export const aiopsCorrelationsRequestSchema = schema.object({
  targetMetric: aiopsCorrelationMetricsSchema,
  context: schema.arrayOf(aiopsCorrelationMetricsSchema),
  timeSlice: schema.maybe(schema.arrayOf(schema.number())),
});

export type AiopsCorrelationsRequestBody = TypeOf<typeof aiopsCorrelationsRequestSchema>;

export const defineRoute = (
  router: IRouter<DataRequestHandlerContext>,
  license: AiopsLicense,
  logger: Logger,
  coreStart: CoreStart,
  usageCounter?: UsageCounter
) => {
  router.versioned
    .post({
      path: AIOPS_API_ENDPOINT.CORRELATIONS,
      access: 'internal',
    })
    .addVersion(
      {
        version: '1',
        security: {
          authz: {
            enabled: false,
            reason:
              'This route is opted out from authorization because permissions will be checked by elasticsearch',
          },
        },
        validate: {
          request: {
            body: aiopsCorrelationsRequestSchema,
          },
        },
      },
      async (context, request, response) => {
        const correlationsFinder = new CorrelationsFinder(
          (await context.core).elasticsearch.client
        );

        const controller = new AbortController();
        request.events.aborted$.subscribe(() => {
          controller.abort();
        });

        return response.ok({
          body: observableIntoEventSourceStream(
            correlationsFinder.getResultsObservable$(request.body),
            {
              logger,
              signal: controller.signal,
            }
          ),
        });
      }
    );
};
