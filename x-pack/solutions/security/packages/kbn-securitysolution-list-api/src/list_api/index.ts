/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { chain, fromEither, map, tryCatch } from 'fp-ts/TaskEither';
import { flow } from 'fp-ts/function';
import { pipe } from 'fp-ts/pipeable';
import { validateEither } from '@kbn/securitysolution-io-ts-utils';
import {
  AcknowledgeSchema,
  DeleteListSchemaEncoded,
  ExportListItemQuerySchemaEncoded,
  FindListSchemaEncoded,
  FoundListSchema,
  ImportListItemQuerySchemaEncoded,
  ImportListItemSchemaEncoded,
  ListItemIndexExistSchema,
  ListSchema,
  ReadListSchema,
  acknowledgeSchema,
  deleteListSchema,
  readListSchema,
  exportListItemQuerySchema,
  findListSchema,
  foundListSchema,
  importListItemQuerySchema,
  importListItemSchema,
  listItemIndexExistSchema,
  listSchema,
  foundListsBySizeSchema,
  FoundListsBySizeSchema,
} from '@kbn/securitysolution-io-ts-list-types';
import {
  LIST_INDEX,
  LIST_ITEM_URL,
  LIST_PRIVILEGES_URL,
  LIST_URL,
  INTERNAL_FIND_LISTS_BY_SIZE,
} from '@kbn/securitysolution-list-constants';
import { toError, toPromise } from '../fp_utils';

import {
  ApiParams,
  DeleteListParams,
  ExportListParams,
  FindListsParams,
  ImportListParams,
  GetListByIdParams,
} from '../types';

export type {
  ApiParams,
  DeleteListParams,
  ExportListParams,
  FindListsParams,
  ImportListParams,
} from '../types';

const version = '2023-10-31';

const findLists = async ({
  http,
  cursor,
  page,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  per_page,
  signal,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  sort_field,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  sort_order,
}: ApiParams & FindListSchemaEncoded): Promise<FoundListSchema> => {
  return http.fetch(`${LIST_URL}/_find`, {
    method: 'GET',
    query: {
      cursor,
      page,
      per_page,
      sort_field,
      sort_order,
    },
    signal,
    version,
  });
};

const findListsWithValidation = async ({
  cursor,
  http,
  pageIndex,
  pageSize,
  signal,
  sortField,
  sortOrder,
}: FindListsParams): Promise<FoundListSchema> =>
  pipe(
    {
      cursor: cursor != null ? cursor.toString() : undefined,
      page: pageIndex != null ? pageIndex.toString() : undefined,
      per_page: pageSize != null ? pageSize.toString() : undefined,
      sort_field: sortField != null ? sortField.toString() : undefined,
      sort_order: sortOrder,
    },
    (payload) => fromEither(validateEither(findListSchema, payload)),
    chain((payload) => tryCatch(() => findLists({ http, signal, ...payload }), toError)),
    chain((response) => fromEither(validateEither(foundListSchema, response))),
    flow(toPromise)
  );

export { findListsWithValidation as findLists };

const findListsBySize = async ({
  http,
  cursor,
  page,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  per_page,
  signal,
}: ApiParams & FindListSchemaEncoded): Promise<FoundListsBySizeSchema> => {
  return http.fetch(`${INTERNAL_FIND_LISTS_BY_SIZE}`, {
    method: 'GET',
    version: '1',
    query: {
      cursor,
      page,
      per_page,
    },
    signal,
  });
};

const findListsBySizeWithValidation = async ({
  cursor,
  http,
  pageIndex,
  pageSize,
  signal,
}: FindListsParams): Promise<FoundListsBySizeSchema> =>
  pipe(
    {
      cursor: cursor != null ? cursor.toString() : undefined,
      page: pageIndex != null ? pageIndex.toString() : undefined,
      per_page: pageSize != null ? pageSize.toString() : undefined,
    },
    (payload) => fromEither(validateEither(findListSchema, payload)),
    chain((payload) => tryCatch(() => findListsBySize({ http, signal, ...payload }), toError)),
    chain((response) => fromEither(validateEither(foundListsBySizeSchema, response))),
    flow(toPromise)
  );

export { findListsBySizeWithValidation as findListsBySize };

const importList = async ({
  file,
  http,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  list_id,
  type,
  signal,
  refresh,
}: ApiParams &
  ImportListItemSchemaEncoded &
  ImportListItemQuerySchemaEncoded): Promise<ListSchema> => {
  const formData = new FormData();
  formData.append('file', file as Blob);

  return http.fetch<ListSchema>(`${LIST_ITEM_URL}/_import`, {
    body: formData,
    headers: { 'Content-Type': undefined },
    method: 'POST',
    query: { list_id, type, refresh },
    signal,
    version,
  });
};

