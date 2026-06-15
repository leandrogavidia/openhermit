import manifest from './manifest.js';

export default manifest;
export { manifest };
export { VexaBridge } from './bridge.js';
export { VexaWebhookReceiver } from './bot.js';
export { verifyVexaSignature } from './signature.js';
export { normalizeEvent, buildFinalizationPrompt } from './events.js';
export type { VexaRuntimeConfig } from './config.js';
export type {
  VexaWebhookEvent,
  NormalizedMeetingEvent,
  VexaFinalizationKind,
} from './types.js';
