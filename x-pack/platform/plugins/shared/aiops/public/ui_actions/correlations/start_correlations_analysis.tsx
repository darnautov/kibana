/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart } from '@kbn/core/public';
import type { LensApi } from '@kbn/lens-plugin/public';
import { tracksOverlays } from '@kbn/presentation-containers';
import { toMountPoint } from '@kbn/react-kibana-mount';
import React from 'react';
import { AiopsAppContext } from '../../hooks/use_aiops_app_context';
import type { AiopsPluginStartDeps } from '../../types';
import { CorrelationsFinderService } from './correlations_finder_service';
import { CorrelationsFlyout } from './correlations_flyout';
import { showToast } from './toast_component';

export async function startCorrelationsAnalysis(
  coreStart: CoreStart,
  pluginStart: AiopsPluginStartDeps,
  lenEmbeddable: LensApi,
  // TODO add support for click and brush input
  input?: any
): Promise<any> {
  const { overlays } = coreStart;

  const { parentApi } = lenEmbeddable;

  const overlayTracker = tracksOverlays(parentApi) ? parentApi : undefined;

  // Instantiate a service and start the correlations analysis
  const correlationsFinderService = new CorrelationsFinderService(coreStart.http);
  correlationsFinderService.findCorrelations(lenEmbeddable);

  // Immediately show an info toast to inform the user that correlations results are loading
  const showResults = await showToast(coreStart, correlationsFinderService);

  if (!showResults) {
    correlationsFinderService.destroy();
    return;
  }

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
            <CorrelationsFlyout
              userInput={input}
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
          </AiopsAppContext.Provider>,
          coreStart
        ),
        {
          ownFocus: true,
          size: 'xl',
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
