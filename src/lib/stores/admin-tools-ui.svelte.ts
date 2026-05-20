/**
 * AdminToolsUIStore — coordina la apertura de modales admin one-shot desde
 * cualquier call site (SongRow context menu, NowPlaying 3-dots, etc.).
 *
 * Modales gestionados:
 *   - Canvas queue (enqueueCanvasJob).
 *   - Update play count (Music-API).
 *   - Edit smart tags (Music-API).
 *
 * Patrón análogo a `addToPlaylistUI` / `createPlaylistUI`.
 */

export type AdminSongTarget = {
  songId: string;
  songTitle: string;
  songArtist: string;
};

export type CanvasQueueTarget = AdminSongTarget;

class AdminToolsUIStore {
  /** Si no es null, el CanvasQueueModal se monta apuntando a este target. */
  canvasQueueTarget = $state<CanvasQueueTarget | null>(null);
  /** Si no es null, el UpdatePlayCountModal se monta apuntando a este target. */
  playCountTarget = $state<AdminSongTarget | null>(null);
  /** Si no es null, el SmartTagsModal se monta apuntando a este target. */
  smartTagsTarget = $state<AdminSongTarget | null>(null);

  openCanvasQueue(target: CanvasQueueTarget) {
    this.canvasQueueTarget = target;
  }
  closeCanvasQueue() {
    this.canvasQueueTarget = null;
  }

  openPlayCount(target: AdminSongTarget) {
    this.playCountTarget = target;
  }
  closePlayCount() {
    this.playCountTarget = null;
  }

  openSmartTags(target: AdminSongTarget) {
    this.smartTagsTarget = target;
  }
  closeSmartTags() {
    this.smartTagsTarget = null;
  }
}

export const adminToolsUI = new AdminToolsUIStore();
