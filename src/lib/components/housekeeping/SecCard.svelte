<script lang="ts">
  /**
   * SecCard — chasis "sala de control" del Resumen de Housekeeping.
   *
   * Lenguaje propio del panel (NO el card-poster de DiagnosticsKPI): superficie
   * sólida oscura-fría + accent rail de 3px a la izquierda que codifica ESTADO
   * (calm/watch/alert/good) + cuerpo específico por arquetipo (vía snippet) +
   * un "peek" opcional de dato secundario que se revela en hover/focus sin
   * provocar reflow.
   *
   * Solo el chasis es común; cada card del Resumen mete su propio cuerpo
   * (barra de balance, lista ranked, trío de tiles). Consume solo tokens --sec-*.
   */
  import type { Component, Snippet } from 'svelte';
  import type { IconWeight } from 'phosphor-svelte';

  type Props = {
    /** Estado real del dato → color del rail. */
    state: 'calm' | 'watch' | 'alert' | 'good';
    Icon: Component<{ size?: number | string; weight?: IconWeight }>;
    kicker: string;
    children: Snippet;
    /** Dato secundario revelado en hover/focus (progressive disclosure). */
    peek?: Snippet;
  };

  let { state, Icon, kicker, children, peek }: Props = $props();
</script>

<article class="sec-card" data-state={state}>
  <span class="sec-rail" aria-hidden="true"></span>
  <div class="sec-inner">
    <header class="sec-head">
      <span class="sec-icon" aria-hidden="true"><Icon size={15} weight="fill" /></span>
      <span class="sec-kicker">{kicker}</span>
    </header>

    <div class="sec-body">
      {@render children()}
    </div>

    {#if peek}
      <div class="sec-peek">{@render peek()}</div>
    {/if}
  </div>
</article>

<style>
  .sec-card {
    position: relative;
    display: flex;
    min-height: 156px;
    overflow: hidden;
    background: var(--sec-surface);
    border: 1px solid var(--sec-border);
    border-radius: var(--hk-card-radius);
    box-shadow: var(--shadow-sm);
    transition: border-color 240ms var(--ease-ios-default);
  }
  .sec-card:hover,
  .sec-card:focus-within {
    border-color: var(--sec-border-strong);
  }

  /* Accent rail — codifica el estado del dato de esta card. */
  .sec-rail {
    position: absolute;
    left: 0;
    inset-block: 0;
    width: 3px;
  }
  .sec-card[data-state='calm']  .sec-rail { background: var(--sec-calm); }
  .sec-card[data-state='watch'] .sec-rail { background: var(--sec-watch); }
  .sec-card[data-state='alert'] .sec-rail { background: var(--sec-alert); }
  .sec-card[data-state='good']  .sec-rail { background: var(--sec-good); }

  .sec-inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5) var(--space-4) calc(var(--space-5) + 3px);
    width: 100%;
    min-width: 0;
    color: var(--sec-fg);
  }

  .sec-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sec-icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: var(--sec-surface-raised);
    color: var(--sec-fg-secondary);
    flex-shrink: 0;
  }
  .sec-kicker {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--sec-fg-secondary);
  }

  .sec-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  /* ─── Peek: reveal reflow-free. El alto del peek ya cuenta en el layout;
     solo cambia opacity + un translateY sutil (transform no provoca reflow). */
  .sec-peek {
    margin-top: auto;
    opacity: 0;
    transform: translateY(-3px);
    transition:
      opacity 260ms var(--ease-ios-default),
      transform 260ms var(--ease-ios-default);
  }
  .sec-card:hover .sec-peek,
  .sec-card:focus-within .sec-peek {
    opacity: 1;
    transform: translateY(0);
  }
  /* Táctil (sin hover) y reduced-motion: el peek se muestra siempre, estático. */
  @media (hover: none) {
    .sec-peek { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .sec-peek { transition: none; opacity: 1; transform: none; }
  }
</style>
