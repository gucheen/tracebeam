import { getCurrentWindow } from '@tauri-apps/api/window';

export function initializeWindowControls(): void {
  if (!('__TAURI_INTERNALS__' in window) || !/Win/.test(navigator.platform)) return;
  const appWindow = getCurrentWindow();
  const controls = document.querySelector<HTMLElement>('#windowControls')!;
  controls.hidden = false;
  const actions: Record<string, () => Promise<void>> = {
    windowMinimize: () => appWindow.minimize(),
    windowMaximize: () => appWindow.toggleMaximize(),
    windowClose: () => appWindow.close(),
  };
  for (const [id, action] of Object.entries(actions)) {
    document.getElementById(id)!.addEventListener('click', () => {
      void action().catch(error => console.error('Failed to update window', error));
    });
  }
}
