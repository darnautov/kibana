/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { HttpStart } from '@kbn/core-http-browser';
import type { Observable } from 'rxjs';
import { BehaviorSubject } from 'rxjs';

export interface CorrelationResult {
  id: string;
  entityType: string;
  score: number;
}

export class CorrelationsFinderService {
  private readonly _isLoading$ = new BehaviorSubject<boolean>(true);
  private readonly _results$ = new BehaviorSubject<CorrelationResult[]>([]);

  constructor(private readonly httpStart: HttpStart) {
    // stream service
  }

  public readonly isLoading$: Observable<boolean> = this._isLoading$.asObservable();
  public readonly results$: Observable<CorrelationResult[]> = this._results$.asObservable();

  public destroy(): void {}
}
