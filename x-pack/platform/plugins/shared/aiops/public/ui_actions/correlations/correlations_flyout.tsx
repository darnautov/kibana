/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiFlyoutBody, EuiFlyoutHeader, EuiTitle } from '@elastic/eui';
import { FormattedMessage } from '@kbn/i18n-react';
import React from 'react';

export const CorrelationsFlyout = () => {
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
        <div />
      </EuiFlyoutBody>
    </>
  );
};
