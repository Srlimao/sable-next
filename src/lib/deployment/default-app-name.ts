const configured = (import.meta as ImportMeta & { env?: { VITE_APP_NAME?: string } }).env
  ?.VITE_APP_NAME?.trim();

export const DEFAULT_APP_NAME = configured || 'Dunhascord';
