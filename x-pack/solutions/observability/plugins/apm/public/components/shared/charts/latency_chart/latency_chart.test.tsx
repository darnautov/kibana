/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { composeStories } from '@storybook/react';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import * as stories from './latency_chart.stories';

const { Example } = composeStories(stories);

describe('LatencyChart', () => {
  it('renders', async () => {
    await waitFor(() => {
      expect(() => render(<Example />)).not.toThrowError();
    });
  });
});
