import { z } from 'zod';
import { Locale, type Preferences } from '../contracts/model';
export const LanguageChoice = z.enum(['system', 'en', 'zh-CN']);
export const AudioPreferences = z
  .object({
    deviceId: z.string().max(300),
    deviceLabel: z.string().max(150),
    includeComputerAudio: z.boolean(),
    setupCompleted: z.boolean(),
  })
  .strict();
export const PreferencesSchema = z
  .object({
    uiLocale: Locale,
    defaultOutputLocale: Locale,
    reduceMotion: z.boolean(),
    reduceTransparency: z.boolean(),
    shortcut: z.string().max(100),
    launcherVisible: z.boolean().optional(),
    meetingReminders: z.boolean().optional(),
    uiLanguage: LanguageChoice.optional(),
    defaultOutputLanguage: LanguageChoice.optional(),
    audio: AudioPreferences.optional(),
  })
  .strict();
export function systemLocale(value: string): 'en' | 'zh-CN' {
  return /^zh(?:[-_]|$)/i.test(value) ? 'zh-CN' : 'en';
}
export function resolvePreferences(value: Preferences, system: string): Preferences {
  const p = PreferencesSchema.parse(value);
  return {
    ...p,
    launcherVisible: p.launcherVisible ?? true,
    meetingReminders: p.meetingReminders ?? true,
    uiLanguage: p.uiLanguage ?? p.uiLocale,
    defaultOutputLanguage: p.defaultOutputLanguage ?? p.defaultOutputLocale,
    uiLocale: p.uiLanguage === 'system' ? systemLocale(system) : (p.uiLanguage ?? p.uiLocale),
    defaultOutputLocale:
      p.defaultOutputLanguage === 'system'
        ? systemLocale(system)
        : (p.defaultOutputLanguage ?? p.defaultOutputLocale),
    audio: p.audio ?? {
      deviceId: 'default',
      deviceLabel: '',
      includeComputerAudio: false,
      setupCompleted: false,
    },
  };
}

export const PreferencesPatchSchema = PreferencesSchema.partial()
  .extend({ audio: AudioPreferences.partial().optional() })
  .strict();
export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;
export function mergePreferences(current: Preferences, patch: PreferencesPatch): Preferences {
  const { audio, ...fields } = patch;
  return {
    ...current,
    ...fields,
    audio: audio
      ? {
          ...(current.audio ?? {
            deviceId: 'default',
            deviceLabel: '',
            includeComputerAudio: false,
            setupCompleted: false,
          }),
          ...audio,
        }
      : current.audio,
  };
}
export function patchPreferences(current: Preferences, raw: unknown, system: string): Preferences {
  return resolvePreferences(mergePreferences(current, PreferencesPatchSchema.parse(raw)), system);
}
