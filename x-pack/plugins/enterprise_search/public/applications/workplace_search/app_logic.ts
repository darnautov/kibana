/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { kea, MakeLogicType } from 'kea';

import { InitialAppData } from '../../../common/types';
import {
  Organization,
  WorkplaceSearchInitialData,
  Account,
} from '../../../common/types/workplace_search';

interface AppValues extends WorkplaceSearchInitialData {
  hasInitialized: boolean;
  isOrganization: boolean;
}
interface AppActions {
  initializeAppData(props: InitialAppData): InitialAppData;
  setContext(isOrganization: boolean): boolean;
  setOrgName(name: string): string;
  setSourceRestriction(canCreatePersonalSources: boolean): boolean;
}

const emptyOrg = {} as Organization;
const emptyAccount = {} as Account;

export const AppLogic = kea<MakeLogicType<AppValues, AppActions>>({
  path: ['enterprise_search', 'workplace_search', 'app_logic'],
  actions: {
    initializeAppData: ({ workplaceSearch }) => ({ workplaceSearch }),
    setContext: (isOrganization) => isOrganization,
    setOrgName: (name: string) => name,
    setSourceRestriction: (canCreatePersonalSources: boolean) => canCreatePersonalSources,
  },
  reducers: {
    hasInitialized: [
      false,
      {
        initializeAppData: () => true,
      },
    ],
    isOrganization: [
      false,
      {
        setContext: (_, isOrganization) => isOrganization,
      },
    ],
    organization: [
      emptyOrg,
      {
        initializeAppData: (_, { workplaceSearch }) => workplaceSearch?.organization || emptyOrg,
        setOrgName: (state, name) => ({
          ...state,
          name,
        }),
      },
    ],
    account: [
      emptyAccount,
      {
        initializeAppData: (_, { workplaceSearch }) => workplaceSearch?.account || emptyAccount,
        setSourceRestriction: (state, canCreatePersonalSources) => ({
          ...state,
          canCreatePersonalSources,
        }),
      },
    ],
  },
});
