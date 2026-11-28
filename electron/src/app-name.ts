declare const __SABLE_APP_NAME__: string | undefined;

export const APP_NAME =
  (typeof __SABLE_APP_NAME__ === 'string' && __SABLE_APP_NAME__.trim()) ||
  process.env.VITE_APP_NAME?.trim() ||
  'Dunhascord';