const importListWithValidation = async ({
  file,
  http,
  listId,
  type,
  signal,
  refresh,
}: ImportListParams): Promise<ListSchema> =>
  pipe(
    {
      list_id: listId,
      type,
      refresh,
    },
    (query) => fromEither(validateEither(importListItemQuerySchema, query)),
    chain((query) =>
      pipe(
        fromEither(validateEither(importListItemSchema, { file })),
        map((body) => ({ ...body, ...query }))
      )
    ),
    chain((payload) => tryCatch(() => importList({ http, signal, ...payload }), toError)),
    chain((response) => fromEither(validateEither(listSchema, response))),
    toPromise
  );

export { importListWithValidation as importList };

const deleteList = async ({
  deleteReferences = false,
  http,
  id,
  ignoreReferences = false,
  signal,
}: ApiParams & DeleteListSchemaEncoded): Promise<ListSchema> =>
  http.fetch<ListSchema>(LIST_URL, {
    method: 'DELETE',
    query: { deleteReferences, id, ignoreReferences },
    signal,
    version,
  });

const deleteListWithValidation = async ({
  deleteReferences,
  http,
  id,
  ignoreReferences,
  signal,
}: DeleteListParams): Promise<ListSchema> =>
  pipe(
    { deleteReferences, id, ignoreReferences },
    (payload) => fromEither(validateEither(deleteListSchema, payload)),
    chain((payload) => tryCatch(() => deleteList({ http, signal, ...payload }), toError)),
    chain((response) => fromEither(validateEither(listSchema, response))),
    flow(toPromise)
  );

export { deleteListWithValidation as deleteList };

const exportList = async ({
  http,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  list_id,
  signal,
}: ApiParams & ExportListItemQuerySchemaEncoded): Promise<Blob> =>
  http.fetch<Blob>(`${LIST_ITEM_URL}/_export`, {
    method: 'POST',
    query: { list_id },
    signal,
    version,
  });

const exportListWithValidation = async ({
  http,
  listId,
  signal,
}: ExportListParams): Promise<Blob> =>
  pipe(
    { list_id: listId },
    (payload) => fromEither(validateEither(exportListItemQuerySchema, payload)),
    chain((payload) => tryCatch(() => exportList({ http, signal, ...payload }), toError)),
    flow(toPromise)
  );

export { exportListWithValidation as exportList };

const readListIndex = async ({ http, signal }: ApiParams): Promise<ListItemIndexExistSchema> =>
  http.fetch<ListItemIndexExistSchema>(LIST_INDEX, {
    method: 'GET',
    signal,
    version,
  });

const readListIndexWithValidation = async ({
  http,
  signal,
}: ApiParams): Promise<ListItemIndexExistSchema> =>
  flow(
    () => tryCatch(() => readListIndex({ http, signal }), toError),
    chain((response) => fromEither(validateEither(listItemIndexExistSchema, response))),
    flow(toPromise)
  )();

export { readListIndexWithValidation as readListIndex };

// TODO add types and validation
export const readListPrivileges = async ({ http, signal }: ApiParams): Promise<unknown> =>
  http.fetch<unknown>(LIST_PRIVILEGES_URL, {
    method: 'GET',
    signal,
    version,
  });

const createListIndex = async ({ http, signal }: ApiParams): Promise<AcknowledgeSchema> =>
  http.fetch<AcknowledgeSchema>(LIST_INDEX, {
    method: 'POST',
    signal,
    version,
  });

const createListIndexWithValidation = async ({
  http,
  signal,
}: ApiParams): Promise<AcknowledgeSchema> =>
  flow(
    () => tryCatch(() => createListIndex({ http, signal }), toError),
    chain((response) => fromEither(validateEither(acknowledgeSchema, response))),
    flow(toPromise)
  )();

export { createListIndexWithValidation as createListIndex };

const getListById = async ({
  http,
  signal,
  id,
}: ApiParams & ReadListSchema): Promise<ListSchema> => {
  return http.fetch(`${LIST_URL}`, {
    method: 'GET',
    query: {
      id,
    },
    signal,
    version,
  });
};

const getListByIdWithValidation = async ({
  http,
  signal,
  id,
}: GetListByIdParams): Promise<ListSchema> =>
  pipe(
    {
      id,
    },
    (payload) => fromEither(validateEither(readListSchema, payload)),
    chain((payload) => tryCatch(() => getListById({ http, signal, ...payload }), toError)),
    chain((response) => fromEither(validateEither(listSchema, response))),
    flow(toPromise)
  );

export { getListByIdWithValidation as getListById };
