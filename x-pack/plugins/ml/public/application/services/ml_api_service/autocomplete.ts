/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { HttpService } from '../http_service';
import { basePath } from '.';

export function autocompleteProvider(httpService: HttpService) {
  const apiBasePath = basePath();

  return {
    suggest(queryParams?: {
      method: string;
      url: string;
      line: number;
      column: number;
      jsonInput: string;
    }) {
      return httpService.http<string[]>({
        path: `${apiBasePath}/autocomplete`,
        method: 'GET',
        query: queryParams,
      });
    },
  };
}
