/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiButton, EuiFlexGroup, EuiFlexItem, EuiProgress } from '@elastic/eui';
import type { CoreStart } from '@kbn/core/public';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';
import { toMountPoint } from '@kbn/react-kibana-mount';
import type { FC } from 'react';
import React, { type PropsWithChildren } from 'react';
import useObservable from 'react-use/lib/useObservable';
import type { Observable } from 'rxjs';
import type { CorrelationsFinderService } from './correlations_finder_service';

export async function showToast(
  coreStart: CoreStart,
  correlationsFinderService: CorrelationsFinderService
): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const toastInstance = coreStart.notifications.toasts.addInfo({
        title: i18n.translate('xpack.aiops.correlations.toastTitle', {
          defaultMessage: 'Detecting changes and correlations...',
        }),
        iconType: 'changePointDetection',
        toastLifeTimeMs: 30000,
        text: toMountPoint(
          <ToastComponent
            isLoading$={correlationsFinderService.isLoading$}
            onShowResultsClick={resolve.bind(null, true)}
          />,
          coreStart
        ),
        onClose: () => {
          coreStart.notifications.toasts.remove(toastInstance.id);
          resolve(false);
        },
      });
    } catch (e) {
      resolve(false);
    }
  });
}

export const ToastComponent: FC<
  PropsWithChildren<{ isLoading$: Observable<boolean>; onShowResultsClick: () => void }>
> = ({ onShowResultsClick, isLoading$ }) => {
  const isLoading = useObservable(isLoading$, true);
  return (
    <div>
      {isLoading ? (
        <EuiProgress size="xs" color="accent" />
      ) : (
        <EuiFlexGroup justifyContent="flexEnd">
          <EuiFlexItem grow={false}>
            <EuiButton
              color="success"
              data-test-subj="aiopsStartCorrelationsAnalysisShowResultsButton"
              onAbort={onShowResultsClick}
            >
              <FormattedMessage
                id="xpack.aiops.correlations.toast.showResultsButtonLabel"
                defaultMessage="See results"
              />
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      )}
    </div>
  );
};
