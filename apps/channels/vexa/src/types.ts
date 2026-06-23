/**
 * Types for Vexa's outbound webhook envelope.
 *
 * Verified against Vexa meeting-api `webhook_delivery.build_envelope` and
 * `webhooks._build_meeting_event_data` (api_version 2026-03-01). Vexa enables
 * only `meeting.completed` by default; `meeting.status_change` and others are
 * opt-in via the user's `webhook_events` config.
 */

/** A Vexa meeting object as embedded in webhook `data.meeting`. */
export interface VexaMeeting {
  /** Vexa's internal meeting id (numeric). Used as the dedup key. */
  id?: number | string;
  user_id?: number | string;
  /** 'google_meet' | 'zoom' | 'teams' */
  platform?: string;
  /** Platform-native id, e.g. 'abc-defg-hij'. */
  native_meeting_id?: string;
  constructed_meeting_url?: string;
  /** 'completed' | 'failed' | 'active' | 'joining' | ... */
  status?: string;
  completion_reason?: string | null;
  failure_stage?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  data?: Record<string, unknown>;
}

export interface VexaStatusChange {
  from?: string | null;
  to?: string | null;
  reason?: string | null;
  timestamp?: string | null;
  transition_source?: string | null;
}

/** The standard Vexa webhook envelope. */
export interface VexaWebhookEvent {
  event_id?: string;
  /** 'meeting.completed' | 'meeting.status_change' | 'meeting.started' | 'bot.failed' | ... */
  event_type?: string;
  api_version?: string;
  created_at?: string;
  data?: {
    meeting?: VexaMeeting;
    status_change?: VexaStatusChange;
    [k: string]: unknown;
  };
}

/** Reduced, platform-agnostic completion event the adapter acts on. */
export interface NormalizedMeetingEvent {
  /** Vexa's internal meeting id (stringified). Stable dedup key. */
  meetingId: string;
  platform?: string;
  nativeMeetingId?: string;
  /** Which envelope produced this (for logging/dedup reasoning). */
  kind: 'meeting_completed' | 'status_completed';
}
