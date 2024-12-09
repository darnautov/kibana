/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  CoreStart,
  IRouter,
  KibanaRequest,
  KibanaResponseFactory,
  RequestHandlerContext,
} from '@kbn/core/server';
import type { DataRequestHandlerContext } from '@kbn/data-plugin/server';
import type { UsageCounter } from '@kbn/usage-collection-plugin/server';
import { aiopsLogRateAnalysisSchemaV3 } from '@kbn/aiops-log-rate-analysis/api/schema_v3';
import { AIOPS_API_ENDPOINT } from '@kbn/aiops-common/constants';
import { observableIntoEventSourceStream } from '@kbn/sse-utils-server';
import { of } from 'rxjs';
import type { AiopsLicense } from '../../types';

export const defineRoute = (
  router: IRouter<DataRequestHandlerContext>,
  license: AiopsLicense,
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
        validate: false,
        // validate: {
        //   request: {
        //     body: aiopsLogRateAnalysisSchemaV3,
        //   },
        // },
      },
      async (
        context: RequestHandlerContext,
        request: KibanaRequest,
        response: KibanaResponseFactory
      ) => {
        return response.ok({
          body: observableIntoEventSourceStream(
            of({
              type: 'my_event_type',
              data: {
                anyData: {},
              },
            })
          ),
        });
      }
    );
};
