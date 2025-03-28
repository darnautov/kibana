/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import type { StoryFn } from '@storybook/react';
import { mockGroupingProps } from './grouping.mock';
import { Grouping } from './grouping';
import readme from '../../README.mdx';

export default {
  component: Grouping,
  title: 'Grouping',
  description: 'A group of accordion components that each renders a given child component',
  parameters: {
    docs: {
      page: readme,
    },
  },
};

export const Empty: StoryFn = () => {
  return <Grouping {...mockGroupingProps} />;
};
