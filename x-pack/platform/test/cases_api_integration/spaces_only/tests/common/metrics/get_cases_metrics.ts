/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { CaseMetricsFeature } from '@kbn/cases-plugin/common';
import expect from '@kbn/expect';

import type { FtrProviderContext } from '../../../../common/ftr_provider_context';
import {
  deleteAllCaseItems,
  getAuthWithSuperUser,
  getCasesMetrics,
} from '../../../../common/lib/api';

export default ({ getService }: FtrProviderContext): void => {
  const es = getService('es');
  const supertestWithoutAuth = getService('supertestWithoutAuth');
  const kibanaServer = getService('kibanaServer');
  const authSpace1 = getAuthWithSuperUser();

  describe('all cases metrics', () => {
    before(async () => {
      await kibanaServer.importExport.load(
        'x-pack/test/functional/fixtures/kbn_archiver/cases/8.3.0/all_cases_metrics.json',
        { space: 'space1' }
      );

      await kibanaServer.importExport.load(
        'x-pack/test/functional/fixtures/kbn_archiver/cases/8.3.0/all_cases_metrics.json',
        { space: 'space2' }
      );
    });

    after(async () => {
      await kibanaServer.importExport.unload(
        'x-pack/test/functional/fixtures/kbn_archiver/cases/8.3.0/all_cases_metrics.json',
        { space: 'space1' }
      );

      await kibanaServer.importExport.unload(
        'x-pack/test/functional/fixtures/kbn_archiver/cases/8.3.0/all_cases_metrics.json',
        { space: 'space2' }
      );
      await deleteAllCaseItems(es);
    });

    describe('MTTR', () => {
      it('should calculate the mttr correctly on space 1', async () => {
        const metrics = await getCasesMetrics({
          supertest: supertestWithoutAuth,
          features: [CaseMetricsFeature.MTTR],
          auth: authSpace1,
        });

        expect(metrics).to.eql({ mttr: 220 });
      });

      it('should calculate the mttr correctly on space 2', async () => {
        const authSpace2 = getAuthWithSuperUser('space2');
        const metrics = await getCasesMetrics({
          supertest: supertestWithoutAuth,
          features: [CaseMetricsFeature.MTTR],
          auth: authSpace2,
        });

        expect(metrics).to.eql({ mttr: 220 });
      });
    });
  });
};
