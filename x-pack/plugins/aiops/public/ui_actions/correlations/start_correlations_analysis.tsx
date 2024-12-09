/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart } from '@kbn/core/public';
import type { PresentationContainer } from '@kbn/presentation-containers';
import { tracksOverlays } from '@kbn/presentation-containers';
import { toMountPoint } from '@kbn/react-kibana-mount';
import React from 'react';
import { i18n } from '@kbn/i18n';
import { EuiButton, EuiFlexGroup, EuiFlexItem } from '@elastic/eui';
import { FormattedMessage } from '@kbn/i18n-react';
import { AiopsAppContext } from '../../hooks/use_aiops_app_context';
import type { AiopsPluginStartDeps } from '../../types';
import { CorrelationsFlyout } from './correlations_flyout';

export async function startCorrelationsAnalysis(
  coreStart: CoreStart,
  pluginStart: AiopsPluginStartDeps,
  parentApi: PresentationContainer,
  focusedPanelId: string,
  // TODO add support for click and brush input
  input?: any
): Promise<any> {
  const { overlays } = coreStart;

  const overlayTracker = tracksOverlays(parentApi) ? parentApi : undefined;

  // Instantiate a service and start the correlations analysis

  // Immediately show an info toast to inform the user that correlations results are loading
  coreStart.notifications.toasts.addInfo({
    title: i18n.translate('xpack.aiops.correlations.toastTitle', {
      defaultMessage: 'Detecting changes and correlations...',
    }),
    iconType: 'changePointDetection',
    toastLifeTimeMs: 30000,
    text: toMountPoint(
      <EuiFlexGroup justifyContent="flexEnd">
        <EuiFlexItem grow={false}>
          <EuiButton
            color="success"
            data-test-subj="aiopsStartCorrelationsAnalysisShowResultsButton"
          >
            <FormattedMessage
              id="xpack.aiops.correlations.toast.showResultsButtonLabel"
              defaultMessage="See results"
            />
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>,
      coreStart
    ),
    onClose: () => {
      // TODO cancel the request
    },
  });

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
