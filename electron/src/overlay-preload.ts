import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  VoiceOverlayAction,
  VoiceOverlayConfig,
  VoiceOverlayState,
} from '../../src/lib/platform/voice-overlay-types';

export interface OverlayRenderPayload {
  config: VoiceOverlayConfig;
  state: VoiceOverlayState;
  unlocked: boolean;
  targetWidth: number;
  targetHeight: number;
  shortcutLabel: string;
}

contextBridge.exposeInMainWorld('sableOverlay', {
  onUpdate: (callback: (payload: OverlayRenderPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: OverlayRenderPayload) => {
      callback(payload);
    };
    ipcRenderer.on('sable-overlay-update', listener);
    return () => {
      ipcRenderer.removeListener('sable-overlay-update', listener);
    };
  },
  sendAction: (action: VoiceOverlayAction) => {
    ipcRenderer.send('sable-overlay-action', action);
  },
  reportSize: (width: number, height: number) => {
    ipcRenderer.send('sable-overlay-size', { width, height });
  },
  ready: () => {
    ipcRenderer.send('sable-overlay-ready');
  },
});
