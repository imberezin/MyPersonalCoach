import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoContent, type AnalyticsEventName, type EventPayload } from "./events";

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  payload: EventPayload;
  occurredAt: Date;
}

/** Where events go. Phase 1 writes to Postgres; PostHog can be added behind the same interface. */
export interface AnalyticsSink {
  record(event: AnalyticsEvent): Promise<void>;
}

export class NoopSink implements AnalyticsSink {
  async record(): Promise<void> {}
}

/** Writes to the `events` table as the signed-in user (user_id defaults to auth.uid()). */
export class SupabaseEventsSink implements AnalyticsSink {
  constructor(private readonly client: SupabaseClient) {}

  async record(event: AnalyticsEvent): Promise<void> {
    const { error } = await this.client.from("events").insert({
      name: event.name,
      payload: event.payload,
      occurred_at: event.occurredAt.toISOString(),
    });
    if (error) throw new Error(error.message);
  }
}

/**
 * Records a product event. Never throws for sink failures: analytics must not break a
 * user flow. A payload that looks like content is a programming error and does throw.
 */
export async function track(
  sink: AnalyticsSink,
  name: AnalyticsEventName,
  payload: EventPayload = {},
  now: Date = new Date(),
): Promise<void> {
  assertNoContent(payload);
  try {
    await sink.record({ name, payload, occurredAt: now });
  } catch (error) {
    console.error("analytics sink failed", error instanceof Error ? error.message : error);
  }
}
