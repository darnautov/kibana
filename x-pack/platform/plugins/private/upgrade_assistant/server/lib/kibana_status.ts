/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { DeprecationsClient, DomainDeprecationDetails } from '@kbn/core/server';

export const getKibanaUpgradeStatus = async (deprecationsClient: DeprecationsClient) => {
  const kibanaDeprecations: DomainDeprecationDetails[] =
    await deprecationsClient.getAllDeprecations();

  const totalCriticalDeprecations = kibanaDeprecations.filter(
    (d) => d.deprecationType !== 'api' && d.level === 'critical'
  ).length;

  const apiDeprecations = kibanaDeprecations.filter((d) => d.deprecationType === 'api');

  return {
    totalCriticalDeprecations,
    apiDeprecations,
  };
};
