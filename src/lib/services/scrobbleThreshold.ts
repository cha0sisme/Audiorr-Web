/**
 * Scrobbling Fase 2 — regla ÚNICA de umbral + reloj de audio activo.
 *
 * Este módulo es la SPEC EJECUTABLE del feature, y la referencia del port a
 * iOS (Swift) y Android (Kotlin): `scrobbleThreshold.test.ts` cubre los 6
 * casos obligatorios y el criterio es "misma entrada → misma decisión" en
 * los tres dialectos.
 *
 * Deliberadamente sin estado de UI/red/localStorage — `ScrobbleService`
 * (el orquestador, con sus side-effects) es el único consumidor. Separado
 * así porque:
 *   1. Es puro y trivial de testear sin mockear stores/sockets/localStorage.
 *   2. Es el candidato natural a portar 1:1 — una función pura y una clase
 *      de ~15 líneas se leen/traducen sin ambigüedad.
 */

// ============================================================================
// C1 — umbral sobre `playable`, no sobre la duración nominal
// ============================================================================

export type ScrobbleWindow = {
  /** Segundos de la canción que el oyente PUDO llegar a escuchar. En modo
      normal = `duration` (nadie recorta nada). En modo DJ = lo que queda
      tras el `startPosition` donde el mix metió al oyente. */
  readonly playable: number;
  /** Segundos de escucha activa necesarios para contar como play. */
  readonly threshold: number;
  /** Mínimo absoluto de `playable` para no ser un "teaser" — evita que un
      recorte extremo (mix que se come casi toda la canción) produzca un
      threshold ridículamente bajo y cualifique con 2-3s de escucha. */
  readonly guardMinimum: number;
  /** `false` → la canción es estructuralmente inscrobbleable en esta
      reproducción (el guard bloquea, sin importar cuánto se escuche). */
  readonly passesGuard: boolean;
};

/**
 * Calcula la ventana de scrobble para una reproducción.
 *
 * ```
 * playable   = max(0, duration − startPosition)
 * threshold  = min(playable * 0.5, 240)
 * guard      = min(30, duration * 0.5)
 * passesGuard = playable >= guard
 * ```
 *
 * `startPosition` es la posición REAL en la que la canción entra en juego
 * (0 en modo normal; el offset empírico de aterrizaje del crossfade DJ en
 * modo DJ — ver `ScrobbleService.songDidStart`). NO es `config.entryPoint`:
 * por el clamp `startOffset = max(0, entryPoint − totalTime)` de
 * `CrossfadeExecutor`, cuando `entryPoint < totalTime` la canción aterriza
 * en `totalTime`, no en `entryPoint`. El dato del engine es el bueno.
 *
 * No-regresión por construcción: con `startPosition = 0`,
 * `playable === duration` y la fórmula colapsa bit a bit a la de hoy
 * (`min(duration * 0.5, 240)`), y el guard es tautológico (ver test 6).
 *
 * PORT NOTE (Kotlin/Swift): función pura, sin dependencias de plataforma
 * — portar literal, campo a campo.
 */
export function computeScrobbleWindow(params: {
  readonly duration: number;
  readonly startPosition: number;
}): ScrobbleWindow {
  const playable = Math.max(0, params.duration - params.startPosition);
  const threshold = Math.min(playable * 0.5, 240);
  const guardMinimum = Math.min(30, params.duration * 0.5);
  return {
    playable,
    threshold,
    guardMinimum,
    passesGuard: playable >= guardMinimum
  };
}

/**
 * Decisión final: ¿esta reproducción cualifica para scrobble YA?
 *
 * `activeElapsedSec` es tiempo de ESCUCHA ACTIVA (ver `ActiveListenClock`
 * más abajo, C2) — no wall-clock. Con reloj de audio real,
 * `activeElapsedSec === playable` siempre que no haya skip, así que en la
 * práctica la regla se reduce a "¿escuchaste al menos la mitad de lo que
 * el mix te ofreció?".
 */
export function shouldScrobble(params: {
  readonly duration: number;
  readonly startPosition: number;
  readonly activeElapsedSec: number;
}): boolean {
  const window = computeScrobbleWindow(params);
  return window.passesGuard && params.activeElapsedSec >= window.threshold;
}

// ============================================================================
// C2 — reloj de audio activo (la pausa no cuenta)
// ============================================================================

/**
 * Acumula segundos de escucha ACTIVA para la canción en curso, congelando
 * el contador mientras el playback está en pausa.
 *
 * Implementación de referencia (backend, ya en producción para los
 * clientes externos vía polling): `nowPlayingPollerService.ts:175-179`.
 * Comentario original: "Usar activeSecs (tiempo real de escucha activa),
 * no reloj de pared. Esto evita que una pausa larga infle artificialmente
 * el tiempo y dispare el scrobble." El backend hace esto a golpe de poll
 * (1 tick = 1 intervalo de poll, sumado solo si `isActivelyPlaying`); aquí
 * lo hacemos a golpe de evento (play/pause), que es más preciso porque
 * web SÍ tiene esos eventos en tiempo real.
 *
 * Invariante: `elapsedSeconds()` == wall-clock transcurrido MENOS el
 * tiempo total en pausa. Un `reset()` arranca asumiendo reproducción
 * activa desde ya (mirror del wall-clock previo, que ya asumía "está
 * sonando" desde `songDidStart` — no es un cambio de semántica en el
 * arranque, solo en cómo se trata la pausa intermedia).
 *
 * PORT NOTE (Kotlin/Swift): acumulador con 4 métodos
 * (reset/pause/resume/elapsedSeconds), reloj inyectado
 * (`System.currentTimeMillis` / `Date()`) para que sea testeable con
 * tiempo fake sin `Thread.sleep` real. `pause()`/`resume()` deben ser
 * idempotentes (llamar dos veces seguidas a `pause()` no debe restar dos
 * veces) — los tests de la spec lo asumen.
 */
export class ActiveListenClock {
  private accumulatedMs = 0;
  private segmentStartMs: number | null = null;

  /** `now` inyectable — en producción `() => Date.now()`, en tests un
      reloj fake controlado a mano. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Arranca (o reinicia) el contador para una canción nueva. Asume
      reproducción activa desde este instante. */
  reset(): void {
    this.accumulatedMs = 0;
    this.segmentStartMs = this.now();
  }

  /** Congela el contador — el tiempo en pausa no se acumula. Idempotente:
      pausar dos veces seguidas es un no-op la segunda vez. */
  pause(): void {
    if (this.segmentStartMs === null) return;
    this.accumulatedMs += this.now() - this.segmentStartMs;
    this.segmentStartMs = null;
  }

  /** Reanuda el contador tras una pausa. Idempotente. No-op si nunca se
      llamó `reset()` (no hay canción activa que reanudar). */
  resume(): void {
    if (this.segmentStartMs !== null) return;
    this.segmentStartMs = this.now();
  }

  /** Segundos de escucha activa acumulados hasta este instante. */
  elapsedSeconds(): number {
    const liveMs = this.segmentStartMs !== null ? this.now() - this.segmentStartMs : 0;
    return (this.accumulatedMs + liveMs) / 1000;
  }
}
