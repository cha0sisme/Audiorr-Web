/**
 * QueueDB — persistencia local de la queue + nowplaying state via Dexie.
 *
 * Mirrors iOS UserDefaults keys (audiorr_queue, audiorr_currentIndex, etc.)
 * pero compactado en una única row "current" — siempre escribimos la
 * snapshot completa. Es más simple que mantener varias keys sueltas y la
 * tabla nunca crece más allá de 1 row.
 *
 * Nota web vs iOS: persistimos también `originalQueue` (iOS no lo hace).
 * iOS asume que tras cold-boot, si re-activás shuffle, "se reorganiza desde
 * lo que esté". Para web, persistir el orden original permite que al desactivar
 * shuffle tras reiniciar el navegador, la queue vuelva a su orden natural —
 * un upgrade pequeño y barato.
 */

import Dexie, { type Table } from 'dexie';
import type { PersistableSong, RepeatMode } from '$services/QueueManager.svelte';

export type QueueSnapshot = {
  /** Singleton row id. */
  id: 'current';
  queue: PersistableSong[];
  originalQueue: PersistableSong[];
  currentIndex: number;
  /** Posición en segundos consumida por playCurrentSong la próxima vez. */
  position: number;
  shuffleMode: boolean;
  repeatMode: RepeatMode;
  updatedAt: number;
};

class QueueDatabase extends Dexie {
  snapshots!: Table<QueueSnapshot, 'current'>;

  constructor() {
    super('audiorr-queue');
    this.version(1).stores({
      // PK = id; no necesitamos índices secundarios — siempre es la row "current".
      snapshots: 'id'
    });
  }
}

let _db: QueueDatabase | null = null;

function db(): QueueDatabase {
  if (!_db) _db = new QueueDatabase();
  return _db;
}

export async function loadSnapshot(): Promise<QueueSnapshot | null> {
  try {
    const snap = await db().snapshots.get('current');
    return snap ?? null;
  } catch (err) {
    console.warn('[QueueDB] loadSnapshot failed', err);
    return null;
  }
}

export async function saveSnapshot(snap: Omit<QueueSnapshot, 'id' | 'updatedAt'>): Promise<void> {
  try {
    await db().snapshots.put({
      id: 'current',
      ...snap,
      updatedAt: Date.now()
    });
  } catch (err) {
    console.warn('[QueueDB] saveSnapshot failed', err);
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    await db().snapshots.delete('current');
  } catch (err) {
    console.warn('[QueueDB] clearSnapshot failed', err);
  }
}
