import { app, systemPreferences } from 'electron';
export function platformInfo() {
  return {
    os: process.platform,
    release: process.getSystemVersion?.() || '',
    microphone:
      process.platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('microphone')
        : 'requires-user-selection',
    screen:
      process.platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('screen')
        : 'requires-user-selection',
    audioRoute:
      process.platform === 'win32'
        ? 'WASAPI loopback + microphone'
        : process.platform === 'darwin'
          ? 'CoreAudio loopback + microphone'
          : 'unsupported',
    dataDirectory: app.getPath('userData'),
  };
}
export function supportedDesktop() {
  return process.platform === 'darwin' || process.platform === 'win32';
}
