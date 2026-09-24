import AsyncStorage from '@react-native-async-storage/async-storage';

/** On-device key/value storage. Failures are swallowed: nothing here is critical. */
export const storage = {
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw == null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable: the app still works for this session.
    }
  },
};
