import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('meeting', {
  call: (method: string, args?: unknown) => ipcRenderer.invoke('meeting', method, args),
  subscribe: (callback: (snapshot: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('snapshot', listener);
    return () => ipcRenderer.removeListener('snapshot', listener);
  },
  onCapture: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('capture', listener);
    return () => ipcRenderer.removeListener('capture', listener);
  },
});
