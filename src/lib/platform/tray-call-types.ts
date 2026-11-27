export type TrayCallStatus = 'idle' | 'connected' | 'speaking' | 'muted' | 'deafened';

export interface TrayCallState {
  status: TrayCallStatus;
  icon: string | null;
}
