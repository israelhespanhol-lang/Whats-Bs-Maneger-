"use client";

import { supabase } from "./supabase";

export type ClientMetricOperation = "INBOX_LOAD" | "MESSAGE_LOAD" | "SEND_MESSAGE";

// Low-cost sampling: no message content, customer IDs, names, or phone numbers.
// Never blocks the agent's message/composer workflow.
export function recordClientMetric(
  organizationId: string | null,
  operation: ClientMetricOperation,
  durationMs: number,
  cacheHit = false
) {
  if (!organizationId || !Number.isFinite(durationMs) || durationMs < 0 ||
      Math.random() > 0.25) return;

  void supabase.from("client_performance_events").insert({
    organization_id: organizationId,
    operation,
    duration_ms: Math.min(120000, Math.round(durationMs)),
    cache_hit: cacheHit
  }).then(() => undefined, () => undefined);
}
