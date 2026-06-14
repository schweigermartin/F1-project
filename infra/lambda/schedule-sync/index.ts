import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  ListSchedulesCommand,
  SchedulerClient,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";

import {
  INFERENCE_SCHEDULE_PREFIX,
  type InferenceScheduleSpec,
  SCHEDULE_NAME_PREFIX,
  type ScheduleSpec,
  syncSchedules,
} from "./handler.js";

const POLLER_FUNCTION_ARN = process.env["POLLER_FUNCTION_ARN"];
const SCHEDULER_ROLE_ARN = process.env["SCHEDULER_ROLE_ARN"];
// Phase 4 — built from known names in pipeline-stack (no cross-stack ref, so no
// PipelineStack↔InferenceStack cycle). MODEL_VERSION is the active model id.
const INFERENCE_FUNCTION_ARN = process.env["INFERENCE_FUNCTION_ARN"];
const INFERENCE_SCHEDULER_ROLE_ARN = process.env["INFERENCE_SCHEDULER_ROLE_ARN"];
// DLQ catching scheduler→λ deliveries that fail (the silent 2026-06-14 miss).
const INFERENCE_SCHEDULER_DLQ_ARN = process.env["INFERENCE_SCHEDULER_DLQ_ARN"];
const MODEL_VERSION = process.env["MODEL_VERSION"];
const CURRENT_YEAR = new Date().getUTCFullYear();
const OPENF1_BASE = "https://api.openf1.org/v1";

if (!POLLER_FUNCTION_ARN) throw new Error("POLLER_FUNCTION_ARN env var not set");
if (!SCHEDULER_ROLE_ARN) throw new Error("SCHEDULER_ROLE_ARN env var not set");
if (!INFERENCE_FUNCTION_ARN) throw new Error("INFERENCE_FUNCTION_ARN env var not set");
if (!INFERENCE_SCHEDULER_ROLE_ARN) throw new Error("INFERENCE_SCHEDULER_ROLE_ARN env var not set");
if (!INFERENCE_SCHEDULER_DLQ_ARN) throw new Error("INFERENCE_SCHEDULER_DLQ_ARN env var not set");
if (!MODEL_VERSION) throw new Error("MODEL_VERSION env var not set");

const scheduler = new SchedulerClient({});

async function scheduleExists(name: string): Promise<boolean> {
  try {
    await scheduler.send(new GetScheduleCommand({ Name: name }));
    return true;
  } catch {
    return false;
  }
}

async function upsertSchedule(spec: ScheduleSpec): Promise<void> {
  const params = {
    Name: spec.name,
    // aws-scheduler's smallest recurring rate is 1 minute — rate(5 seconds)
    // is rejected with a ValidationException (production incident: no poll
    // schedule was ever created). The poller fills each minute with 5s ticks
    // itself (pollSession), preserving the 5s cadence from the plan.
    ScheduleExpression: "rate(1 minute)",
    StartDate: spec.startsAt,
    EndDate: spec.endsAt,
    FlexibleTimeWindow: { Mode: "OFF" as const },
    Target: {
      Arn: POLLER_FUNCTION_ARN!,
      RoleArn: SCHEDULER_ROLE_ARN!,
      Input: JSON.stringify({ session_key: spec.session_key }),
    },
  };
  if (await scheduleExists(spec.name)) {
    await scheduler.send(new UpdateScheduleCommand(params));
  } else {
    await scheduler.send(new CreateScheduleCommand(params));
  }
}

/** One-shot schedule firing the inference λ once at `runAt` (UTC), then self-
 * deleting (ActionAfterCompletion DELETE) so fired schedules don't accumulate. */
async function upsertInferenceSchedule(spec: InferenceScheduleSpec): Promise<void> {
  const params = {
    Name: spec.name,
    // `at(...)` wants a local timestamp without offset; pin the timezone to UTC.
    ScheduleExpression: `at(${spec.runAt.toISOString().slice(0, 19)})`,
    ScheduleExpressionTimezone: "UTC",
    FlexibleTimeWindow: { Mode: "OFF" as const },
    ActionAfterCompletion: "DELETE" as const,
    Target: {
      Arn: INFERENCE_FUNCTION_ARN!,
      RoleArn: INFERENCE_SCHEDULER_ROLE_ARN!,
      Input: JSON.stringify({
        race_date: spec.race_date,
        round: spec.round,
        model_version: spec.model_version,
      }),
      // Self-deleting one-shot: without a DLQ a failed delivery leaves no trace
      // and no alarm. Route failed deliveries to the DLQ so the depth alarm fires.
      DeadLetterConfig: { Arn: INFERENCE_SCHEDULER_DLQ_ARN! },
    },
  };
  if (await scheduleExists(spec.name)) {
    await scheduler.send(new UpdateScheduleCommand(params));
  } else {
    await scheduler.send(new CreateScheduleCommand(params));
  }
}

async function listSchedules(): Promise<string[]> {
  const names: string[] = [];
  for (const prefix of [SCHEDULE_NAME_PREFIX, INFERENCE_SCHEDULE_PREFIX]) {
    let token: string | undefined;
    do {
      const res = await scheduler.send(
        new ListSchedulesCommand({ NamePrefix: prefix, NextToken: token }),
      );
      token = res.NextToken;
      for (const s of res.Schedules ?? []) if (s.Name) names.push(s.Name);
    } while (token);
  }
  return names;
}

export async function handler(): Promise<{ ok: boolean; result: unknown }> {
  const metrics: Array<{ name: string; value: number; dim?: Record<string, string> }> = [];

  const result = await syncSchedules({
    fetchSessions: async () => {
      const res = await fetch(`${OPENF1_BASE}/sessions?year=${CURRENT_YEAR}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`OpenF1 /sessions returned HTTP ${res.status}`);
      return res.json();
    },
    listExistingSchedules: listSchedules,
    upsertSchedule,
    upsertInferenceSchedule,
    deleteSchedule: async (Name) => {
      await scheduler.send(new DeleteScheduleCommand({ Name }));
    },
    modelVersion: MODEL_VERSION!,
    now: () => new Date(),
    emitMetric: (name, value, dim) => metrics.push({ name, value, dim }),
  });

  console.log(JSON.stringify({ level: "info", msg: "schedule-sync.tick", result, metrics }));
  return { ok: true, result };
}
