/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  ResizableLayout,
  ResizableLayoutDirection,
  ResizableLayoutMode,
} from '@kbn/resizable-layout';
import { findTestSubject } from '@kbn/test-jest-helpers';
import { mount } from 'enzyme';
import { isEqual as mockIsEqual } from 'lodash';
import React from 'react';
import {
  DiscoverResizableLayout as OriginalDiscoverResizableLayout,
  type DiscoverResizableLayoutProps,
  SIDEBAR_WIDTH_KEY,
} from './discover_resizable_layout';
import { BehaviorSubject } from 'rxjs';
import type { SidebarToggleState } from '../../../types';
import { DiscoverTestProvider } from '../../../../__mocks__/test_provider';
import { createDiscoverServicesMock } from '../../../../__mocks__/services';

const mockSidebarKey = SIDEBAR_WIDTH_KEY;
let mockSidebarWidth: number | undefined;

const services = createDiscoverServicesMock();
services.storage.get = jest.fn((key: string) => {
  if (key === mockSidebarKey) {
    return mockSidebarWidth;
  }
  throw new Error(`Unexpected key: ${key}`);
});

let mockIsMobile = false;

jest.mock('@elastic/eui', () => {
  const original = jest.requireActual('@elastic/eui');
  return {
    ...original,
    useIsWithinBreakpoints: jest.fn((breakpoints: string[]) => {
      if (!mockIsEqual(breakpoints, ['xs', 's'])) {
        throw new Error(`Unexpected breakpoints: ${breakpoints}`);
      }
      return mockIsMobile;
    }),
  };
});

const DiscoverResizableLayout: React.FC<DiscoverResizableLayoutProps> = (props) => {
  return (
    <DiscoverTestProvider services={services}>
      <OriginalDiscoverResizableLayout {...props} />
    </DiscoverTestProvider>
  );
};

describe('DiscoverResizableLayout', () => {
  beforeEach(() => {
    mockSidebarWidth = undefined;
    mockIsMobile = false;
  });

  it('should render sidebarPanel and mainPanel', () => {
    const wrapper = mount(
      <DiscoverResizableLayout
        sidebarToggleState$={
          new BehaviorSubject<SidebarToggleState>({
            isCollapsed: true,
            toggle: () => {},
          })
        }
        sidebarPanel={<div data-test-subj="sidebarPanel" />}
        mainPanel={<div data-test-subj="mainPanel" />}
      />
    );
    expect(findTestSubject(wrapper, 'sidebarPanel')).toHaveLength(1);
    expect(findTestSubject(wrapper, 'mainPanel')).toHaveLength(1);
  });

  it('should use the default sidebar width when no value is stored in local storage', () => {
    const wrapper = mount(
      <DiscoverResizableLayout
        sidebarToggleState$={
          new BehaviorSubject<SidebarToggleState>({
            isCollapsed: true,
            toggle: () => {},
          })
        }
        sidebarPanel={<div data-test-subj="sidebarPanel" />}
        mainPanel={<div data-test-subj="mainPanel" />}
      />
    );
    expect(wrapper.find(ResizableLayout).prop('fixedPanelSize')).toBe(304);
  });

  it('should use the stored sidebar width from local storage', () => {
    mockSidebarWidth = 400;
    const wrapper = mount(
      <DiscoverResizableLayout
        sidebarToggleState$={
          new BehaviorSubject<SidebarToggleState>({
            isCollapsed: true,
            toggle: () => {},
          })
        }
        sidebarPanel={<div data-test-subj="sidebarPanel" />}
        mainPanel={<div data-test-subj="mainPanel" />}
      />
    );
    expect(wrapper.find(ResizableLayout).prop('fixedPanelSize')).toBe(400);
  });

  it('should use the restored sidebar width despite local storage value', () => {
    mockSidebarWidth = 400;
    const wrapper = mount(
      <DiscoverResizableLayout
        sidebarToggleState$={
          new BehaviorSubject<SidebarToggleState>({
            isCollapsed: true,
            toggle: () => {},
          })
        }
        sidebarPanel={<div data-test-subj="sidebarPanel" />}
        mainPanel={<div data-test-subj="mainPanel" />}
        initialState={{
          sidebarWidth: 450,
        }}
      />
    );
    expect(wrapper.find(ResizableLayout).prop('fixedPanelSize')).toBe(450);
  });

  it('should pass mode ResizableLayoutMode.Resizable when not mobile and sidebar is not collapsed', () => {
    mockIsMobile = false;
    const wrapper = mount(
      <DiscoverResizableLayout
        sidebarToggleState$={
          new BehaviorSubject<SidebarToggleState>({
            isCollapsed: false,
            toggle: () => {},
          })
        }
        sidebarPanel={<div data-test-subj="sidebarPanel" />}
        mainPanel={<div data-test-subj="mainPanel" />}
      />
    );
    expect(wrapper.find(ResizableLayout).prop('mode')).toBe(ResizableLayoutMode.Resizable);
  });

  it('should pass mode ResizableLayoutMode.Static when mobile', () => {
    mockIsMobile = true;
    const wrapper = mount(
      <DiscoverResizableLayout
        sidebarToggleState$={
          new BehaviorSubject<SidebarToggleState>({
            isCollapsed: false,
            toggle: () => {},
          })
        }
        sidebarPanel={<div data-test-subj="sidebarPanel" />}
        mainPanel={<div data-test-subj="mainPanel" />}
      />
    );
    expect(wrapper.find(ResizableLayout).prop('mode')).toBe(ResizableLayoutMode.Static);
  });

  it('should pass mode ResizableLayoutMode.Static when not mobile and sidebar is collapsed', () => {
    mockIsMobile = false;
    const wrapper = mount(
      <DiscoverResizableLayout
        sidebarToggleState$={
          new BehaviorSubject<SidebarToggleState>({
            isCollapsed: true,
            toggle: () => {},
          })
        }
        sidebarPanel={<div data-test-subj="sidebarPanel" />}
        mainPanel={<div data-test-subj="mainPanel" />}
      />
    );
    expect(wrapper.find(ResizableLayout).prop('mode')).toBe(ResizableLayoutMode.Static);
  });

  it('should pass direction ResizableLayoutDirection.Horizontal when not mobile', () => {
    mockIsMobile = false;
    const wrapper = mount(
      <DiscoverResizableLayout
        sidebarToggleState$={
          new BehaviorSubject<SidebarToggleState>({
            isCollapsed: false,
            toggle: () => {},
          })
        }
        sidebarPanel={<div data-test-subj="sidebarPanel" />}
        mainPanel={<div data-test-subj="mainPanel" />}
      />
    );
    expect(wrapper.find(ResizableLayout).prop('direction')).toBe(
      ResizableLayoutDirection.Horizontal
    );
  });

  it('should pass direction ResizableLayoutDirection.Vertical when mobile', () => {
    mockIsMobile = true;
    const wrapper = mount(
      <DiscoverResizableLayout
        sidebarToggleState$={
          new BehaviorSubject<SidebarToggleState>({
            isCollapsed: false,
            toggle: () => {},
          })
        }
        sidebarPanel={<div data-test-subj="sidebarPanel" />}
        mainPanel={<div data-test-subj="mainPanel" />}
      />
    );
    expect(wrapper.find(ResizableLayout).prop('direction')).toBe(ResizableLayoutDirection.Vertical);
  });
});
