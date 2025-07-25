/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import {
  AreaSeries,
  Axis,
  Chart,
  niceTimeFormatByDay,
  ScaleType,
  Settings,
  timeFormatter,
  Tooltip,
} from '@elastic/charts';
import {
  useEuiTheme,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLink,
  EuiText,
  EuiTitle,
  type EuiLinkButtonProps,
  type EuiTextProps,
  EuiToolTip,
  EuiToolTipProps,
  type CommonProps,
} from '@elastic/eui';
import { FormattedDate, FormattedTime } from '@kbn/i18n-react';
import moment from 'moment';
import { i18n } from '@kbn/i18n';
import { css } from '@emotion/react';
import { MISCONFIGURATION_STATUS } from '@kbn/cloud-security-posture-common';
import { useGetMisconfigurationStatusColor } from '@kbn/cloud-security-posture';
import { DASHBOARD_COMPLIANCE_SCORE_CHART } from '../test_subjects';
import { RULE_FAILED, RULE_PASSED } from '../../../../common/constants';
import { CompactFormattedNumber } from '../../../components/compact_formatted_number';
import type { Evaluation, PostureTrend, Stats } from '../../../../common/types_old';
import { useKibana } from '../../../common/hooks/use_kibana';

interface ComplianceScoreChartProps {
  compact?: boolean;
  trend: PostureTrend[];
  data: Stats;
  id: string;
  onEvalCounterClick: (evaluation: Evaluation) => void;
}

const CounterButtonLink = ({
  text,
  count,
  color,
  'data-test-subj': dataTestSubj,
  onClick,
}: {
  count: number;
  text: string;
  color: EuiTextProps['color'];
  onClick: EuiLinkButtonProps['onClick'];
} & Pick<CommonProps, 'data-test-subj'>) => {
  const { euiTheme } = useEuiTheme();

  return (
    <>
      <EuiText
        size="s"
        css={{
          fontWeight: euiTheme.font.weight.bold,
          marginBottom: euiTheme.size.xs,
        }}
      >
        {text}
      </EuiText>

      <EuiLink
        color="text"
        onClick={onClick}
        data-test-subj={dataTestSubj}
        css={css`
          display: flex;
          &:hover {
            text-decoration: none;
          }
        `}
      >
        <EuiText
          color={color}
          css={css`
            font-weight: ${euiTheme.font.weight.medium};
            font-size: 18px;

            &:hover {
              border-bottom: 2px solid ${color};
              padding-bottom: 4px;
            }
          `}
          size="s"
        >
          <CompactFormattedNumber number={count} abbreviateAbove={999} />
          &nbsp;
        </EuiText>
      </EuiLink>
    </>
  );
};

const CompactPercentageLabels = ({
  onEvalCounterClick,
  stats,
}: {
  onEvalCounterClick: (evaluation: Evaluation) => void;
  stats: { totalPassed: number; totalFailed: number };
}) => {
  const { getMisconfigurationStatusColor } = useGetMisconfigurationStatusColor();

  return (
    <>
      <CounterLink
        text="passed"
        count={stats.totalPassed}
        color={getMisconfigurationStatusColor(MISCONFIGURATION_STATUS.PASSED)}
        onClick={() => onEvalCounterClick(RULE_PASSED)}
        tooltipContent={i18n.translate(
          'xpack.csp.complianceScoreChart.counterLink.passedFindingsTooltip',
          { defaultMessage: 'Passed findings' }
        )}
      />
      <EuiText size="s">&nbsp;-&nbsp;</EuiText>
      <CounterLink
        text="failed"
        count={stats.totalFailed}
        color={getMisconfigurationStatusColor(MISCONFIGURATION_STATUS.FAILED)}
        onClick={() => onEvalCounterClick(RULE_FAILED)}
        tooltipContent={i18n.translate(
          'xpack.csp.complianceScoreChart.counterButtonLink.failedFindingsTooltip',
          { defaultMessage: 'Failed findings' }
        )}
      />
    </>
  );
};

