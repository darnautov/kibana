/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AIOPS_API_ENDPOINT } from '@kbn/aiops-common/constants';
import type { HttpStart } from '@kbn/core-http-browser';
import type { LensApi } from '@kbn/lens-plugin/public';
import { lensActions } from '@kbn/lens-plugin/public/state_management/lens_slice';
import { httpResponseIntoObservable } from '@kbn/sse-utils-client';
import type { Observable } from 'rxjs';
import { BehaviorSubject, Subscription, from } from 'rxjs';

export interface CorrelationResult {
  id: string;
  entityType: string;
  score: number;
}

export interface TargetMetric {
  indexPattern: string;
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
}

export class CorrelationsFinderService {
  private readonly _isLoading$ = new BehaviorSubject<boolean>(true);
  private readonly _results$ = new BehaviorSubject<CorrelationResult[]>([]);
  private readonly _subscription$ = new Subscription();

  constructor(private readonly http: HttpStart) {}

  public findCorrelations(lenEmbeddable: LensApi): void {
    const body = this.extractFieldsFromApi(lenEmbeddable);

    this._subscription$.add(
      from(
        this.http.post(AIOPS_API_ENDPOINT.CORRELATIONS, {
          // body: {},
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

  private extractFieldsFromApi(lensEmbeddable: LensApi) {
    const attr = lensEmbeddable.getFullAttributes();
    const dataFields = lensEmbeddable.getViewUnderlyingDataArgs();
  }

  public readonly isLoading$: Observable<boolean> = this._isLoading$.asObservable();
  public readonly results$: Observable<CorrelationResult[]> = this._results$.asObservable();

  public destroy(): void {
    this._subscription$.unsubscribe();
  }
}
