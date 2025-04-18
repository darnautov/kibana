/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { UsageCounter } from '@kbn/usage-collection-plugin/server';
import { schema } from '@kbn/config-schema';
import { IRouter, StartServicesAccessor } from '@kbn/core/server';
import { DataViewsService } from '../../../common';
import { handleErrors } from './util/handle_errors';
import { dataViewSpecSchema } from '../schema';
import { DataViewSpecRestResponse } from '../route_types';
import type {
  DataViewsServerPluginStartDependencies,
  DataViewsServerPluginStart,
} from '../../types';
import {
  SPECIFIC_DATA_VIEW_PATH,
  SPECIFIC_DATA_VIEW_PATH_LEGACY,
  SERVICE_KEY,
  SERVICE_KEY_LEGACY,
  INITIAL_REST_VERSION,
  GET_DATA_VIEW_DESCRIPTION,
} from '../../constants';

interface GetDataViewArgs {
  dataViewsService: DataViewsService;
  usageCollection?: UsageCounter;
  counterName: string;
  id: string;
}

export const getDataView = async ({
  dataViewsService,
  usageCollection,
  counterName,
  id,
}: GetDataViewArgs) => {
  usageCollection?.incrementCounter({ counterName });
  return dataViewsService.getDataViewLazy(id);
};

const getDataViewRouteFactory =
  (path: string, serviceKey: string, description?: string) =>
  (
    router: IRouter,
    getStartServices: StartServicesAccessor<
      DataViewsServerPluginStartDependencies,
      DataViewsServerPluginStart
    >,
    usageCollection?: UsageCounter
  ) => {
    router.versioned
      .get({
        path,
        access: 'public',
        description,
        security: {
          authz: {
            enabled: false,
            reason: 'Authorization provided by saved objects client',
          },
        },
      })
      .addVersion(
        {
          version: INITIAL_REST_VERSION,
          validate: {
            request: {
              params: schema.object(
                {
                  id: schema.string({
                    minLength: 1,
                    maxLength: 1_000,
                  }),
                },
                { unknowns: 'allow' }
              ),
            },
            response: {
              200: {
                body: () =>
                  schema.object({
                    [serviceKey]: dataViewSpecSchema,
                  }),
              },
            },
          },
        },
        router.handleLegacyErrors(
          handleErrors(async (ctx, req, res) => {
            const core = await ctx.core;
            const savedObjectsClient = core.savedObjects.client;
            const elasticsearchClient = core.elasticsearch.client.asCurrentUser;
            const [, , { dataViewsServiceFactory }] = await getStartServices();
            const dataViewsService = await dataViewsServiceFactory(
              savedObjectsClient,
              elasticsearchClient,
              req
            );
            const id = req.params.id;

            const dataView = await getDataView({
              dataViewsService,
              usageCollection,
              counterName: `${req.route.method} ${path}`,
              id,
            });

            const responseBody: Record<string, DataViewSpecRestResponse> = {
              [serviceKey]: {
                ...(await dataView.toSpec({ fieldParams: { fieldName: ['*'] } })),
                namespaces: dataView.namespaces,
              },
            };

            return res.ok({
              headers: {
                'content-type': 'application/json',
              },
              body: responseBody,
            });
          })
        )
      );
  };

export const registerGetDataViewRoute = getDataViewRouteFactory(
  SPECIFIC_DATA_VIEW_PATH,
  SERVICE_KEY,
  GET_DATA_VIEW_DESCRIPTION
);

export const registerGetDataViewRouteLegacy = getDataViewRouteFactory(
  SPECIFIC_DATA_VIEW_PATH_LEGACY,
  SERVICE_KEY_LEGACY
);
