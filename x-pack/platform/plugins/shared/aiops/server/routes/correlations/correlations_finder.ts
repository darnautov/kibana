/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IScopedClusterClient } from '@kbn/core/server';
import type { Observable } from 'rxjs';
import { Subject } from 'rxjs';
import type {
  MappingRuntimeFields,
  QueryDslQueryContainer,
  SearchRequest,
} from '@elastic/elasticsearch/lib/api/typesWithBodyKey';
import { isDefined } from '@kbn/ml-is-defined';
import type { ServerSentEvent } from '@kbn/sse-utils';
import type { ChangePointAnnotation } from '../../../public/components/change_point_detection/change_point_detection_context';
import {
  EXCLUDED_CHANGE_POINT_TYPES,
  type ChangePointType,
} from '../../../public/components/change_point_detection/constants';
import type {
  AiopsCorrelationsRequestBody,
  CorrelationResponseEvent,
  CorrelationResult,
} from '../../../common/types/correlations';

interface RequestOptions {
  index: string;
  fn: string;
  metricField: string;
  splitField?: string;
  timeField: string;
  timeInterval: string;
  afterKey?: string;
}

export const COMPOSITE_AGG_SIZE = 500;

function getChangePointDetectionRequestBody(
  { index, fn, metricField, splitField, timeInterval, timeField, afterKey }: RequestOptions,
  query?: QueryDslQueryContainer,
  runtimeMappings?: MappingRuntimeFields
): SearchRequest {
  const timeSeriesAgg = {
    over_time: {
      date_histogram: {
        field: timeField,
        fixed_interval: timeInterval,
      },
      aggs: {
        function_value: {
          [fn]: {
            field: metricField,
          },
        },
      },
    },
    change_point_request: {
      change_point: {
        buckets_path: 'over_time>function_value',
      },
    },
    // Bucket selecting and sorting are only applicable for partitions
    ...(isDefined(splitField)
      ? {
          select: {
            bucket_selector: {
              buckets_path: { p_value: 'change_point_request.p_value' },
              script: 'params.p_value < 1',
            },
          },
          sort: {
            bucket_sort: {
              sort: [{ 'change_point_request.p_value': { order: 'asc' } }],
            },
          },
        }
      : {}),
  };

  const aggregations = splitField
    ? {
        groupings: {
          composite: {
            size: COMPOSITE_AGG_SIZE,
            ...(afterKey !== undefined ? { after: { splitFieldTerm: afterKey } } : {}),
            sources: [
              {
                splitFieldTerm: {
                  terms: {
                    field: splitField,
                  },
                },
              },
            ],
          },
          aggregations: timeSeriesAgg,
        },
      }
    : timeSeriesAgg;

  return {
    index,
    size: 0,
    body: {
      ...(query ? { query } : {}),
      ...(runtimeMappings ? { runtime_mappings: runtimeMappings } : {}),
      aggregations,
    },
  } as SearchRequest;
}

/**
 * Response type for aggregation with composite agg pagination.
 * TODO: update type for the single metric
 */
interface ChangePointAggResponse {
  took: number;
  timed_out: boolean;
  _shards: { total: number; failed: number; successful: number; skipped: number };
  hits: { hits: unknown[]; total: number; max_score: null };
  aggregations: {
    groupings: {
      after_key?: {
        splitFieldTerm: string;
      };
      buckets: Array<{
        key: { splitFieldTerm: string };
        doc_count: number;
        over_time: {
          buckets: Array<{
            key_as_string: string;
            doc_count: number;
            function_value: { value: number };
            key: number;
          }>;
        };
        change_point_request: {
          bucket?: { doc_count: number; function_value: { value: number }; key: string };
          type: {
            [key in ChangePointType]: { p_value: number; change_point: number; reason?: string };
          };
        };
      }>;
    };
  };
}

export class CorrelationsFinder {
  private _responseEvent$ = new Subject<ServerSentEvent>();

  constructor(private readonly _client: IScopedClusterClient) {}

  private formatChangePointDetectionResults(result: any, fieldConfig) {
    // TODO: Implement this
    const isSingleMetric = false;

    const buckets = (
      isSingleMetric ? [result.aggregations] : result.aggregations.groupings.buckets
    ) as ChangePointAggResponse['aggregations']['groupings']['buckets'];

    const groups = buckets
      .map((v) => {
        const changePointType = Object.keys(v.change_point_request.type)[0] as ChangePointType;
        const timeAsString = v.change_point_request.bucket?.key;
        const rawPValue = v.change_point_request.type[changePointType].p_value;

        return {
          ...(isSingleMetric
            ? {}
            : {
                group: {
                  name: fieldConfig.splitField,
                  value: v.key.splitFieldTerm,
                },
              }),
          type: changePointType,
          p_value: rawPValue,
          timestamp: timeAsString,
          label: changePointType,
          reason: v.change_point_request.type[changePointType].reason,
          id: isSingleMetric
            ? 'single_metric'
            : `${fieldConfig.splitField}_${v.key?.splitFieldTerm}`,
        } as ChangePointAnnotation;
      })
      .filter((v) => !EXCLUDED_CHANGE_POINT_TYPES.has(v.type));

    return groups;

    // if (Array.isArray(requestParams.changePointType)) {
    //   groups = groups.filter((v) => requestParams.changePointType!.includes(v.type));
    // }
  }

  private async fetchChangePoints(fieldConfig: AiopsCorrelationsRequestBody['targetMetric']) {
    const body = getChangePointDetectionRequestBody({
      index: fieldConfig.indexPattern,
      // fn: fieldConfig.operationType,
      fn: 'avg',
      metricField: fieldConfig.metricField,
      splitField: fieldConfig.splitField,
      timeField: fieldConfig.timeField,
      // timeInterval: fieldConfig.timeInterval,
      timeInterval: '8h',
    });

    const result = await this._client.asCurrentUser.search(body);
    // Format change point detection results
    const formattedResults = this.formatChangePointDetectionResults(result, fieldConfig);

    return { result: formattedResults, query: body };
  }

  private async startChangePointDetection(context: AiopsCorrelationsRequestBody): Promise<void> {
    // await this.fetchChangePoints(context.targetMetric);

    for (const fieldConfig of context.context) {
      const { result, query } = await this.fetchChangePoints(fieldConfig);

      this._responseEvent$.next({
        type: 'correlation',
        data: {
          type: 'change_point',
          target: fieldConfig,
          result,
          query,
        },
      });
    }
  }

  public getResultsObservable$(context: AiopsCorrelationsRequestBody): Observable<ServerSentEvent> {
    this.startChangePointDetection(context);
    return this._responseEvent$.asObservable();
  }
}
