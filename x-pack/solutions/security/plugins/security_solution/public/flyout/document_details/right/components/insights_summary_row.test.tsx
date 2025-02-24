/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { __IntlProvider as IntlProvider } from '@kbn/i18n-react';
import { InsightsSummaryRow } from './insights_summary_row';
import { useNavigateToLeftPanel } from '../../shared/hooks/use_navigate_to_left_panel';

const mockNavigateToLeftPanel = jest.fn();
jest.mock('../../shared/hooks/use_navigate_to_left_panel');

const testId = 'test';
const textTestId = `${testId}Text`;
const buttonTestId = `${testId}Button`;
const valueTestId = `${testId}Value`;
const loadingTestId = `${testId}Loading`;

describe('<InsightsSummaryRow />', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (useNavigateToLeftPanel as jest.Mock).mockReturnValue({
      navigateToLeftPanel: mockNavigateToLeftPanel,
      isEnabled: true,
    });
  });

  it('should render loading skeleton if loading is true', () => {
    const { getByTestId } = render(
      <InsightsSummaryRow
        loading={true}
        text={'text'}
        value={<div>{'value for this'}</div>}
        data-test-subj={testId}
      />
    );

    expect(getByTestId(loadingTestId)).toBeInTheDocument();
  });

  it('should only render null when error is true', () => {
    const { container } = render(
      <InsightsSummaryRow error={true} text={'text'} value={<div>{'value for this'}</div>} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('should render the value component', () => {
    const { getByTestId, queryByTestId } = render(
      <IntlProvider locale="en">
        <InsightsSummaryRow
          text={'this is a test for red'}
          value={<div>{'value for this'}</div>}
          data-test-subj={testId}
        />
      </IntlProvider>
    );

    expect(getByTestId(textTestId)).toHaveTextContent('this is a test for red');
    expect(getByTestId(valueTestId)).toHaveTextContent('value for this');
    expect(queryByTestId(buttonTestId)).not.toBeInTheDocument();
  });

  it('should render the value as EuiBadge and EuiButtonEmpty', () => {
    const { getByTestId, queryByTestId } = render(
      <IntlProvider locale="en">
        <InsightsSummaryRow text={'this is a test for red'} value={2} data-test-subj={testId} />
      </IntlProvider>
    );

    expect(getByTestId(textTestId)).toHaveTextContent('this is a test for red');
    expect(getByTestId(buttonTestId)).toHaveTextContent('2');
    expect(queryByTestId(valueTestId)).not.toBeInTheDocument();
  });

  it('should render big numbers formatted correctly', () => {
    const { getByTestId } = render(
      <IntlProvider locale="en">
        <InsightsSummaryRow text={'this is a test for red'} value={2000} data-test-subj={testId} />
      </IntlProvider>
    );

    expect(getByTestId(buttonTestId)).toHaveTextContent('2k');
  });

  it('should open the expanded section to the correct tab when the number is clicked', () => {
    const { getByTestId } = render(
      <IntlProvider locale="en">
        <InsightsSummaryRow
          text={'this is a test for red'}
          value={2}
          expandedSubTab={'subTab'}
          data-test-subj={testId}
        />
      </IntlProvider>
    );
    getByTestId(buttonTestId).click();

    expect(mockNavigateToLeftPanel).toHaveBeenCalled();
  });

  it('should disabled the click when navigation is disabled', () => {
    (useNavigateToLeftPanel as jest.Mock).mockReturnValue({
      navigateToLeftPanel: undefined,
      isEnabled: false,
    });

    const { getByTestId } = render(
      <IntlProvider locale="en">
        <InsightsSummaryRow
          text={'this is a test for red'}
          value={2}
          expandedSubTab={'subTab'}
          data-test-subj={testId}
        />
      </IntlProvider>
    );
    const button = getByTestId(buttonTestId);

    expect(button).toHaveAttribute('disabled');

    button.click();
    expect(mockNavigateToLeftPanel).not.toHaveBeenCalled();
  });
});
