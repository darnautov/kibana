/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EuiBasicTableColumn } from '@elastic/eui';
import {
  EuiButton,
  EuiCodeBlock,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiInMemoryTable,
  EuiTitle,
} from '@elastic/eui';
import { FormattedMessage } from '@kbn/i18n-react';
import React, {
  type PropsWithChildren,
  type FC,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  useState,
} from 'react';
import useObservable from 'react-use/lib/useObservable';
import { i18n } from '@kbn/i18n';
import type { CorrelationsFinderService } from './correlations_finder_service';
import { ChangePointsTable } from '../../components/change_point_detection/change_points_table';
import { useAiopsAppContext } from '../../hooks/use_aiops_app_context';
import { useCommonChartProps } from '../../components/change_point_detection/use_common_chart_props';
import type { FieldConfig } from '../../components/change_point_detection/change_point_detection_context';

export const CorrelationsFlyout: FC<PropsWithChildren<{ service: CorrelationsFinderService }>> = ({
  service,
}) => {
  const results = useObservable(service.results$, []);

  const [showRequest, setShowRequest] = useState(false);

  const changePoints = useMemo(() => {
    return results.flatMap((result) => result.result);
  }, [results]);

  if (results.length === 0) return null;

  const fieldConfig = {
    fn: results[0].target.operationType,
    metricField: results[0].target.metricField,
    splitField: results[0].target.splitField,
  } as FieldConfig;

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
          <EuiButton
            onClick={setShowRequest.bind(null, !showRequest)}
            data-test-subj="pluginsCorrelationsFlyoutShowRuquestButton"
          >
            Show request
          </EuiButton>

          {showRequest ? (
            <p>
              <EuiCodeBlock language="json" isCopyable>
                {JSON.stringify(results[0].query, null, 2)}
              </EuiCodeBlock>
            </p>
          ) : null}
        </div>
        <div>
          {results.map((result, index) => {
            return (
              <React.Fragment key={index}>
                <ChangePointsTable
                  isLoading={false}
                  annotations={changePoints}
                  fieldConfig={fieldConfig}
                  onRenderComplete={() => {}}
                />
              </React.Fragment>
            );
          })}
        </div>
      </EuiFlyoutBody>
    </>
  );
};

export const CorrelationsTableComponent = ({ results }) => {
  const {
    fieldFormats,
    data: {
      query: { filterManager },
    },
  } = useAiopsAppContext();

  const columns: Array<EuiBasicTableColumn<ChangePointAnnotation>> = [
    {
      id: 'request',
      field: 'request',
      'data-test-subj': 'aiopsChangePointTimestamp',
      name: i18n.translate('xpack.aiops.changePointDetection.timeColumn', {
        defaultMessage: 'Time',
      }),
      sortable: true,
      truncateText: false,
      width: '230px',
      render: (timestamp: ChangePointAnnotation['timestamp']) => dateFormatter.convert(timestamp),
    },
    {
      id: 'timestamp',
      field: 'timestamp',
      'data-test-subj': 'aiopsChangePointTimestamp',
      name: i18n.translate('xpack.aiops.changePointDetection.timeColumn', {
        defaultMessage: 'Time',
      }),
      sortable: true,
      truncateText: false,
      width: '230px',
      render: (timestamp: ChangePointAnnotation['timestamp']) => dateFormatter.convert(timestamp),
    },
    {
      id: 'metric',
      field: 'metric',
      'data-test-subj': 'aiopsChangePointTimestamp',
      name: i18n.translate('xpack.aiops.changePointDetection.timeColumn', {
        defaultMessage: 'Time',
      }),
      sortable: true,
      truncateText: false,
      width: '230px',
      render: (timestamp: ChangePointAnnotation['timestamp']) => dateFormatter.convert(timestamp),
    },
    {
      id: 'preview',
      'data-test-subj': 'aiopsChangePointPreview',
      name: i18n.translate('xpack.aiops.changePointDetection.previewColumn', {
        defaultMessage: 'Preview',
      }),
      align: 'center',
      width: '200px',
      height: '80px',
      truncateText: false,
      valign: 'middle',
      css: {
        '.euiTableCellContent': { display: 'block', padding: 0 },
      },
      render: (annotation: ChangePointAnnotation) => {
        return (
          <NewMiniChartPreview
            annotation={annotation}
            fieldConfig={fieldConfig}
            interval={'3h'}
            onRenderComplete={onChartRenderCompleteCallback.bind(null, false)}
          />
        );
      },
    },
    {
      id: 'pValue',
      'data-test-subj': 'aiopsChangePointPValue',
      field: 'p_value',
      name: 'p_value',
      sortable: true,
      truncateText: false,
      render: (pValue: ChangePointAnnotation['p_value']) => pValue.toPrecision(3),
    },
  ];

  return (
    <EuiInMemoryTable<ChangePointAnnotation>
      itemId="id"
      items={annotations}
      columns={columns}
      rowProps={(item) => ({
        'data-test-subj': `aiopsChangePointResultsTableRow row-${item.id}`,
      })}
    />
  );
};

export const NewMiniChartPreview: FC<ChartComponentProps> = ({
  fieldConfig,
  annotation,
  onRenderComplete,
  onLoading,
}) => {
  const {
    lens: { EmbeddableComponent },
  } = useAiopsAppContext();

  // const { bucketInterval } = useChangePointDetectionContext();

  const { filters, query, attributes, timeRange } = useCommonChartProps({
    annotation,
    fieldConfig,
    previewMode: true,
    bucketInterval: '3h',
  });

  const chartWrapperRef = useRef<HTMLDivElement>(null);

  const renderCompleteListener = useCallback(
    (event: Event) => {
      if (event.target === chartWrapperRef.current) return;
      if (onRenderComplete) {
        onRenderComplete();
      }
    },
    [onRenderComplete]
  );

  useEffect(() => {
    if (!chartWrapperRef.current) {
      throw new Error('Reference to the chart wrapper is not set');
    }
    const chartWrapper = chartWrapperRef.current;
    chartWrapper.addEventListener('renderComplete', renderCompleteListener);
    return () => {
      chartWrapper.removeEventListener('renderComplete', renderCompleteListener);
    };
  }, [renderCompleteListener]);

  return (
    <div data-test-subj={'aiopChangePointPreviewChart'} ref={chartWrapperRef}>
      <EmbeddableComponent
        id={`mini_changePointChart_${annotation.group ? annotation.group.value : annotation.label}`}
        style={{ height: 80 }}
        timeRange={timeRange}
        noPadding
        query={query}
        filters={filters}
        // @ts-ignore
        attributes={attributes}
        renderMode={'preview'}
        executionContext={{
          type: 'aiops_change_point_detection_chart',
          name: 'Change point detection',
        }}
        onLoad={onLoading}
      />
    </div>
  );
};
