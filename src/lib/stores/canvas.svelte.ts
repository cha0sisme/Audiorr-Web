/**
 * CanvasStore — gestiona la visibilidad y ancho del panel de Canvas.
 *
 * Lógica:
 * - Cuando cambia la canción, se llama `setForSong(songId, canvasUrl)`.
 *   Solo AUTO-ABRE la primera vez que aparece un canvas. **Nunca auto-cierra**
 *   al saltar a una canción sin canvas: el panel persiste (el CanvasPanel cae a
 *   motion artwork del álbum → carátula estática) para no desplazar el
 *   MiniPlayer/columna del grid en cada cambio de tema (estilo Spotify).
 * - El usuario cierra con `dismiss()` → sticky: no se vuelve a auto-abrir hasta
 *   que lo reabra a mano (`restore()`). Coherente con el "Now Playing view" de
 *   Spotify (una vez lo cierras, se queda cerrado).
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
  /** URL del canvas (vídeo por canción) de la canción actual, o null si no
      tiene. El CanvasPanel cae a motion artwork / carátula cuando es null. */
  videoUrl = $state<string | null>(null);
  /** El usuario cerró el panel a mano → no volver a auto-abrir aunque
      aparezcan canvas nuevos, hasta que lo reabra (sticky, estilo Spotify). */
  userDismissed = $state(false);
  demoMode = $state(false);
  width = $state(loadWidth());
  /** True mientras el usuario está arrastrando el handle de resize. El shell
      lo lee para desactivar el transition de grid-template-columns y que el
      drag responda instantáneo (sin lag de 280ms). */
  isDragging = $state(false);

  setForSong(_songId: string, url: string | null) {
    this.demoMode = false;
    this.videoUrl = url;
    // Auto-abrir SOLO la primera vez que hay canvas (si el user no cerró el
    // panel y la cola no está abierta). NUNCA auto-cerramos al cambiar de
    // canción: el panel persiste y el CanvasPanel cae a motion artwork /
    // carátula, para no desplazar el MiniPlayer al saltar de una canción con
    // canvas a una sin él.
    if (url && !this.userDismissed && !queueUI.isOpen) {
      this.visible = true;
    }
  }

  dismiss() {
    this.visible = false;
    this.userDismissed = true;
    this.demoMode = false;
  }

  /** Reabrir manualmente desde el botón del MiniPlayer. Limpia el sticky-dismiss
      y muestra el panel. Con el modelo "siempre hay algo que enseñar" (canvas →
      motion → carátula) no necesita guardas: mientras haya canción, hay cover. */
  restore() {
    this.userDismissed = false;
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
    this.userDismissed = false;
  }

  /** Snapshot de visible al entrar en un overlay (ej. NowPlaying fullscreen)
      para poder restaurar el state al cerrarlo. NO toca userDismissed — la
      idea es ocultar el panel del shell sin perder la información de que
      el canvas SIGUE disponible para esta canción. */
  private wasVisibleBeforeOverlay = false;

  /** Llamar al abrir un overlay (NowPlaying viewer) que necesita el real
      estate completo. Oculta el panel canvas del shell sin marcar la
      canción como dismissed (mantenemos `videoUrl` intacto para que el
      botón canvas del MiniPlayer siga habilitado al volver). */
  suspendForOverlay(): void {
    this.wasVisibleBeforeOverlay = this.visible;
    this.visible = false;
  }

  /** Llamar al cerrar el overlay. Si el panel estaba visible antes y
      seguimos teniendo videoUrl, lo volvemos a abrir — el usuario recupera
      exactamente lo que tenía. */
  resumeAfterOverlay(): void {
    if (this.wasVisibleBeforeOverlay && this.videoUrl) {
      this.visible = true;
    }
    this.wasVisibleBeforeOverlay = false;
  }
}

export const canvas = new CanvasStore();
