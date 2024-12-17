/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart } from '@kbn/core/public';
import type { ChartActionContext } from '@kbn/embeddable-plugin/public';
import { i18n } from '@kbn/i18n';
import type { LensApi } from '@kbn/lens-plugin/public';
import { isLensApi } from '@kbn/lens-plugin/public';
import { apiIsPresentationContainer } from '@kbn/presentation-containers';
import { apiHasParentApi } from '@kbn/presentation-publishing';
import type { UiActionsActionDefinition } from '@kbn/ui-actions-plugin/public';
import type { ActionDefinitionContext } from '@kbn/ui-actions-plugin/public/actions';
import type { AiopsPluginStartDeps } from '../../types';

export const FIND_CORRELATIONS_CONTEXT_MENU_ACTION = 'findCorrelationsContextMenuAction';

export type LensApiOnDashboard = LensApi;

export function isCompatibleEmbeddable(embeddable: unknown): embeddable is LensApi {
  return (
    isLensApi(embeddable) &&
    apiHasParentApi(embeddable) &&
    apiIsPresentationContainer(embeddable.parentApi)
  );
}

export type FindCorrelationsActionContext = ActionDefinitionContext<
  ChartActionContext & { embeddable: LensApi & Required<Pick<LensApi, 'parentApi'>> }
>;

export function createFindCorrelationsAction(
  coreStart: CoreStart,
  pluginStart: AiopsPluginStartDeps
): UiActionsActionDefinition<FindCorrelationsActionContext> {
  return {
    id: 'find-correlations-action',
    type: FIND_CORRELATIONS_CONTEXT_MENU_ACTION,
    order: 8,
    grouping: [{ id: 'ml', order: 2 }],
    getIconType(): string {
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

        await startCorrelationsAnalysis(coreStart, pluginStart, context);
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
