/**
 * Vexa webhook payload shapes. Fields are intentionally loose/optional —
 * we only read the few we act on and tolerate Vexa adding others.
 *
 * REST webhooks use `event_type`; the WebSocket stream uses `type`. The
 * normalizer accepts either.
 */

export interface VexaMeetingPayload {
  id?: number | string;
  platform?: string;
  native_meeting_id?: string;
  status?: string;
  start_time?: string | null;
  end_time?: string | null;
}

export interface VexaStatusChange {
  from?: string;
  to?: string;
  reason?: string;
  timestamp?: string;
}

export interface VexaRecordingMediaFile {
  id?: number | string;
  type?: string;
  format?: string;
  file_size_bytes?: number;
  duration_seconds?: number;
}

export interface VexaRecordingPayload {
  id?: number | string;
  meeting_id?: number | string;
  status?: string;
  completed_at?: string;
  media_files?: VexaRecordingMediaFile[];
}

export interface VexaWebhookEvent {
  event_type?: string;
  type?: string;
  meeting?: VexaMeetingPayload;
  status_change?: VexaStatusChange;
  recording?: VexaRecordingPayload;
}

export type VexaFinalizationKind = 'meeting_completed' | 'recording_completed';

/** A raw Vexa webhook reduced to the completion signal we act on. */
export interface NormalizedMeetingEvent {
  /** Vexa internal meeting id — the stable per-meeting dedup key. */
  meetingId: string;
  kind: VexaFinalizationKind;
  platform?: string;
  nativeMeetingId?: string;
  recordingId?: string;
}
