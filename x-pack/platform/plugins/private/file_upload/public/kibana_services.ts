/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart } from '@kbn/core/public';
import type { FileUploadStartDependencies } from './plugin';

let coreStart: CoreStart;
let pluginsStart: FileUploadStartDependencies;
export function setStartServices(core: CoreStart, plugins: FileUploadStartDependencies) {
  coreStart = core;
  pluginsStart = plugins;
}

export const getDocLinks = () => coreStart.docLinks;
export const getDataViewsService = () => pluginsStart.data.dataViews;
export const getHttp = () => coreStart.http;
export const getUiSettings = () => coreStart.settings.client;
export const getSettings = () => coreStart.settings;
export const getTheme = () => coreStart.theme;
