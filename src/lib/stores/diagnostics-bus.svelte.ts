/**
 * diagnostics-bus — bus reactivo para los 3 eventos socket.io de
 * `/api/diagnostics/*` que el backend emite via `io.to(user:<id>).emit(...)`
 * cada vez que hay un POST/PATCH/DELETE-comment de transition.
 *
 * Patrón: ConnectService recibe el evento del socket y publica al bus.
 * Los componentes consumen via `$effect(() => { ... bus.lastCreated ... })`.
 *
 * Aislado del ConnectService para no acoplar el cliente Connect a tipos
 * de Diagnostics (otro service podría reusar el mismo bus en el futuro,
 * o mockearlo para tests sin levantar socket).
 *
 * `tick` incrementa con CADA event aunque el payload sea el mismo —
 * permite que un $effect se dispare aunque por casualidad llegue dos
 * veces el mismo record (race / replay). Los consumers chequean tick
 * contra su last-seen.
 */

import type { TransitionRecord } from '$types/diagnostics';

export type DiagnosticDeletePayload = { id: string; deletedAt: string };

class DiagnosticsBus {
  /** Última transición creada vía POST iOS o web. null hasta el primer event. */
  lastCreated = $state<TransitionRecord | null>(null);
  /** Última transición actualizada vía PATCH (rate o comment). */
  lastUpdated = $state<TransitionRecord | null>(null);
  /** Último comment soft-deleted. */
  lastDeleted = $state<DiagnosticDeletePayload | null>(null);
  /** Counter monotónico — sube con cada event. Permite a los consumers
      detectar duplicates o forzar re-process. */
  tick = $state(0);

  publishCreated(record: TransitionRecord): void {
    this.lastCreated = record;
    this.tick = this.tick + 1;
  }
  publishUpdated(record: TransitionRecord): void {
    this.lastUpdated = record;
    this.tick = this.tick + 1;
  }
  publishDeleted(payload: DiagnosticDeletePayload): void {
    this.lastDeleted = payload;
    this.tick = this.tick + 1;
  }
}

export const diagnosticsBus = new DiagnosticsBus();
