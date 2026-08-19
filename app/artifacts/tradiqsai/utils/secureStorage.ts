import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Supabase's storage adapter is async, which lets native sessions stay in the
 * OS-protected keychain/keystore instead of expo-sqlite or localStorage.
 *
 * The web fallback is intentionally limited to web builds: SecureStore is a
 * native credential store and cannot provide browser persistence. Mobile
 * builds never touch localStorage.
 */
export const supabaseAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};