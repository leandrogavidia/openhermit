import { AgentLocalClient } from '@openhermit/sdk';

import type { NormalizedMeetingEvent } from './types.js';
import { buildFinalizationPrompt } from './events.js';

/**
 * Turns a normalized Vexa completion event into an owner-scoped agent turn
 * that captures the meeting into long-term memory.
 *
 * The bridge talks to the agent over the agent-local HTTP API (it has no
 * direct DB/store access). Owner attribution and per-meeting persistence are
 * resolved server-side: the synthesized session carries `act_as_owner` so the
 * runtime's `resolveSessionUser` runs the turn as the agent's owner, and a
 * stable `vexa:<meetingId>` session id keeps retries in one session.
 */
export class VexaBridge {
  private readonly client: AgentLocalClient;
  private readonly log: (message: string) => void;
  /**
   * Meetings finalized this process lifetime — guards against Vexa's webhook
   * retries (and the meeting/recording double-event) re-triggering. Durable
   * cross-restart dedup is handled by the agent skill, which checks memory
   * before writing.
   */
  private readonly finalized = new Set<string>();

  constructor(
    clientOptions: { baseUrl: string; token: string; fetch?: typeof fetch },
    logger?: (message: string) => void,
  ) {
    this.client = new AgentLocalClient(clientOptions);
    this.log = logger ?? ((msg): void => console.log(`[vexa-bridge] ${msg}`));
  }

  async finalizeMeeting(ref: NormalizedMeetingEvent): Promise<void> {
    const { meetingId } = ref;
    if (this.finalized.has(meetingId)) {
      this.log(`meeting ${meetingId} already finalized this run — ignoring duplicate (${ref.kind})`);
      return;
    }
    this.finalized.add(meetingId);

    const sessionId = `vexa:${meetingId}`;
    try {
      await this.client.openSession({
        sessionId,
        source: { kind: 'channel', interactive: false, platform: 'vexa', type: 'direct' },
        metadata: {
          act_as_owner: true,
          vexa_meeting_id: meetingId,
          ...(ref.platform ? { vexa_platform: ref.platform } : {}),
          ...(ref.nativeMeetingId ? { vexa_native_meeting_id: ref.nativeMeetingId } : {}),
        },
      });

      const result = await this.client.postMessage(sessionId, {
        messageId: `vexa:${meetingId}:finalize`,
        mentioned: true,
        text: buildFinalizationPrompt(ref),
      });

      const triggered = (result as { triggered?: boolean }).triggered;
      this.log(`finalization turn posted for meeting ${meetingId} (triggered=${triggered ?? 'unknown'})`);
    } catch (err) {
      // Roll back so a later Vexa retry (or the recording.completed event) can
      // re-attempt the capture.
      this.finalized.delete(meetingId);
      this.log(
        `failed to start finalization for meeting ${meetingId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
