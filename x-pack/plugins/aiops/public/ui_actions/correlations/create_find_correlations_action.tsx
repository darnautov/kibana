/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart } from '@kbn/core/public';
import { i18n } from '@kbn/i18n';
import type { LensApi } from '@kbn/lens-plugin/public';
import { isLensApi } from '@kbn/lens-plugin/public';
import { apiIsPresentationContainer } from '@kbn/presentation-containers';
import type { EmbeddableApiContext } from '@kbn/presentation-publishing';
import { apiHasParentApi } from '@kbn/presentation-publishing';
import type { UiActionsActionDefinition } from '@kbn/ui-actions-plugin/public';
import type { AiopsPluginStartDeps } from '../../types';
// import { IncompatibleActionError } from '@kbn/ui-actions-plugin/public';

export const FIND_CORRELATIONS_CONTEXT_MENU_ACTION = 'findCorrelationsContextMenuAction';

export type LensApiOnDashboard = LensApi;

function isCompatibleEmbeddable(embeddable: unknown): embeddable is LensApi {
  return (
    isLensApi(embeddable) &&
    apiHasParentApi(embeddable) &&
    apiIsPresentationContainer(embeddable.parentApi)
  );
}

export function createFindCorrelationsAction(
  coreStart: CoreStart,
  pluginStart: AiopsPluginStartDeps
): UiActionsActionDefinition<EmbeddableApiContext> {
  return {
    id: 'find-correlations-action',
    type: FIND_CORRELATIONS_CONTEXT_MENU_ACTION,
    order: 8,
    grouping: [{ id: 'ml', order: 2 }],
    getIconType(context): string {
      return 'changePointDetection';
    },
    getDisplayName: () =>
      i18n.translate('xpack.aiops.correlations.actionsLabel', {
        defaultMessage: 'Find correlations',
      }),
    async execute(context) {
      try {
        if (!isCompatibleEmbeddable(context.embeddable)) {
          return;
        }

        const { startCorrelationsAnalysis } = await import('./start_correlations_analysis');

        const correlationPanels = await startCorrelationsAnalysis(
          coreStart,
          pluginStart,
          context.embeddable
        );

        // TODO Add panels to the active dashboard based on the results
        // presentationContainerParent.addNewPanel({
        //   panelType: EMBEDDABLE_CHANGE_POINT_CHART_TYPE,
        //   initialState,
        // });
      } catch (e) {
        return Promise.reject();
      }
    },
    async isCompatible(context) {
      const { embeddable } = context;
      return isCompatibleEmbeddable(embeddable);
    },
  };
}
