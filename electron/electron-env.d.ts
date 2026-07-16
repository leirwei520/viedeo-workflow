export interface ElectronAPI {
  isElectron: true;
  getServerUrl: () => Promise<string>;
  setServerUrl: (url: string) => Promise<boolean>;
  platform: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
