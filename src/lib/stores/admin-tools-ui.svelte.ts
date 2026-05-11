/**
 * AdminToolsUIStore — coordina la apertura del modal de "Enviar a la cola
 * de Canvas" (y futuras herramientas admin one-shot) desde cualquier call
 * site (SongRow context menu, NowPlaying 3-dots, etc.).
 *
 * Patrón análogo a `addToPlaylistUI` / `createPlaylistUI`.
 */

export type CanvasQueueTarget = {
  songId: string;
  songTitle: string;
  songArtist: string;
};

class AdminToolsUIStore {
  /** Si no es null, el CanvasQueueModal se monta apuntando a este target. */
  canvasQueueTarget = $state<CanvasQueueTarget | null>(null);

  openCanvasQueue(target: CanvasQueueTarget) {
    this.canvasQueueTarget = target;
  }
  closeCanvasQueue() {
    this.canvasQueueTarget = null;
  }
}

export const adminToolsUI = new AdminToolsUIStore();
