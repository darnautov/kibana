/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import Autocomplete from 'elasticsearch-specification-autocompletion/lib';
import { wrapError } from '../client/error_wrapper';
import { autocompleteSchema } from './schemas/autocomplete_schema';
import { RouteInitialization } from '../types';

export function autoCompleteRoutes({ router, routeGuard }: RouteInitialization) {
  const autocomplete = new Autocomplete();

  router.get(
    {
      path: '/api/ml/autocomplete',
      validate: {
        query: autocompleteSchema,
      },
      options: {
        tags: [],
      },
    },
    routeGuard.fullLicenseAPIGuard(async ({ client, mlClient, request, response }) => {
      const { method, url, line, column, jsonInput } = request.query;

      try {
        const writeString = `${method} ${url}
${jsonInput}`;

        autocomplete.write(writeString);

        const suggestions = autocomplete.suggest(line, column);

        return response.ok({
          body: suggestions,
        });
      } catch (e) {
        return response.customError(wrapError(e));
      }
    })
  );
}
