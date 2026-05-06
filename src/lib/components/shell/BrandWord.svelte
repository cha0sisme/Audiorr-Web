<script lang="ts">
  /**
   * BrandWord — animación tipo "gradual spacing" (Magic UI / sv-animations)
   * para el branding del sidebar.
   *
   * Filosofía: NO determinístico. Es un detalle de delight, no un feature
   * predecible. Que el usuario lo note de vez en cuando, no siempre.
   *
   * Comportamiento:
   *   - Tras mount: primer ciclo entra con delay aleatorio 2-45s. Si
   *     refrescas y solo pasas 10s en la página, ~80% de probabilidades
   *     de NO verlo aparecer.
   *   - Cada palabra: enter (per-char stagger) → hold 2.8-4.5s aleatorio
   *     → exit.
   *   - Pausa aleatoria 15-120s con SOLO el icono visible.
   *   - Cada palabra elegida random del pool (incluida Audiorr) — sin
   *     "primera aparición fija".
   *
   * Per-char animation imita el patrón gradual-spacing de Magic UI:
   *   opacity 0 + translateX(-0.5em) + blur(4px) → estado normal.
   *   Stagger 50ms entre chars en enter, 30ms en exit (sale más rápido).
   *
   * Respeta prefers-reduced-motion: si está activo, las palabras aparecen
   * sin animación, solo opacity sin per-char delay (instant fade).
   */
  import { onMount } from 'svelte';

  /** Pool de palabras Audio-themed. Cada aparición elige una random sin
      repetir consecutivamente. */
  const WORDS = [
    'Audiorr',
    'Audiophile',
    'Audiosphere',
    'Audiograph',
    'Audiology',
    'Audiogenic'
  ] as const;

  const ENTER_PER_CHAR_MS = 50;   // stagger entre chars al entrar
  const ENTER_DURATION_MS = 400;  // duración de la animación de cada char
  const EXIT_PER_CHAR_MS = 30;    // stagger más rápido al salir
  const EXIT_DURATION_MS = 300;

  // Rangos amplios — feel orgánico, NO patrón fijo. No persistimos en
  // localStorage: el browser refresh re-rolla todos los timers, pero como
  // el primer delay es 2-45s aleatorio el usuario percibe "a veces sí, a
  // veces no" — exactamente lo deseado.
  const HOLD_MIN_MS = 2_800;
  const HOLD_MAX_MS = 4_500;
  const FIRST_DELAY_MIN_MS = 2_000;
  const FIRST_DELAY_MAX_MS = 45_000;
  const PAUSE_MIN_MS = 15_000;
  const PAUSE_MAX_MS = 120_000;

  let visible = $state(false);
  let phase = $state<'idle' | 'entering' | 'exiting'>('idle');
  let currentWord = $state<string>('');

  let timer: ReturnType<typeof setTimeout> | undefined;

  function rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  function pickWord(): string {
    // Excluir la palabra actual para que no repita inmediatamente.
    const pool = WORDS.filter((w) => w !== currentWord);
    return pool[Math.floor(Math.random() * pool.length)] ?? WORDS[0];
  }

  function exitDuration(word: string): number {
    return EXIT_DURATION_MS + (word.length - 1) * EXIT_PER_CHAR_MS;
  }
  function enterDuration(word: string): number {
    return ENTER_DURATION_MS + (word.length - 1) * ENTER_PER_CHAR_MS;
  }

  function startCycle() {
    currentWord = pickWord();
    visible = true;
    phase = 'entering';

    timer = setTimeout(() => {
      phase = 'idle'; // fully visible — keyframes completaron, char queda al final
      const hold = rand(HOLD_MIN_MS, HOLD_MAX_MS);
      timer = setTimeout(() => {
        phase = 'exiting';
        timer = setTimeout(() => {
          visible = false;
          phase = 'idle';
          const pause = rand(PAUSE_MIN_MS, PAUSE_MAX_MS);
          timer = setTimeout(startCycle, pause);
        }, exitDuration(currentWord));
      }, hold);
    }, enterDuration(currentWord));
  }

  onMount(() => {
    // Primer delay random — clave para que el refresh NO siempre dispare
    // la animación. Distribución uniforme sobre 2-45s.
    timer = setTimeout(startCycle, rand(FIRST_DELAY_MIN_MS, FIRST_DELAY_MAX_MS));
    return () => {
      if (timer) clearTimeout(timer);
    };
  });

  const chars = $derived(currentWord.split(''));
</script>

{#if visible}
  <span
    class="brand-word"
    class:entering={phase === 'entering'}
    class:exiting={phase === 'exiting'}
    aria-hidden="true"
  >
    {#each chars as char, i (i)}
      <span class="char" style:--i={i}>{char}</span>
    {/each}
  </span>
{/if}

<style>
  .brand-word {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-sans);
    font-size: 22px;
    font-weight: 600;
    line-height: 1;
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
    /* white-space: nowrap impide wrap si la palabra es larga. La sidebar
       tiene espacio sobrado pero defendemos. */
    white-space: nowrap;
    user-select: none;
    pointer-events: none;
  }

  .char {
    display: inline-block;
    /* Estado inicial — invisible, ligeramente desplazado, blureado. Las
       keyframes de entering/exiting llevan a / desde este estado. */
    opacity: 0;
    transform: translateX(-0.5em);
    filter: blur(4px);
    /* will-change opt-in solo durante animación. Browser lo limpia tras
       animation-fill-mode: forwards. */
    will-change: opacity, transform, filter;
  }

  .brand-word.entering .char {
    animation: gradual-in var(--enter-dur, 400ms) var(--ease-ios-default) both;
    animation-delay: calc(var(--i) * 50ms);
  }

  .brand-word.exiting .char {
    animation: gradual-out var(--exit-dur, 300ms) var(--ease-ios-default) both;
    animation-delay: calc(var(--i) * 30ms);
  }

  /* Cuando ya entró completamente (phase=idle && visible), las chars deben
     quedar en el estado FINAL del enter. Sin esta regla, al salir de la
     fase 'entering' las chars volverían al estado inicial (invisibles). */
  .brand-word:not(.entering):not(.exiting) .char {
    opacity: 1;
    transform: translateX(0);
    filter: blur(0);
  }

  @keyframes gradual-in {
    from {
      opacity: 0;
      transform: translateX(-0.5em);
      filter: blur(4px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
      filter: blur(0);
    }
  }

  @keyframes gradual-out {
    from {
      opacity: 1;
      transform: translateX(0);
      filter: blur(0);
    }
    to {
      opacity: 0;
      transform: translateX(0.4em);
      filter: blur(4px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .brand-word.entering .char,
    .brand-word.exiting .char {
      animation: none;
      transition: opacity var(--duration-fast) ease;
    }
    .brand-word.entering .char {
      opacity: 1;
      transform: none;
      filter: none;
    }
    .brand-word.exiting .char {
      opacity: 0;
    }
  }
</style>
