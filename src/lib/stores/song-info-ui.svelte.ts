/**
 * Store UI para el modal "Información detallada" del archivo — abierto desde
 * el menu contextual de SongRow. Vive en +layout y se renderiza condicional.
 *
 * Solo plumbing de visibilidad + payload. El fetch del detalle completo
 * (`getSong(id)`) lo hace el propio modal vía TanStack Query, usando como
 * `initialData` los metadatos que el caller ya tuviera a mano (de
 * SongListItem / NavidromeSong) para evitar el flash de skeleton.
 */

import type { NavidromeSong } from '$types/navidrome';

class SongInfoUI {
  isOpen = $state(false);
  songId = $state('');
  /** Metadata ya disponible al disparar — sirve como `initialData` de la
      query para que el modal pinte algo inmediatamente. */
  initial = $state<Partial<NavidromeSong> | undefined>(undefined);

  open(songId: string, initial?: Partial<NavidromeSong>) {
    this.songId = songId;
    this.initial = initial;
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
  }
}

export const songInfoUI = new SongInfoUI();
