import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getServerUrl: (): Promise<string> => ipcRenderer.invoke('store:getServerUrl'),
  setServerUrl: (url: string): Promise<boolean> => ipcRenderer.invoke('store:setServerUrl', url),
  platform: process.platform,
});
