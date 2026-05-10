/**
 * Stores UI para los dos modales de mutación de playlists:
 *   - addToPlaylistUI: sheet "Añadir a playlist" (lista privadas del user).
 *   - createPlaylistUI: dialog "Crear nueva playlist" (puede llevar songIds
 *     iniciales si vino encadenado desde el sheet de "Añadir").
 *
 * Ambos viven en el +layout para ser invocables desde cualquier vista
 * (SongRow context menu, NowPlaying menu, library tab "+", etc.) sin
 * prop drilling.
 */

class AddToPlaylistUIStore {
  isOpen = $state(false);
  songIds = $state<string[]>([]);

  open(songIds: string[]): void {
    this.songIds = songIds;
    this.isOpen = true;
  }
  close(): void {
    this.isOpen = false;
  }
}

class CreatePlaylistUIStore {
  isOpen = $state(false);
  /** Si viene seteado, la playlist nueva nace con estas canciones. Útil
      para el flow "Añadir a playlist → Crear nueva" (preserva la canción
      que el director quería añadir). */
  initialSongIds = $state<string[]>([]);

  open(initialSongIds: string[] = []): void {
    this.initialSongIds = initialSongIds;
    this.isOpen = true;
  }
  close(): void {
    this.isOpen = false;
    this.initialSongIds = [];
  }
}

export const addToPlaylistUI = new AddToPlaylistUIStore();
export const createPlaylistUI = new CreatePlaylistUIStore();
