/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiFlyoutBody, EuiFlyoutHeader, EuiTitle } from '@elastic/eui';
import { FormattedMessage } from '@kbn/i18n-react';
import React, { type PropsWithChildren, type FC } from 'react';
import useObservable from 'react-use/lib/useObservable';
import type { CorrelationsFinderService } from './correlations_finder_service';

export const CorrelationsFlyout: FC<PropsWithChildren<{ service: CorrelationsFinderService }>> = ({
  service,
}) => {
  const results = useObservable(service.results$, []);

  return (
    <>
      <EuiFlyoutHeader>
        <EuiTitle>
          <h2 id={'changePointConfig'}>
            <FormattedMessage
              id="xpack.aiops.correlations.flyoutTitle"
              defaultMessage="Correlations"
            />
          </h2>
        </EuiTitle>
      </EuiFlyoutHeader>

      <EuiFlyoutBody>
        <div>
          {results.map((result, index) => {
            return <>{result.id}</>;
          })}
        </div>
      </EuiFlyoutBody>
    </>
  );
};
