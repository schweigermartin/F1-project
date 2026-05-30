import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  ListSchedulesCommand,
  SchedulerClient,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";

import { SCHEDULE_NAME_PREFIX, type ScheduleSpec, syncSchedules } from "./handler.js";

const POLLER_FUNCTION_ARN = process.env["POLLER_FUNCTION_ARN"];
const SCHEDULER_ROLE_ARN = process.env["SCHEDULER_ROLE_ARN"];
const CURRENT_YEAR = new Date().getUTCFullYear();
const OPENF1_BASE = "https://api.openf1.org/v1";

if (!POLLER_FUNCTION_ARN) throw new Error("POLLER_FUNCTION_ARN env var not set");
if (!SCHEDULER_ROLE_ARN) throw new Error("SCHEDULER_ROLE_ARN env var not set");

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
    ScheduleExpression: "rate(5 seconds)",
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

async function listSchedules(): Promise<string[]> {
  const names: string[] = [];
  let token: string | undefined;
  do {
    const res = await scheduler.send(
      new ListSchedulesCommand({ NamePrefix: SCHEDULE_NAME_PREFIX, NextToken: token }),
    );
    token = res.NextToken;
    for (const s of res.Schedules ?? []) if (s.Name) names.push(s.Name);
  } while (token);
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
    deleteSchedule: async (Name) => {
      await scheduler.send(new DeleteScheduleCommand({ Name }));
    },
    now: () => new Date(),
    emitMetric: (name, value, dim) => metrics.push({ name, value, dim }),
  });

  console.log(JSON.stringify({ level: "info", msg: "schedule-sync.tick", result, metrics }));
  return { ok: true, result };
}
