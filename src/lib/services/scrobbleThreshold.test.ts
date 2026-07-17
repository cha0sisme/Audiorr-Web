import { describe, expect, it } from 'vitest';

import { ActiveListenClock, computeScrobbleWindow, shouldScrobble } from './scrobbleThreshold';

/**
 * Spec ejecutable de la Fase 2 de scrobbling: los 6 casos obligatorios del
 * contrato del feature.
 *
 * Estos 6 casos son EL CONTRATO del port a Swift (iOS) y Kotlin (Android):
 * misma entrada (duration, startPosition, secuencia de play/pause) → misma
 * decisión de scrobble. Nombrados y comentados para que un port 1:1 los
 * pueda seguir sin releer el issue completo.
 *
 * Helper compartido: un reloj fake con avance manual (`advance(seconds)`)
 * en vez de `vi.useFakeTimers()` — más legible para simular
 * play/pause/play sin depender de un runner de timers.
 */
function makeFakeClock(): { now: () => number; advance: (seconds: number) => void } {
  let ms = 0;
  return {
    now: () => ms,
    advance: (seconds: number) => {
      ms += seconds * 1000;
    }
  };
}

describe('scrobbleThreshold — Fase 2 (C1 + C2)', () => {
  // --------------------------------------------------------------------
  // Caso 1 — modo normal, sin pausa: debe comportarse IDÉNTICO a la
  // fórmula de hoy (`threshold = min(duration * 0.5, 240)`, reloj
  // wall-clock puro porque no hay pausa que reste).
  // --------------------------------------------------------------------
  it('normal, sin pausa: umbral = min(duration*0.5, 240), igual que hoy', () => {
    const duration = 200; // threshold = min(100, 240) = 100
    const fake = makeFakeClock();
    const clock = new ActiveListenClock(fake.now);
    clock.reset(); // startPosition=0 → arranca "escuchando" desde ya

    fake.advance(99);
    expect(
      shouldScrobble({ duration, startPosition: 0, activeElapsedSec: clock.elapsedSeconds() })
    ).toBe(false);

    fake.advance(1); // total 100s activos, sin pausas
    expect(
      shouldScrobble({ duration, startPosition: 0, activeElapsedSec: clock.elapsedSeconds() })
    ).toBe(true);
  });

  // --------------------------------------------------------------------
  // Caso 2 — modo normal, CON pausa: la pausa no debe contar como
  // escucha. Wall-clock total (399s) supera de sobra el umbral (100s),
  // pero el tiempo ACTIVO real (99s) no — el scrobble no dispara hasta
  // que el activo real llega a 100s.
  // --------------------------------------------------------------------
  it('normal, con pausa: la pausa no cuenta (reloj de audio activo)', () => {
    const duration = 200; // threshold = 100
    const fake = makeFakeClock();
    const clock = new ActiveListenClock(fake.now);
    clock.reset();

    fake.advance(60); // 60s activos
    clock.pause();
    fake.advance(300); // pausa de 5 minutos — NO debe acumular
    clock.resume();
    fake.advance(39); // 60 + 39 = 99s activos (wall-clock total: 399s)

    expect(
      shouldScrobble({ duration, startPosition: 0, activeElapsedSec: clock.elapsedSeconds() })
    ).toBe(false); // con reloj wall-clock (bug viejo) esto habría sido `true`

    fake.advance(1); // 100s activos exactos
    expect(
      shouldScrobble({ duration, startPosition: 0, activeElapsedSec: clock.elapsedSeconds() })
    ).toBe(true);
  });

  // --------------------------------------------------------------------
  // Caso 3 — modo DJ, sin pausa: el umbral debe operar sobre `playable`
  // (lo que el mix dejó sonar), no sobre la duración nominal. Con
  // duration=240 la fórmula VIEJA habría exigido 120s de escucha
  // (min(240*0.5,240)); aquí el mix entra en startPosition=200, así que
  // playable=40 y el umbral real es 20s — un orden de magnitud menor.
  // --------------------------------------------------------------------
  it('DJ, sin pausa: umbral sobre playable, no sobre la duración nominal', () => {
    const duration = 240;
    const startPosition = 200; // el mix ya se comió 200s de la canción
    const window = computeScrobbleWindow({ duration, startPosition });
    expect(window.playable).toBe(40);
    expect(window.threshold).toBe(20); // min(40*0.5, 240) = 20, NO 120

    const fake = makeFakeClock();
    const clock = new ActiveListenClock(fake.now);
    clock.reset();

    fake.advance(19);
    expect(
      shouldScrobble({ duration, startPosition, activeElapsedSec: clock.elapsedSeconds() })
    ).toBe(false);

    fake.advance(1); // 20s activos
    expect(
      shouldScrobble({ duration, startPosition, activeElapsedSec: clock.elapsedSeconds() })
    ).toBe(true);
  });

  // --------------------------------------------------------------------
  // Caso 4 — modo DJ, CON pausa: C1 y C2 componen. Mismo escenario que el
  // caso 3 pero con una pausa en medio — el umbral sigue siendo 20s sobre
  // `playable`, y la pausa tampoco cuenta aquí.
  // --------------------------------------------------------------------
  it('DJ, con pausa: C1 (playable) y C2 (reloj activo) componen', () => {
    const duration = 240;
    const startPosition = 200; // playable=40, threshold=20
    const fake = makeFakeClock();
    const clock = new ActiveListenClock(fake.now);
    clock.reset();

    fake.advance(10); // 10s activos
    clock.pause();
    fake.advance(120); // 2 minutos de pausa — no cuentan
    clock.resume();
    fake.advance(9); // 10 + 9 = 19s activos

    expect(
      shouldScrobble({ duration, startPosition, activeElapsedSec: clock.elapsedSeconds() })
    ).toBe(false);

    fake.advance(1); // 20s activos exactos → alcanza el umbral
    expect(
      shouldScrobble({ duration, startPosition, activeElapsedSec: clock.elapsedSeconds() })
    ).toBe(true);
  });

  // --------------------------------------------------------------------
  // Caso 5 — tema corto en el límite (el caso skit): un tema de 60s donde
  // el mix entra tarde (startPosition=50) deja playable=10s. Sin el guard
  // anti-teaser, el umbral sería min(10*0.5,240)=5s — cualifica con
  // apenas 5s de escucha, un "teaser" indefendible. El guard
  // (`playable >= min(30, duration*0.5)`) lo bloquea: aquí
  // min(30,30)=30 y playable=10 < 30 → NUNCA scrobblea, ni escuchando
  // el playable ENTERO.
  // --------------------------------------------------------------------
  it('tema corto en el límite (skit 60s, startPosition alto): el guard anti-teaser bloquea', () => {
    const duration = 60;
    const startPosition = 50; // playable = 10
    const window = computeScrobbleWindow({ duration, startPosition });
    expect(window.playable).toBe(10);
    expect(window.threshold).toBe(5); // el umbral crudo sería ridículamente bajo...
    expect(window.guardMinimum).toBe(30);
    expect(window.passesGuard).toBe(false); // ...pero el guard lo veta

    const fake = makeFakeClock();
    const clock = new ActiveListenClock(fake.now);
    clock.reset();
    fake.advance(10); // escucha el playable ENTERO (10 de 10s posibles)

    expect(
      shouldScrobble({ duration, startPosition, activeElapsedSec: clock.elapsedSeconds() })
    ).toBe(false);

    // Contraste: el mismo skit con un recorte menos agresivo (playable=30,
    // justo en el borde del guard) SÍ puede scrobblear — el guard no es
    // "los temas cortos nunca cuentan", es "no cualifiques con recortes
    // extremos".
    const startPositionBorderline = 30; // playable = 30 = guardMinimum
    const borderlineWindow = computeScrobbleWindow({
      duration,
      startPosition: startPositionBorderline
    });
    expect(borderlineWindow.passesGuard).toBe(true);
  });

  // --------------------------------------------------------------------
  // Caso 6 — no-regresión: `startPosition = 0` debe dar SIEMPRE el mismo
  // resultado que la fórmula actual (`elapsed >= min(duration*0.5, 240)`),
  // para cualquier duración. `duration` es un caso particular de
  // `playable` (el caso en que el mix no recorta nada) — colapsa bit a
  // bit, no por casualidad.
  // --------------------------------------------------------------------
  it('startPosition=0 → idéntico a la fórmula actual, para cualquier duración', () => {
    const durations = [10, 30, 45, 60, 90, 200, 480, 600];
    for (const duration of durations) {
      const legacyThreshold = Math.min(duration * 0.5, 240);
      const window = computeScrobbleWindow({ duration, startPosition: 0 });

      expect(window.playable).toBe(duration);
      expect(window.threshold).toBe(legacyThreshold);
      expect(window.passesGuard).toBe(true); // tautológico en modo normal

      // Justo por debajo del umbral: no scrobblea, en ambas fórmulas.
      expect(
        shouldScrobble({
          duration,
          startPosition: 0,
          activeElapsedSec: legacyThreshold - 0.01
        })
      ).toBe(false);
      // Justo en el umbral: scrobblea, en ambas fórmulas.
      expect(
        shouldScrobble({ duration, startPosition: 0, activeElapsedSec: legacyThreshold })
      ).toBe(true);
    }
  });
});

describe('ActiveListenClock — comportamiento standalone', () => {
  it('pause()/resume() son idempotentes', () => {
    const fake = makeFakeClock();
    const clock = new ActiveListenClock(fake.now);
    clock.reset();
    fake.advance(10);
    clock.pause();
    clock.pause(); // segunda pausa seguida — no debe restar de más
    fake.advance(50); // en pausa, no cuenta
    clock.resume();
    clock.resume(); // segundo resume seguido — no debe reiniciar el contador
    fake.advance(5);
    expect(clock.elapsedSeconds()).toBe(15);
  });

  it('reset() reinicia el acumulado a 0 (canción nueva)', () => {
    const fake = makeFakeClock();
    const clock = new ActiveListenClock(fake.now);
    clock.reset();
    fake.advance(30);
    clock.reset();
    expect(clock.elapsedSeconds()).toBe(0);
  });
});
