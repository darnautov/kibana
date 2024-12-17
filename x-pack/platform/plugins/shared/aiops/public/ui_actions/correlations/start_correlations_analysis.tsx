/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart } from '@kbn/core/public';
import { tracksOverlays } from '@kbn/presentation-containers';
import { toMountPoint } from '@kbn/react-kibana-mount';
import React from 'react';
import { DatePickerContextProvider } from '@kbn/ml-date-picker';
import { pick } from 'lodash';
import { UI_SETTINGS } from '@kbn/data-service';
import { AiopsAppContext } from '../../hooks/use_aiops_app_context';
import type { AiopsPluginStartDeps } from '../../types';
import { CorrelationsFinderService } from './correlations_finder_service';
import { CorrelationsFlyout } from './correlations_flyout';
import type { FindCorrelationsActionContext } from './create_find_correlations_action';
import { showToast } from './toast_component';
import { FilterQueryContextProvider } from '../../hooks/use_filters_query';
import { DataSourceContextProvider } from '../../hooks/use_data_source';

export async function startCorrelationsAnalysis(
  coreStart: CoreStart,
  pluginStart: AiopsPluginStartDeps,
  actionContext: FindCorrelationsActionContext
): Promise<any> {
  const { overlays } = coreStart;

  const { embeddable: lensEmbeddable } = actionContext;

  const { parentApi } = lensEmbeddable;

  const overlayTracker = tracksOverlays(parentApi) ? parentApi : undefined;

  // Instantiate a service and start the correlations analysis
  const correlationsFinderService = new CorrelationsFinderService(coreStart.http);
  correlationsFinderService.findCorrelations(actionContext);

  // Immediately show an info toast to inform the user that correlations results are loading
  const showResults = await showToast(coreStart, correlationsFinderService);

  if (!showResults) {
    correlationsFinderService.destroy();
    return;
  }

  const deps = (() => {
    const { charts, lens, data, usageCollection, fieldFormats, share, storage, unifiedSearch } =
      pluginStart;

    return {
      charts,
      data,
      lens,
      usageCollection,
      fieldFormats,
      unifiedSearch,
      share,
      storage,
      ...coreStart,
    };
  })();

  const datePickerDeps = {
    ...pick(deps, ['data', 'http', 'notifications', 'theme', 'uiSettings', 'i18n']),
    uiSettingsKeys: UI_SETTINGS,
  };

  return new Promise(async (resolve, reject) => {
    try {
      const flyoutSession = overlays.openFlyout(
        toMountPoint(
          <AiopsAppContext.Provider
            value={{
              embeddingOrigin: 'flyout',
              ...coreStart,
              ...pluginStart,
            }}
          >
            <DatePickerContextProvider {...datePickerDeps}>
              <DataSourceContextProvider
                dataViews={pluginStart.data.dataViews}
                dataViewId={lensEmbeddable.getViewUnderlyingDataArgs()?.dataViewSpec.id}
              >
                <FilterQueryContextProvider>
                  <CorrelationsFlyout
                    service={correlationsFinderService}
                    onSave={(update) => {
                      resolve(update);
                      flyoutSession.close();
                      overlayTracker?.clearOverlays();
                    }}
                    onCancel={() => {
                      reject();
                      flyoutSession.close();
                      overlayTracker?.clearOverlays();
                    }}
                  />
                </FilterQueryContextProvider>
              </DataSourceContextProvider>
            </DatePickerContextProvider>
          </AiopsAppContext.Provider>,
          coreStart
        ),
        {
          ownFocus: true,
          size: 'm',
          type: 'push',
          'data-test-subj': 'aiopsCorrelationsFlyout',
          'aria-labelledby': 'correlationsFlyout',
          onClose: () => {
            reject();
            flyoutSession.close();
            overlayTracker?.clearOverlays();
          },
        }
      );

      if (tracksOverlays(parentApi)) {
        parentApi.openOverlay(flyoutSession, { focusedPanelId });
      }
    } catch (error) {
      reject(error);
    }
  });
}
