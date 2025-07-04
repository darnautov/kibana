/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { coreMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { licensingMock } from '@kbn/licensing-plugin/server/mocks';
import { actionsClientMock } from '@kbn/actions-plugin/server/actions_client/actions_client.mock';
import { eventLoggerMock } from '@kbn/event-log-plugin/server/mocks';
import { inferenceMock } from '@kbn/inference-plugin/server/mocks';
import { MockedKeys } from '@kbn/utility-types-jest';
import { AwaitedProperties } from '@kbn/utility-types';
import {
  ElasticAssistantApiRequestHandlerContext,
  ElasticAssistantRequestHandlerContext,
} from '../types';
import { PluginStartContract as ActionsPluginStart } from '@kbn/actions-plugin/server';
import {
  attackDiscoveryDataClientMock,
  attackDiscoveryScheduleDataClientMock,
  conversationsDataClientMock,
  dataClientMock,
  knowledgeBaseDataClientMock,
} from './data_clients.mock';
import { AIAssistantConversationsDataClient } from '../ai_assistant_data_clients/conversations';
import { AIAssistantDataClient } from '../ai_assistant_data_clients';
import {
  AIAssistantKnowledgeBaseDataClient,
  GetAIAssistantKnowledgeBaseDataClientParams,
} from '../ai_assistant_data_clients/knowledge_base';
import { defaultAssistantFeatures } from '@kbn/elastic-assistant-common';
import { AttackDiscoveryDataClient } from '../lib/attack_discovery/persistence';
import { DefendInsightsDataClient } from '../lib/defend_insights/persistence';
import { authenticatedUser } from './user';
import { AttackDiscoveryScheduleDataClient } from '../lib/attack_discovery/schedules/data_client';

export const createMockClients = () => {
  const core = coreMock.createRequestHandlerContext();
  const license = licensingMock.createLicenseMock();
  const eventLogger = eventLoggerMock.create();

  return {
    core,
    clusterClient: core.elasticsearch.client,
    elasticAssistant: {
      actions: actionsClientMock.create(),
      getRegisteredFeatures: jest.fn(() => defaultAssistantFeatures),
      getRegisteredTools: jest.fn(),
      logger: loggingSystemMock.createLogger(),
      telemetry: coreMock.createSetup().analytics,
      getAIAssistantConversationsDataClient: conversationsDataClientMock.create(),
      getAIAssistantKnowledgeBaseDataClient: knowledgeBaseDataClientMock.create(),
      getAIAssistantPromptsDataClient: dataClientMock.create(),
      getAttackDiscoveryDataClient: attackDiscoveryDataClientMock.create(),
      getAttackDiscoverySchedulingDataClient: attackDiscoveryScheduleDataClientMock.create(),
      getDefendInsightsDataClient: dataClientMock.create(),
      getAIAssistantAnonymizationFieldsDataClient: dataClientMock.create(),
      getAlertSummaryDataClient: dataClientMock.create(),
      getSpaceId: jest.fn(),
      getCurrentUser: jest.fn(),
      inference: jest.fn(),
      llmTasks: jest.fn(),
      savedObjectsClient: core.savedObjects.client,
    },
    eventLogger,
    licensing: {
      ...licensingMock.createRequestHandlerContext({ license }),
      license,
    },

    config: createMockConfig(),
    appClient: createAppClientMock(),
  };
};

type MockClients = ReturnType<typeof createMockClients>;

export type ElasticAssistantRequestHandlerContextMock = MockedKeys<
  AwaitedProperties<ElasticAssistantRequestHandlerContext>
> & {
  core: MockClients['core'];
};

const createMockConfig = () => ({});

const createAppClientMock = () => ({});

const license = licensingMock.createLicense({ license: { type: 'enterprise' } });
const createRequestContextMock = (
  clients: MockClients = createMockClients()
): ElasticAssistantRequestHandlerContextMock => {
  return {
    core: clients.core,
    elasticAssistant: createElasticAssistantRequestContextMock(clients),
    licensing: licensingMock.createRequestHandlerContext({ license }),
    resolve: jest.fn(),
  };
};

const convertRequestContextMock = (
  context: AwaitedProperties<ElasticAssistantRequestHandlerContextMock>
): ElasticAssistantRequestHandlerContext => {
  return coreMock.createCustomRequestHandlerContext(
    context
  ) as unknown as ElasticAssistantRequestHandlerContext;
};

const createElasticAssistantRequestContextMock = (
  clients: MockClients
): jest.Mocked<ElasticAssistantApiRequestHandlerContext> => {
  return {
    actions: clients.elasticAssistant.actions as unknown as ActionsPluginStart,
    eventLogger: clients.eventLogger,
    eventLogIndex: '.kibana-event-log-*',
    getRegisteredFeatures: jest.fn((pluginName: string) => defaultAssistantFeatures),
    getRegisteredTools: jest.fn(),
    logger: clients.elasticAssistant.logger,

    getAIAssistantConversationsDataClient: jest.fn(
      () => clients.elasticAssistant.getAIAssistantConversationsDataClient
    ) as unknown as jest.MockInstance<
      Promise<AIAssistantConversationsDataClient | null>,
      [],
      unknown
    > &
      (() => Promise<AIAssistantConversationsDataClient | null>),

    getAIAssistantAnonymizationFieldsDataClient: jest.fn(
      () => clients.elasticAssistant.getAIAssistantAnonymizationFieldsDataClient
    ) as unknown as jest.MockInstance<Promise<AIAssistantDataClient | null>, [], unknown> &
      (() => Promise<AIAssistantDataClient | null>),
    getAIAssistantPromptsDataClient: jest.fn(
      () => clients.elasticAssistant.getAIAssistantPromptsDataClient
    ) as unknown as jest.MockInstance<Promise<AIAssistantDataClient | null>, [], unknown> &
      (() => Promise<AIAssistantDataClient | null>),
    getAlertSummaryDataClient: jest.fn(
      () => clients.elasticAssistant.getAlertSummaryDataClient
    ) as unknown as jest.MockInstance<Promise<AIAssistantDataClient | null>, [], unknown> &
      (() => Promise<AIAssistantDataClient | null>),
    getAttackDiscoveryDataClient: jest.fn(
      () => clients.elasticAssistant.getAttackDiscoveryDataClient
    ) as unknown as jest.MockInstance<Promise<AttackDiscoveryDataClient | null>, [], unknown> &
      (() => Promise<AttackDiscoveryDataClient | null>),
    getAttackDiscoverySchedulingDataClient: jest.fn(
      () => clients.elasticAssistant.getAttackDiscoverySchedulingDataClient
    ) as unknown as jest.MockInstance<
      Promise<AttackDiscoveryScheduleDataClient | null>,
      [],
      unknown
    > &
      (() => Promise<AttackDiscoveryScheduleDataClient | null>),
    getDefendInsightsDataClient: jest.fn(
      () => clients.elasticAssistant.getDefendInsightsDataClient
    ) as unknown as jest.MockInstance<Promise<DefendInsightsDataClient | null>, [], unknown> &
      (() => Promise<DefendInsightsDataClient | null>),
    getAIAssistantKnowledgeBaseDataClient: jest.fn(
      () => clients.elasticAssistant.getAIAssistantKnowledgeBaseDataClient
    ) as unknown as jest.MockInstance<
      Promise<AIAssistantKnowledgeBaseDataClient | null>,
      [params?: GetAIAssistantKnowledgeBaseDataClientParams],
      unknown
    > &
      ((
        params?: GetAIAssistantKnowledgeBaseDataClientParams
      ) => Promise<AIAssistantKnowledgeBaseDataClient | null>),
    getCurrentUser: jest.fn().mockReturnValue(authenticatedUser),
    getServerBasePath: jest.fn(),
    getSpaceId: jest.fn().mockReturnValue('default'),
    inference: inferenceMock.createStartContract(),
    llmTasks: { retrieveDocumentationAvailable: jest.fn(), retrieveDocumentation: jest.fn() },
    core: clients.core,
    savedObjectsClient: clients.elasticAssistant.savedObjectsClient,
    telemetry: clients.elasticAssistant.telemetry,
    checkPrivileges: jest.fn(),
  };
};

const createTools = () => {
  const clients = createMockClients();
  const context = createRequestContextMock(clients);

  return { clients, context };
};

export const requestContextMock = {
  create: createRequestContextMock,
  convertContext: convertRequestContextMock,
  createTools,
};
