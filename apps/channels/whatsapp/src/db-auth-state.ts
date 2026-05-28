import {
  BufferJSON,
  initAuthCreds,
  proto,
} from 'baileys';
import type {
  AuthenticationState,
  SignalDataSet,
  SignalDataTypeMap,
} from 'baileys';
import type { ChannelCredentialStore } from '@openhermit/protocol';

const CREDS_KEY = 'creds';

const keyName = (type: string, id: string): string =>
  `key:${type}:${id}`;

export const serializeAuthValue = (value: unknown): string =>
  JSON.stringify(value, BufferJSON.replacer);

export const deserializeAuthValue = <T = unknown>(value: string): T =>
  JSON.parse(value, BufferJSON.reviver) as T;

export const useDbAuthState = async (
  store: ChannelCredentialStore,
  profile: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
  const storedCreds = await store.get(profile, CREDS_KEY);
  const creds = storedCreds
    ? deserializeAuthValue<AuthenticationState['creds']>(storedCreds)
    : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[],
      ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
        const data: Record<string, unknown> = {};
        await Promise.all(ids.map(async (id) => {
          const raw = await store.get(profile, keyName(String(type), id));
          if (raw === undefined) return;
          let value = deserializeAuthValue(raw);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as never);
          }
          data[id] = value;
        }));
        return data as { [id: string]: SignalDataTypeMap[T] };
      },
      set: async (data: SignalDataSet): Promise<void> => {
        const tasks: Array<Promise<void>> = [];
        const raw = data as Record<string, Record<string, unknown | null> | undefined>;
        for (const [category, values] of Object.entries(raw)) {
          if (!values) continue;
          for (const [id, value] of Object.entries(values)) {
            const storageKey = keyName(category, id);
            tasks.push(
              value
                ? store.set(profile, storageKey, serializeAuthValue(value))
                : store.delete(profile, storageKey),
            );
          }
        }
        await Promise.all(tasks);
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await store.set(profile, CREDS_KEY, serializeAuthValue(creds));
    },
  };
};
