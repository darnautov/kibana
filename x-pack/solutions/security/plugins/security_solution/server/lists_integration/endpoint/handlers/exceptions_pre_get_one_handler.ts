/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ExceptionListItemSchema } from '@kbn/securitysolution-io-ts-list-types';
import type { ExceptionsListPreGetOneItemServerExtension } from '@kbn/lists-plugin/server';
import type { EndpointAppContextService } from '../../../endpoint/endpoint_app_context_services';
import {
  BlocklistValidator,
  EndpointExceptionsValidator,
  EventFilterValidator,
  HostIsolationExceptionsValidator,
  TrustedAppValidator,
} from '../validators';

export const getExceptionsPreGetOneHandler = (
  endpointAppContextService: EndpointAppContextService
): ExceptionsListPreGetOneItemServerExtension['callback'] => {
  return async function ({ data, context: { request, exceptionListClient } }) {
    if (data.namespaceType !== 'agnostic') {
      return data;
    }

    const exceptionItem: ExceptionListItemSchema | null =
      await exceptionListClient.getExceptionListItem({
        id: data.id,
        itemId: data.itemId,
        namespaceType: data.namespaceType,
      });

    if (!exceptionItem) {
      return data;
    }

    const listId = exceptionItem.list_id;

    // Validate Trusted Applications
    if (TrustedAppValidator.isTrustedApp({ listId })) {
      await new TrustedAppValidator(endpointAppContextService, request).validatePreGetOneItem(
        exceptionItem
      );
      return data;
    }

    // validate Host Isolation Exception
    if (HostIsolationExceptionsValidator.isHostIsolationException({ listId })) {
      await new HostIsolationExceptionsValidator(
        endpointAppContextService,
        request
      ).validatePreGetOneItem(exceptionItem);
      return data;
    }

    // Event Filters Exception
    if (EventFilterValidator.isEventFilter({ listId })) {
      await new EventFilterValidator(endpointAppContextService, request).validatePreGetOneItem(
        exceptionItem
      );
      return data;
    }

    // Validate Blocklists
    if (BlocklistValidator.isBlocklist({ listId })) {
      await new BlocklistValidator(endpointAppContextService, request).validatePreGetOneItem(
        exceptionItem
      );
      return data;
    }

    // Validate Endpoint Exceptions
    if (EndpointExceptionsValidator.isEndpointException({ listId })) {
      await new EndpointExceptionsValidator(
        endpointAppContextService,
        request
      ).validatePreGetOneItem(exceptionItem);
      return data;
    }

    return data;
  };
};
