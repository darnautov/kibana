/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ExceptionListItemSchema } from '@kbn/securitysolution-io-ts-list-types';
import type { estypes } from '@elastic/elasticsearch';
import type { LicensingPluginSetup } from '@kbn/licensing-plugin/server';

import type {
  AlertInstanceContext,
  AlertInstanceState,
  RuleExecutorServices,
} from '@kbn/alerting-plugin/server';
import type { ListClient } from '@kbn/lists-plugin/server';
import type { Filter } from '@kbn/es-query';
import type {
  RuleRangeTuple,
  BulkCreate,
  WrapHits,
  WrapSuppressedHits,
  RunOpts,
  CreateRuleOptions,
} from '../types';
import type { ITelemetryEventsSender } from '../../../telemetry/sender';
import { createThreatSignals } from './threat_mapping/create_threat_signals';
import type { CompleteRule, ThreatRuleParams } from '../../rule_schema';
import { withSecuritySpan } from '../../../../utils/with_security_span';
import { DEFAULT_INDICATOR_SOURCE_PATH } from '../../../../../common/constants';
import type { IRuleExecutionLogForExecutors } from '../../rule_monitoring';
import { MAX_PER_PAGE } from './threat_mapping/get_event_count';
import type { ExperimentalFeatures } from '../../../../../common';

export const indicatorMatchExecutor = async ({
  inputIndex,
  runtimeMappings,
  completeRule,
  tuple,
  listClient,
  services,
  version,
  searchAfterSize,
  ruleExecutionLogger,
  eventsTelemetry,
  bulkCreate,
  wrapHits,
  primaryTimestamp,
  secondaryTimestamp,
  exceptionFilter,
  unprocessedExceptions,
  wrapSuppressedHits,
  runOpts,
  licensing,
  experimentalFeatures,
  scheduleNotificationResponseActionsService,
}: {
  inputIndex: string[];
  runtimeMappings: estypes.MappingRuntimeFields | undefined;
  completeRule: CompleteRule<ThreatRuleParams>;
  tuple: RuleRangeTuple;
  listClient: ListClient;
  services: RuleExecutorServices<AlertInstanceState, AlertInstanceContext, 'default'>;
  version: string;
  searchAfterSize: number;
  ruleExecutionLogger: IRuleExecutionLogForExecutors;
  eventsTelemetry: ITelemetryEventsSender | undefined;
  bulkCreate: BulkCreate;
  wrapHits: WrapHits;
  primaryTimestamp: string;
  secondaryTimestamp?: string;
  exceptionFilter: Filter | undefined;
  unprocessedExceptions: ExceptionListItemSchema[];
  wrapSuppressedHits: WrapSuppressedHits;
  runOpts: RunOpts<ThreatRuleParams>;
  licensing: LicensingPluginSetup;
  scheduleNotificationResponseActionsService: CreateRuleOptions['scheduleNotificationResponseActionsService'];
  experimentalFeatures: ExperimentalFeatures;
}) => {
  const ruleParams = completeRule.ruleParams;

  return withSecuritySpan('indicatorMatchExecutor', async () => {
    return createThreatSignals({
      alertId: completeRule.alertId,
      bulkCreate,
      completeRule,
      concurrentSearches: ruleParams.concurrentSearches ?? 1,
      eventsTelemetry,
      filters: ruleParams.filters ?? [],
      inputIndex,
      itemsPerSearch: ruleParams.itemsPerSearch ?? MAX_PER_PAGE,
      language: ruleParams.language,
      listClient,
      outputIndex: ruleParams.outputIndex,
      query: ruleParams.query,
      ruleExecutionLogger,
      savedId: ruleParams.savedId,
      searchAfterSize,
      services,
      threatFilters: ruleParams.threatFilters ?? [],
      threatIndex: ruleParams.threatIndex,
      threatIndicatorPath: ruleParams.threatIndicatorPath ?? DEFAULT_INDICATOR_SOURCE_PATH,
      threatLanguage: ruleParams.threatLanguage,
      threatMapping: ruleParams.threatMapping,
      threatQuery: ruleParams.threatQuery,
      tuple,
      type: ruleParams.type,
      wrapHits,
      wrapSuppressedHits,
      runtimeMappings,
      primaryTimestamp,
      secondaryTimestamp,
      exceptionFilter,
      unprocessedExceptions,
      runOpts,
      licensing,
      experimentalFeatures,
      scheduleNotificationResponseActionsService,
    });
  });
};
