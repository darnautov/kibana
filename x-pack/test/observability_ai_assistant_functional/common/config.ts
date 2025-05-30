/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FtrConfigProviderContext } from '@kbn/test';
import { merge } from 'lodash';
import { UrlObject } from 'url';
import {
  KibanaEBTServerProvider,
  KibanaEBTUIProvider,
} from '@kbn/test-suites-src/analytics/services/kibana_ebt';
import {
  secondaryEditor,
  editor,
  viewer,
} from '../../observability_ai_assistant_api_integration/common/users/users';
import {
  ObservabilityAIAssistantFtrConfig,
  createObservabilityAIAssistantAPIConfig,
} from '../../observability_ai_assistant_api_integration/common/config';
import { getScopedApiClient } from '../../observability_ai_assistant_api_integration/common/observability_ai_assistant_api_client';
import { InheritedFtrProviderContext, InheritedServices } from '../ftr_provider_context';
import { ObservabilityAIAssistantUIProvider } from './ui';

export type CreateTestConfig = ReturnType<typeof createTestConfig>;
export type TestConfig = Awaited<ReturnType<typeof getTestConfig>>;

async function getTestConfig({
  license,
  name,
  kibanaConfig,
  readConfigFile,
}: {
  license: 'basic' | 'trial';
  name: string;
  kibanaConfig: Record<string, any> | undefined;
  readConfigFile: FtrConfigProviderContext['readConfigFile'];
}) {
  const testConfig = await readConfigFile(require.resolve('../../functional/config.base.js'));

  const baseConfig = createObservabilityAIAssistantAPIConfig({
    config: testConfig,
    license,
    name,
    kibanaConfig,
  });

  const kibanaServer = baseConfig.servers.kibana as UrlObject;

  return merge(
    {
      services: testConfig.get('services') as InheritedServices,
    },
    baseConfig,
    {
      testFiles: [require.resolve('../tests')],
      services: {
        observabilityAIAssistantUI: (context: InheritedFtrProviderContext) =>
          ObservabilityAIAssistantUIProvider(context),
        observabilityAIAssistantApi: async () => {
          return {
            admin: getScopedApiClient(kibanaServer, 'elastic'),
            viewer: getScopedApiClient(kibanaServer, viewer.username),
            editor: getScopedApiClient(kibanaServer, editor.username),
            secondaryEditor: getScopedApiClient(kibanaServer, secondaryEditor.username),
          };
        },
        kibana_ebt_server: KibanaEBTServerProvider,
        kibana_ebt_ui: KibanaEBTUIProvider,
      },
    }
  );
}

export function createTestConfig(config: ObservabilityAIAssistantFtrConfig) {
  const { license, name, kibanaConfig } = config;

  return async ({ readConfigFile }: FtrConfigProviderContext) => {
    return getTestConfig({ license, name, kibanaConfig, readConfigFile });
  };
}
