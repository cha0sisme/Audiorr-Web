/**
 * CanvasStore — gestiona la visibilidad y ancho del panel de Canvas.
 *
 * Lógica:
 * - Cuando cambia la canción, se llama `setForSong(songId, canvasUrl)`.
 *   Si la URL existe → panel se abre. Si no → se cierra.
 * - El usuario puede cerrar manualmente con `dismiss()` — recuerda el
 *   songId para no reabrir hasta que cambie la canción.
 * - `width` controla el ancho del panel. Es draggable desde el borde izq.
 *   Persiste en localStorage. Min/max para que no se desborde.
 * - `forceShowDemo()` permite probar la animación sin backend real.
 *
 * Mutex con QueuePanel: si la cola está abierta, `setForSong` NUNCA
 * dispara auto-show — la cola es una elección explícita del usuario y no
 * debe verse pisada por un cambio de canción que casualmente tenga
 * canvas. La `videoUrl` sí se actualiza para que el botón Canvas en
 * MiniPlayer refleje disponibilidad; el usuario lo pulsa si quiere
 * cambiar al canvas (y `toggleCanvasPanel` cierra la cola entonces).
 */

import { browser } from '$app/environment';
import { queueUI } from './queue-ui.svelte';

const WIDTH_KEY = 'audiorr-canvas-width';

export const CANVAS_MIN_WIDTH = 300;
export const CANVAS_MAX_WIDTH = 420;
export const CANVAS_DEFAULT_WIDTH = 320;

function loadWidth(): number {
  if (!browser) return CANVAS_DEFAULT_WIDTH;
  const raw = localStorage.getItem(WIDTH_KEY);
  if (!raw) return CANVAS_DEFAULT_WIDTH;
  const n = Number(raw);
  if (!Number.isFinite(n)) return CANVAS_DEFAULT_WIDTH;
  return Math.max(CANVAS_MIN_WIDTH, Math.min(CANVAS_MAX_WIDTH, n));
}

class CanvasStore {
  visible = $state(false);
  videoUrl = $state<string | null>(null);
  dismissedSongId = $state<string | null>(null);
  demoMode = $state(false);
  width = $state(loadWidth());
  /** True mientras el usuario está arrastrando el handle de resize. El shell
      lo lee para desactivar el transition de grid-template-columns y que el
      drag responda instantáneo (sin lag de 280ms). */
  isDragging = $state(false);

  setForSong(songId: string, url: string | null) {
    this.demoMode = false;
    if (this.dismissedSongId === songId) {
      this.visible = false;
      this.videoUrl = null;
      return;
    }
    this.videoUrl = url;
    // Auto-show solo si hay URL Y la cola NO está abierta. Si la cola
    // está abierta, `videoUrl` queda guardado (botón Canvas habilitado)
    // pero el panel no se monta — no pisamos la elección del usuario.
    this.visible = !!url && !queueUI.isOpen;
  }

  dismiss(songId: string | null) {
    if (songId) this.dismissedSongId = songId;
    this.visible = false;
    this.demoMode = false;
  }

  /** Reabrir manualmente desde el botón del MiniPlayer. Limpia el dismiss
      registrado para la canción actual y vuelve a mostrar (si hay videoUrl
      o demoMode). No-op si no tenemos nada que mostrar — el botón debería
      estar disabled en ese caso, pero defendemos en runtime igual. */
  restore() {
    if (!this.videoUrl && !this.demoMode) return;
    this.dismissedSongId = null;
    this.visible = true;
  }

  setWidth(w: number) {
    const clamped = Math.max(CANVAS_MIN_WIDTH, Math.min(CANVAS_MAX_WIDTH, Math.round(w)));
    this.width = clamped;
    if (browser) localStorage.setItem(WIDTH_KEY, String(clamped));
  }

  forceShowDemo() {
    this.demoMode = true;
    this.videoUrl = null;
    this.visible = true;
    this.dismissedSongId = null;
  }
}

export const canvas = new CanvasStore();
