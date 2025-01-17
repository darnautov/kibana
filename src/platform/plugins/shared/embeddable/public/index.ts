/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { PluginInitializerContext } from '@kbn/core/public';
import { EmbeddablePublicPlugin } from './plugin';

export { useAddFromLibraryTypes } from './add_from_library/registry';
export { openAddFromLibraryFlyout } from './add_from_library/open_add_from_library_flyout';
export {
  cellValueTrigger,
  CELL_VALUE_TRIGGER,
  contextMenuTrigger,
  CONTEXT_MENU_TRIGGER,
  EmbeddableStateTransfer,
  isMultiValueClickTriggerContext,
  isRangeSelectTriggerContext,
  isRowClickTriggerContext,
  isValueClickTriggerContext,
  MULTI_VALUE_CLICK_TRIGGER,
  panelBadgeTrigger,
  panelHoverTrigger,
  PanelNotFoundError,
  PanelIncompatibleError,
  panelNotificationTrigger,
  PANEL_BADGE_TRIGGER,
  PANEL_HOVER_TRIGGER,
  PANEL_NOTIFICATION_TRIGGER,
  SELECT_RANGE_TRIGGER,
  VALUE_CLICK_TRIGGER,
  ViewMode,
} from './lib';
export type {
  CellValueContext,
  ChartActionContext,
  EmbeddableEditorState,
  EmbeddablePackageState,
  MultiValueClickContext,
  PropertySpec,
  RangeSelectContext,
  ValueClickContext,
} from './lib';
export type { EmbeddableSetup, EmbeddableStart } from './types';
export type { EnhancementRegistryDefinition } from './enhancements/types';

export {
  ReactEmbeddableRenderer,
  type DefaultEmbeddableApi,
  type ReactEmbeddableFactory,
} from './react_embeddable_system';

export function plugin(initializerContext: PluginInitializerContext) {
  return new EmbeddablePublicPlugin(initializerContext);
}

export { COMMON_EMBEDDABLE_GROUPING } from './lib/embeddables/common/constants';
