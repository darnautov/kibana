/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { omit } from 'lodash';
import { filterByAgent, settingDefinitions } from '.';
import type { AgentName } from '../../../typings/es_schemas/ui/fields/agent';
import type { SettingDefinition } from './types';

describe('filterByAgent', () => {
  describe('when `excludeAgents` is dotnet and nodejs', () => {
    const setting = {
      key: 'my-setting',
      excludeAgents: ['dotnet', 'nodejs'],
    } as SettingDefinition;

    it('should not include dotnet', () => {
      expect(filterByAgent('dotnet')(setting)).toBe(false);
    });

    it('should include go', () => {
      expect(filterByAgent('go')(setting)).toBe(true);
    });
  });

  describe('when `includeAgents` is dotnet and nodejs', () => {
    const setting = {
      key: 'my-setting',
      includeAgents: ['dotnet', 'nodejs'],
    } as SettingDefinition;

    it('should not include go', () => {
      expect(filterByAgent('go')(setting)).toBe(false);
    });

    it('should include dotnet', () => {
      expect(filterByAgent('dotnet')(setting)).toBe(true);
    });
  });

  describe('options per agent', () => {
    it('go', () => {
      expect(getSettingKeysForAgent('go')).toEqual(
        expect.arrayContaining([
          'capture_body',
          'capture_headers',
          'log_level',
          'recording',
          'sanitize_field_names',
          'span_frames_min_duration',
          'stack_trace_limit',
          'transaction_ignore_urls',
          'transaction_max_spans',
          'transaction_sample_rate',
        ])
      );
    });

    it('java', () => {
      expect(getSettingKeysForAgent('java')).toEqual(
        expect.arrayContaining([
          'api_request_size',
          'api_request_time',
          'capture_body',
          'capture_headers',
          'circuit_breaker_enabled',
          'enable_log_correlation',
          'log_level',
          'profiling_inferred_spans_enabled',
          'profiling_inferred_spans_excluded_classes',
          'profiling_inferred_spans_included_classes',
          'profiling_inferred_spans_min_duration',
          'profiling_inferred_spans_sampling_interval',
          'recording',
          'context_propagation_only',
          'sanitize_field_names',
          'server_timeout',
          'span_frames_min_duration',
          'stack_trace_limit',
          'stress_monitor_cpu_duration_threshold',
          'stress_monitor_gc_relief_threshold',
          'stress_monitor_gc_stress_threshold',
          'stress_monitor_system_cpu_relief_threshold',
          'stress_monitor_system_cpu_stress_threshold',
          'transaction_ignore_urls',
          'transaction_max_spans',
          'transaction_sample_rate',
        ])
      );
    });

    it('js-base', () => {
      expect(getSettingKeysForAgent('js-base')).toEqual(
        expect.arrayContaining(['transaction_sample_rate'])
      );
    });

    it('rum-js', () => {
      expect(getSettingKeysForAgent('rum-js')).toEqual(
        expect.arrayContaining(['transaction_sample_rate'])
      );
    });

    it('nodejs', () => {
      expect(getSettingKeysForAgent('nodejs')).toEqual(
        expect.arrayContaining([
          'capture_body',
          'log_level',
          'sanitize_field_names',
          'transaction_ignore_urls',
          'transaction_max_spans',
          'transaction_sample_rate',
        ])
      );
    });

    it('python', () => {
      expect(getSettingKeysForAgent('python')).toEqual(
        expect.arrayContaining([
          'api_request_size',
          'api_request_time',
          'capture_body',
          'capture_headers',
          'log_level',
          'recording',
          'sanitize_field_names',
          'span_frames_min_duration',
          'transaction_ignore_urls',
          'transaction_max_spans',
          'transaction_sample_rate',
        ])
      );
    });

    it('dotnet', () => {
      expect(getSettingKeysForAgent('dotnet')).toEqual(
        expect.arrayContaining([
          'capture_body',
          'capture_headers',
          'log_level',
          'recording',
          'sanitize_field_names',
          'span_frames_min_duration',
          'stack_trace_limit',
          'transaction_ignore_urls',
          'transaction_max_spans',
          'transaction_sample_rate',
        ])
      );
    });

    it('ruby', () => {
      expect(getSettingKeysForAgent('ruby')).toEqual(
        expect.arrayContaining([
          'api_request_size',
          'api_request_time',
          'capture_body',
          'capture_headers',
          'log_level',
          'recording',
          'sanitize_field_names',
          'span_frames_min_duration',
          'transaction_ignore_urls',
          'transaction_max_spans',
          'transaction_sample_rate',
        ])
      );
    });

    it('php', () => {
      expect(getSettingKeysForAgent('php')).toEqual(
        expect.arrayContaining([
          'log_level',
          'recording',
          'transaction_max_spans',
          'transaction_sample_rate',
        ])
      );
    });

    it('android/java', () => {
      expect(getSettingKeysForAgent('android/java')).toEqual(['recording', 'session_sample_rate']);
    });

    it('iOS/swift', () => {
      expect(getSettingKeysForAgent('iOS/swift')).toEqual(['recording', 'session_sample_rate']);
    });

    it('opentelemetry/java/elastic', () => {
      expect(getSettingKeysForAgent('opentelemetry/java/elastic')).toEqual(
        expect.arrayContaining([
          'deactivate_all_instrumentations',
          'deactivate_instrumentations',
          'logging_level',
          'send_logs',
          'send_metrics',
          'send_traces',
        ])
      );
    });

    it('opentelemetry/nodejs/elastic', () => {
      expect(getSettingKeysForAgent('opentelemetry/nodejs/elastic')).toEqual(
        expect.arrayContaining(['logging_level'])
      );
    });

    it('opentelemetry/python/elastic', () => {
      expect(getSettingKeysForAgent('opentelemetry/python/elastic')).toEqual(
        expect.arrayContaining(['logging_level'])
      );
    });

    it('opentelemetry/php/elastic', () => {
      expect(getSettingKeysForAgent('opentelemetry/php/elastic')).toEqual(
        expect.arrayContaining(['logging_level'])
      );
    });

    it('opentelemetry/dotnet/elastic', () => {
      expect(getSettingKeysForAgent('opentelemetry/dotnet/elastic')).toEqual(
        expect.arrayContaining(['logging_level'])
      );
    });

    it('"All" services (no agent name)', () => {
      expect(getSettingKeysForAgent(undefined)).toEqual(
        expect.arrayContaining(['transaction_max_spans', 'transaction_sample_rate'])
      );
    });
  });
});

describe('settingDefinitions', () => {
  it('should have correct default values', () => {
    expect(
      settingDefinitions.map((def) => {
        return {
          ...omit(def, [
            'category',
            'defaultValue',
            'description',
            'excludeAgents',
            'includeAgents',
            'label',
            'validation',
          ]),
          validationName: def.validation.name,
        };
      })
    ).toMatchSnapshot();
  });
});

function getSettingKeysForAgent(agentName: AgentName | undefined) {
  const definitions = settingDefinitions.filter(filterByAgent(agentName));
  return definitions.map((def) => def.key);
}
