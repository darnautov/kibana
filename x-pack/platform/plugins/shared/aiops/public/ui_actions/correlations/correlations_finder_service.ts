/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AIOPS_API_ENDPOINT } from '@kbn/aiops-common/constants';
import type { HttpStart } from '@kbn/core-http-browser';
import type { ChartActionContext } from '@kbn/embeddable-plugin/public';
import {
  isRangeSelectTriggerContext,
  isValueClickTriggerContext,
} from '@kbn/embeddable-plugin/public';
import type { FormBasedPersistedState, LensApi } from '@kbn/lens-plugin/public';
import { lensActions } from '@kbn/lens-plugin/public/state_management/lens_slice';
import { httpResponseIntoObservable } from '@kbn/sse-utils-client';
import type { Observable } from 'rxjs';
import { BehaviorSubject, Subscription, from } from 'rxjs';
import { lastValueFrom, firstValueFrom } from 'rxjs';
import { getIndexPatternFromESQLQuery, getTimeFieldFromESQLQuery } from '@kbn/esql-utils';
import type { TimeRange } from '@kbn/es-query';
import { isOfAggregateQueryType } from '@kbn/es-query';
import type { LensDocument } from '@kbn/lens-plugin/public/persistence';
import {
  isCompatibleEmbeddable,
  type FindCorrelationsActionContext,
} from './create_find_correlations_action';
import type {
  AiopsCorrelationsRequestBody,
  CorrelationResult,
} from '../../../common/types/correlations';

export interface TargetMetric {
  dataViewId: string;
  indexPattern: string;
  metricField: string;
  /** Function applied to the metric field */
  operationType: string;
  splitField?: string;
  timeField: string;
  timeRange: TimeRange;
}

export interface BodyPayload {
  /**
   * Target metric to find correlations for
   */
  target: TargetMetric;
  /**
   * Context metrics to find correlations with, e.g. on the same dashboard
   */
  context: TargetMetric[];
  /** User selected time range */
  timeSlice?: number[];
}

export class CorrelationsFinderService {
  private readonly _isLoading$ = new BehaviorSubject<boolean>(true);
  private readonly _results$ = new BehaviorSubject<CorrelationResult[]>([]);
  private readonly _subscription$ = new Subscription();

  constructor(private readonly http: HttpStart) {}

  public async findCorrelations(context: FindCorrelationsActionContext): Promise<void> {
    const targetVis = this.extractLensVis(context.embeddable);
    const visContext = await this.extractVisContext(context.embeddable);

    const body: AiopsCorrelationsRequestBody = {
      targetMetric: targetVis,
      context: visContext,
      timeSlice: this.getUserTimeInput(context),
    };

    console.log(body, '______body______');

    this._subscription$.add(
      from(
        this.http.post(AIOPS_API_ENDPOINT.CORRELATIONS, {
          body: JSON.stringify(body),
          asResponse: true,
          rawResponse: true,
          version: '1',
        })
      )
        .pipe(httpResponseIntoObservable())
        .subscribe((v) => {
          console.log(v, '______v______');
          if (v.type === 'correlation') {
            console.log('___RESUILT ADD');
            this._results$.next([...this._results$.value, v.data]);
          }
        })
    );
  }

  /**
   * Resolved time range from the user input, e.g. click or range select
   */
  private getUserTimeInput(context: FindCorrelationsActionContext): number | number[] | void {
    if (isValueClickTriggerContext(context)) {
      return context.data.data[0].value;
    } else if (isRangeSelectTriggerContext(context)) {
      return context.data.range;
    }
  }

  /**
   * Extract fields from the Lens embeddable.
   * Supports both Lens and ES|QL embeddables.
   */
  private extractLensVis(lensEmbeddable: LensApi): TargetMetric {
    const dataArgs = lensEmbeddable.getViewUnderlyingDataArgs();

    // debugger;

    // const savedVis = lensEmbeddable.getSavedVis();

    // savedVis.

    // attributes?.state.datasourceStates.;

    if (!dataArgs) {
      throw new Error('No data args found');
    }

    console.log(dataArgs, '______dataArgs______');

    let targetMetric: TargetMetric;

    if (isOfAggregateQueryType(dataArgs.query)) {
      const { esql: esqlQuery } = dataArgs.query;
      const indexPattern = getIndexPatternFromESQLQuery(esqlQuery);
      targetMetric = {
        indexPattern,
        metricField: '',
        timeField: getTimeFieldFromESQLQuery(esqlQuery),
      };
    } else {
      // Need to get full attributes to resolve fields
      const attributes = lensEmbeddable.getFullAttributes();

      const formBasedLayers = (
        (attributes as LensDocument).state.datasourceStates?.formBased as FormBasedPersistedState
      ).layers;

      if (!formBasedLayers) {
        throw new Error('No form based layers found');
      }

      let metricField: string;
      let splitField: string;
      let operationType: string;
      let timeField: string;

      Object.values(formBasedLayers).forEach((layer) => {
        const { columnOrder, columns } = layer;
        Object.values(columns).forEach((column) => {
          if (column.dataType === 'date') {
            // time field
            timeField = column.sourceField!;
          } else if (column.dataType === 'number') {
            // metric field
            metricField = column.sourceField!;
            operationType = column.operationType;
          } else if (column.isBucketed && column.dataType === 'string') {
            // group by field
            splitField = column.sourceField!;
          }
        });
      });

      // normal lens embeddable
      targetMetric = {
        dataViewId: dataArgs.dataViewSpec.id!,
        indexPattern: dataArgs.dataViewSpec.title!,
        metricField,
        operationType,
        splitField,
        timeField,
        timeRange: dataArgs.timeRange,
      };
    }

    return targetMetric;
  }

  private async extractVisContext(
    lensEmbeddable: FindCorrelationsActionContext['embeddable']
  ): Promise<TargetMetric[]> {
    const children = await firstValueFrom(lensEmbeddable.parentApi.children$);
    return Object.values(children)
      .filter((panel): panel is LensApi => {
        return isCompatibleEmbeddable(panel) && panel !== lensEmbeddable;
      })
      .map((panel) => this.extractLensVis(panel));
  }

  public readonly isLoading$: Observable<boolean> = this._isLoading$.asObservable();
  public readonly results$: Observable<CorrelationResult[]> = this._results$.asObservable();

  public destroy(): void {
    this._subscription$.unsubscribe();
  }
}
