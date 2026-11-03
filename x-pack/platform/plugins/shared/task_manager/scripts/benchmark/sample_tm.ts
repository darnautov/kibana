/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Samples the Kibana process and Task Manager every few seconds and appends one
 * NDJSON line per sample, so a run can be charted afterwards.
 *
 * Per sample: heap used / heap limit, RSS, event-loop delay and utilization
 * (from /api/stats), Task Manager capacity, load, drift and overdue counts
 * (from /api/task_manager/_health), and the task-run counters by type from
 * /api/task_manager/metrics. Those counters reset every 30 s, so use
 * summarize_samples.ts (event log) for run totals rather than this file.
 *
 * Usage:
 *   node --import tsx x-pack/platform/plugins/shared/task_manager/scripts/benchmark/sample_tm.ts \
 *     [--interval-ms 5000] [--out ./tm-samples.ndjson] [--label fixed-10-2gb]
 *
 * Stop with Ctrl+C. Kibana restarts show up as a drop in process.uptime_ms.
 */

import { appendFileSync } from 'fs';
import { intArg, kbn, log, parseArgs, strArg } from './lib';

interface StatsResponse {
  process?: {
    uptime_ms?: number;
    memory?: {
      heap?: { used_bytes?: number; size_limit?: number; total_bytes?: number };
      resident_set_size_bytes?: number;
    };
    event_loop_delay?: number;
    event_loop_utilization?: { utilization?: number };
  };
}

interface AdaptiveCapacityHealth {
  capacity?: number;
  heap_used_bytes?: number;
  heap_limit_bytes?: number;
  heap_target_bytes?: number;
  heap_baseline_bytes?: number;
  heap_projected_bytes?: number;
  heap_budget_bytes?: number;
  heap_live_ratio?: number;
  bytes_per_normal_task?: number;
  running_cost?: number;
  free_slots?: number;
  decisions?: number;
  last_trigger?: string;
  estimates?: Array<{ task_type: string; bytes_per_cost_unit: number; samples: number }>;
}

interface HealthResponse {
  status?: string;
  stats?: {
    configuration?: {
      value?: {
        capacity?: { config?: number; as_cost?: number; as_workers?: number; mode?: string };
        adaptive_capacity?: AdaptiveCapacityHealth | null;
      };
    };
    workload?: {
      value?: {
        overdue?: number;
        overdue_non_recurring?: number;
        count?: number;
        task_types?: Record<string, { count: number }>;
      };
    };
    runtime?: {
      value?: {
        load?: { p50?: number; p90?: number; p99?: number };
        drift?: { p50?: number; p90?: number; p99?: number };
        execution?: {
          duration_by_persistence?: unknown;
          result_frequency_percent_as_number?: unknown;
        };
        polling?: { claim_duration?: unknown; result_frequency_percent_as_number?: unknown };
      };
    };
    capacity_estimation?: { value?: { observed?: unknown; proposed?: unknown } };
  };
}

interface MetricsResponse {
  metrics?: {
    task_run?: {
      value?: {
        overall?: { success?: number; total?: number; not_timed_out?: number };
        by_type?: Record<string, { success?: number; total?: number }>;
      };
    };
    task_claim?: { value?: { success?: number; total?: number } };
    task_overdue?: { value?: { overall?: { overdue_by?: { counts?: number[] } } } };
  };
}

const safe = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await fn();
  } catch (error) {
    log(`sample error: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const intervalMs = intArg(args, 'interval-ms', 5000);
  const out = strArg(args, 'out', './tm-samples.ndjson');
  const label = strArg(args, 'label', 'run');

  log(`Sampling every ${intervalMs} ms into ${out} (label=${label})`);

  for (;;) {
    const [stats, health, metrics] = await Promise.all([
      safe(() => kbn<StatsResponse>('/api/stats?extended=false')),
      safe(() => kbn<HealthResponse>('/api/task_manager/_health')),
      safe(() => kbn<MetricsResponse>('/api/task_manager/metrics?reset=false')),
    ]);

    const process_ = stats?.process;
    const runtime = health?.stats?.runtime?.value;
    const adaptive = health?.stats?.configuration?.value?.adaptive_capacity ?? undefined;
    const sample = {
      '@timestamp': new Date().toISOString(),
      label,
      process: {
        uptime_ms: process_?.uptime_ms,
        heap_used_mb: mb(process_?.memory?.heap?.used_bytes),
        heap_limit_mb: mb(process_?.memory?.heap?.size_limit),
        rss_mb: mb(process_?.memory?.resident_set_size_bytes),
        event_loop_delay_ms: process_?.event_loop_delay,
        elu: process_?.event_loop_utilization?.utilization,
      },
      task_manager: {
        status: health?.status,
        capacity: health?.stats?.configuration?.value?.capacity,
        adaptive: adaptive
          ? {
              heap_budget_mb: mb(adaptive.heap_budget_bytes),
              heap_projected_mb: mb(adaptive.heap_projected_bytes),
              heap_baseline_mb: mb(adaptive.heap_baseline_bytes),
              bytes_per_task_mb: mb(adaptive.bytes_per_normal_task),
              live_ratio: adaptive.heap_live_ratio,
              running_cost: adaptive.running_cost,
              free_slots: adaptive.free_slots,
              decisions: adaptive.decisions,
              estimates: adaptive.estimates,
            }
          : undefined,
        workload_count: health?.stats?.workload?.value?.count,
        overdue: health?.stats?.workload?.value?.overdue,
        load: runtime?.load,
        drift: runtime?.drift,
        task_run_overall: metrics?.metrics?.task_run?.value?.overall,
        task_run_by_type: metrics?.metrics?.task_run?.value?.by_type,
        task_claim: metrics?.metrics?.task_claim?.value,
      },
    };

    appendFileSync(out, `${JSON.stringify(sample)}\n`);
    log(
      `heap ${sample.process.heap_used_mb ?? '?'}/${sample.process.heap_limit_mb ?? '?'} MB ` +
        `elu ${sample.process.elu?.toFixed(2) ?? '?'} ` +
        `cap ${sample.task_manager.capacity?.config ?? '?'}${
          sample.task_manager.capacity?.mode === 'auto' ? '(auto)' : ''
        } ` +
        (adaptive
          ? `budget ${mb(adaptive.heap_budget_bytes)} MB @ ${mb(
              adaptive.bytes_per_normal_task
            )} MB/task free ${adaptive.free_slots} running ${adaptive.running_cost} `
          : '') +
        `load p50 ${runtime?.load?.p50 ?? '?'} overdue ${sample.task_manager.overdue ?? '?'} ` +
        `runs ${sample.task_manager.task_run_overall?.total ?? '?'}`
    );

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

const mb = (bytes: number | undefined): number | undefined =>
  bytes === undefined ? undefined : Math.round(bytes / 2 ** 20);

main().catch((error) => {
  log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
