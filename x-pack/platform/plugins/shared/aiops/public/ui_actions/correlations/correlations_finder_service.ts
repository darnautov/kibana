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
import type { LensApi } from '@kbn/lens-plugin/public';
import { lensActions } from '@kbn/lens-plugin/public/state_management/lens_slice';
import { httpResponseIntoObservable } from '@kbn/sse-utils-client';
import type { Observable } from 'rxjs';
import { BehaviorSubject, Subscription, from } from 'rxjs';
import { lastValueFrom, firstValueFrom } from 'rxjs';
import { getIndexPatternFromESQLQuery } from '@kbn/esql-utils';
import type { FindCorrelationsActionContext } from './create_find_correlations_action';

export interface CorrelationResult {
  id: string;
  entityType: string;
  score: number;
}

export interface TargetMetric {
  dataViewId: string;
  metricField: string;
  timeField: string;
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
  /** Time range of the target metric */
  timeRange: number[];
}

export class CorrelationsFinderService {
  private readonly _isLoading$ = new BehaviorSubject<boolean>(true);
  private readonly _results$ = new BehaviorSubject<CorrelationResult[]>([]);
  private readonly _subscription$ = new Subscription();

  constructor(private readonly http: HttpStart) {}

  public findCorrelations(context: FindCorrelationsActionContext): void {
    const timestamp = this.getUserTimeInput(context);

    console.log(timestamp, '______timestamp______');

    const targetVis = this.extractLensVis(context.embeddable);
    const visContext = this.extractVisContext(context.embeddable);

    const body: BodyPayload = {
      target: targetVis,
      context: visContext,
      timeRange: [0, 0],
    };

    console.log(body, '______body______');

    this._subscription$.add(
      from(
        this.http.post(AIOPS_API_ENDPOINT.CORRELATIONS, {
          body,
          asResponse: true,
          rawResponse: true,
          version: '1',
        })
      )
        .pipe(httpResponseIntoObservable())
        .subscribe((v) => {
          console.log(v, '______v______');
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

  private extractLensVis(lensEmbeddable: LensApi): TargetMetric {
    const dataArgs = lensEmbeddable.getViewUnderlyingDataArgs();

    if (!dataArgs) {
      throw new Error('No data args found');
    }

    const esqlQuery = dataArgs.query.esql;

    if (esqlQuery) {
      const indexPattern = getIndexPatternFromESQLQuery(esqlQuery);
      console.log(indexPattern, '______indexPattern______');
    }

    return {
      dataViewId: dataArgs.dataViewSpec.id!,
      metricField: dataArgs.columns[1],
      timeField: dataArgs.columns[0],
    };
  }

  private extractEsqlVis(lensEmbeddable: LensApi): TargetMetric {
    const dataArgs = lensEmbeddable.getViewUnderlyingDataArgs();

    if (!dataArgs) {
      throw new Error('No data args found');
    }

    const esqlQuery = dataArgs.query.esql;

    if (esqlQuery) {
      const indexPattern = getIndexPatternFromESQLQuery(esqlQuery);
      console.log(indexPattern, '______indexPattern______');
    }

    return {
      dataViewId: dataArgs.dataViewSpec.id!,
      metricField: dataArgs.columns[1],
      timeField: dataArgs.columns[0],
    };
  }

  private async extractVisContext(
    lensEmbeddable: FindCorrelationsActionContext['embeddable']
  ): Promise<TargetMetric[]> {
    const children = await firstValueFrom(lensEmbeddable.parentApi.children$);
    return Object.values(children)
      .filter((panel) => {
        // TODO filter dashboard panels
        return true;
      })
      .map((panel) => this.extractLensVis(panel));
  }

  public readonly isLoading$: Observable<boolean> = this._isLoading$.asObservable();
  public readonly results$: Observable<CorrelationResult[]> = this._results$.asObservable();

  public destroy(): void {
    this._subscription$.unsubscribe();
  }
}
