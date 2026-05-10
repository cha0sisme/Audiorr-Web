/**
 * Estado UI del Now Playing fullscreen viewer.
 *
 * Mirror del iOS `NowPlayingState.viewerIsOpen` + `viewerMode` (los modos
 * en iOS son implícitos por flags `showLyrics` / `hasCanvas`; aquí los
 * reificamos en un enum porque el switching es manual y queremos que el
 * usuario pueda forzar Cover incluso teniendo Canvas disponible).
 *
 * Tres modos exclusivos:
 *   - `cover`:  artwork hero centrado (default).
 *   - `canvas`: video full-bleed con controles flotantes abajo.
 *   - `lyrics`: scroll synced + header compacto. En wide screens (≥1280px)
 *               co-existe con artwork pequeño a la izq (split layout).
 *
 * El canvas mode requiere que `canvas.videoUrl` exista. Si pasamos a canvas
 * sin video, el componente cae graciosamente a cover.
 *
 * Reglas de mutex con el shell (gestionadas en +layout.svelte):
 *   - Al `open()`: se cierra QueuePanel del shell + CanvasPanel del shell.
 *   - El MiniPlayer queda visualmente oculto mientras isOpen.
 *   - La queue dentro del fullscreen se monta como sheet propio (innerQueueOpen).
 */

export type NowPlayingMode = 'cover' | 'canvas' | 'lyrics';

class NowPlayingUIStore {
  isOpen = $state(false);
  mode = $state<NowPlayingMode>('cover');

  /** Sheet de cola montada DENTRO del fullscreen — independiente del
      QueuePanel del shell. */
  innerQueueOpen = $state(false);

  open(mode: NowPlayingMode = 'cover'): void {
    this.mode = mode;
    this.isOpen = true;
  }
  close(): void {
    this.isOpen = false;
    this.innerQueueOpen = false;
  }
  setMode(m: NowPlayingMode): void {
    this.mode = m;
  }
  toggleInnerQueue(): void {
    this.innerQueueOpen = !this.innerQueueOpen;
  }
  closeInnerQueue(): void {
    this.innerQueueOpen = false;
  }
}

export const nowPlayingUI = new NowPlayingUIStore();
