/**
 * video-cleanup — libera recursos de elementos <video> de forma inmediata.
 *
 * Un <video> que se desmonta (o al que se le reasigna el src) NO suelta al
 * instante sus buffers de red ni el decoder: el navegador es perezoso con el
 * GC de media. Reproduciendo muchas canciones seguidas (canvas + motion
 * artwork) eso se acumula y la memoria crece sin techo. Llamar a
 * `releaseVideo` fuerza la liberación ya.
 */

/** Pausa el vídeo y suelta su recurso de media (buffers + decoder).
 *
 *  Quitamos el ATRIBUTO `src` (no lo ponemos a `''`, que dispara el warning
 *  "Empty src attribute") y llamamos a `load()`: el algoritmo de selección de
 *  recurso corre sin fuente, emite `emptied` y el navegador libera lo anterior.
 */
export function releaseVideo(el: HTMLVideoElement | null | undefined): void {
  if (!el) return;
  try {
    el.pause();
    el.removeAttribute('src');
    // srcObject por si algún día se alimenta desde un MediaStream/blob.
    if ('srcObject' in el) el.srcObject = null;
    el.load();
  } catch {
    // Elemento ya desconectado / estado inválido — nada que liberar.
  }
}

/** Svelte action: libera el <video> al desmontarlo.
 *
 *  Uso: `<video use:videoTeardown ...>`. Cubre tanto el unmount del componente
 *  como el remount de un bloque `{#key url}` (destruye el <video> saliente). */
export function videoTeardown(node: HTMLVideoElement) {
  return {
    destroy() {
      releaseVideo(node);
    }
  };
}