const PercentageLabels = ({
  onEvalCounterClick,
  stats,
}: {
  onEvalCounterClick: (evaluation: Evaluation) => void;
  stats: { totalPassed: number; totalFailed: number };
}) => {
  const { euiTheme } = useEuiTheme();
  const { getMisconfigurationStatusColor } = useGetMisconfigurationStatusColor();
  const borderLeftStyles = { borderLeft: euiTheme.border.thin, paddingLeft: euiTheme.size.m };

  return (
    <EuiFlexGroup gutterSize="l" justifyContent="spaceBetween">
      <EuiFlexItem grow={false} css={borderLeftStyles}>
        <CounterButtonLink
          text="Passed Findings"
          count={stats.totalPassed}
          color={getMisconfigurationStatusColor(MISCONFIGURATION_STATUS.PASSED)}
          data-test-subj="dashboard-summary-passed-findings"
          onClick={() => onEvalCounterClick(RULE_PASSED)}
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false} css={borderLeftStyles}>
        <CounterButtonLink
          text="Failed Findings"
          count={stats.totalFailed}
          color={getMisconfigurationStatusColor(MISCONFIGURATION_STATUS.FAILED)}
          data-test-subj="dashboard-summary-failed-findings"
          onClick={() => onEvalCounterClick(RULE_FAILED)}
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

export const getPostureScorePercentage = (postureScore: number): string =>
  `${Math.round(postureScore)}%`;

const PercentageInfo = ({
  compact,
  postureScore,
}: ComplianceScoreChartProps['data'] & { compact?: ComplianceScoreChartProps['compact'] }) => {
  const { euiTheme } = useEuiTheme();
  const percentage = getPostureScorePercentage(postureScore);

  return (
    <EuiTitle
      css={{
        fontSize: compact ? euiTheme.size.l : euiTheme.size.xxl,
        paddingLeft: compact ? euiTheme.size.s : euiTheme.size.xs,
        marginBottom: compact ? euiTheme.size.s : 'none',
      }}
      data-test-subj={DASHBOARD_COMPLIANCE_SCORE_CHART.COMPLIANCE_SCORE}
    >
      <h3>{percentage}</h3>
    </EuiTitle>
  );
};

const convertTrendToEpochTime = (trend: PostureTrend) => ({
  ...trend,
  timestamp: moment(trend.timestamp).valueOf(),
});

const ComplianceTrendChart = ({ trend }: { trend: PostureTrend[] }) => {
  const epochTimeTrend = trend.map(convertTrendToEpochTime);
  const {
    services: { charts },
  } = useKibana();

  return (
    <Chart>
      <Tooltip
        headerFormatter={({ value }) => (
          <>
            <FormattedDate value={value} month="short" day="numeric" />
            {', '}
            <FormattedTime value={value} />
          </>
        )}
      />
      <Settings
        baseTheme={charts.theme.useChartsBaseTheme()}
        showLegend={false}
        legendPosition="right"
        locale={i18n.getLocale()}
      />
      <AreaSeries
        // EuiChart is using this id in the tooltip label
        id="Posture Score"
        data={epochTimeTrend}
        // Defaults to multi layer time axis as of Elastic Charts v70
        xScaleType={ScaleType.Time}
        xAccessor={'timestamp'}
        yAccessors={['postureScore']}
      />
      <Axis
        id="bottom-axis"
        position="bottom"
        tickFormat={timeFormatter(niceTimeFormatByDay(2))}
        ticks={4}
      />
      <Axis
        ticks={3}
        id="left-axis"
        position="left"
        gridLine={{ visible: true }}
        domain={{ min: 0, max: 100 }}
      />
    </Chart>
  );
};

const CounterLink = ({
  text,
  count,
  color,
  onClick,
  tooltipContent,
}: {
  count: number;
  text: string;
  color: EuiTextProps['color'];
  onClick: EuiLinkButtonProps['onClick'];
  tooltipContent: EuiToolTipProps['content'];
}) => {
  const { euiTheme } = useEuiTheme();

  return (
    <EuiToolTip content={tooltipContent}>
      <EuiLink
        data-test-subj={`compliance-score-section-${text}`}
        color="text"
        onClick={onClick}
        css={{ display: 'flex' }}
      >
        <EuiText color={color} css={{ fontWeight: euiTheme.font.weight.medium }} size="s">
          <CompactFormattedNumber number={count} abbreviateAbove={999} />
          &nbsp;
        </EuiText>
        <EuiText size="s">{text}</EuiText>
      </EuiLink>
    </EuiToolTip>
  );
};

export const ComplianceScoreChart = ({
  data,
  trend,
  onEvalCounterClick,
  compact,
}: ComplianceScoreChartProps) => {
  const { euiTheme } = useEuiTheme();

  return (
    <EuiFlexGroup
      direction="column"
      justifyContent="spaceBetween"
      css={{ height: '100%' }}
      gutterSize="none"
    >
      <EuiFlexItem grow={2}>
        <EuiFlexGroup direction="row" justifyContent="spaceBetween" gutterSize="none">
          <EuiFlexItem grow={false}>
            <PercentageInfo {...data} compact={compact} />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFlexGroup
              justifyContent="flexEnd"
              gutterSize="none"
              alignItems="flexStart"
              css={{ paddingRight: euiTheme.size.xl }}
            >
              {compact ? (
                <CompactPercentageLabels
                  stats={{ totalPassed: data.totalPassed, totalFailed: data.totalFailed }}
                  onEvalCounterClick={onEvalCounterClick}
                />
              ) : (
                <PercentageLabels
                  stats={{ totalPassed: data.totalPassed, totalFailed: data.totalFailed }}
                  onEvalCounterClick={onEvalCounterClick}
                />
              )}
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>
      <EuiFlexItem grow={6}>
        <ComplianceTrendChart trend={trend} />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
