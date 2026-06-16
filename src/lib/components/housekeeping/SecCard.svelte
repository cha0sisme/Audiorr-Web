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
  import { CaretRight, type IconWeight } from 'phosphor-svelte';

  type Props = {
    /** Estado real del dato → color del rail. */
    state: 'calm' | 'watch' | 'alert' | 'good';
    Icon: Component<{ size?: number | string; weight?: IconWeight }>;
    kicker: string;
    children: Snippet;
    /** Dato secundario revelado en hover/focus (progressive disclosure). */
    peek?: Snippet;
    /** Arquetipo → rota el origen del fade del dot grid (sub-perceptible). */
    arch?: 'balance' | 'ranked' | 'tiles';
    /** Si está presente, la card es ampliable (abre un drawer de detalle). */
    onExpand?: () => void;
    /** aria-label del trigger cuando es ampliable (ej. "Ampliar accesos 7d"). */
    expandLabel?: string;
    /** Control en la cabecera (ej. RangeSelect). Si está presente, la card NO
        es un <button> entero (un control dentro de un botón sería inválido):
        el caret se vuelve el disparador del drawer. */
    headerAction?: Snippet;
  };

  let {
    state,
    Icon,
    kicker,
    children,
    peek,
    arch = 'balance',
    onExpand,
    expandLabel,
    headerAction
  }: Props = $props();

  // La card entera es <button> solo si amplía Y no tiene control interno.
  const wholeCardButton = $derived(!!onExpand && !headerAction);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:element
  this={wholeCardButton ? 'button' : 'article'}
  class="sec-card"
  data-state={state}
  data-arch={arch}
  data-expandable={wholeCardButton ? 'true' : undefined}
  type={wholeCardButton ? 'button' : undefined}
  aria-haspopup={wholeCardButton ? 'dialog' : undefined}
  aria-label={wholeCardButton ? expandLabel : undefined}
  onclick={wholeCardButton ? onExpand : undefined}
>
  {#if wholeCardButton}
    <span class="sec-expand-caret" aria-hidden="true"><CaretRight size={12} weight="bold" /></span>
  {/if}
  <div class="sec-inner">
    <header class="sec-head">
      <span class="sec-icon" aria-hidden="true"><Icon size={15} weight="fill" /></span>
      <span class="sec-kicker">{kicker}</span>
      {#if headerAction}<span class="sec-head-action">{@render headerAction()}</span>{/if}
      {#if onExpand && !wholeCardButton}
        <button
          type="button"
          class="sec-caret-btn"
          class:no-action={!headerAction}
          aria-haspopup="dialog"
          aria-label={expandLabel}
          onclick={onExpand}
        ><CaretRight size={12} weight="bold" /></button>
      {/if}
    </header>

    <div class="sec-body">
      {@render children()}
    </div>

    {#if peek}
      <div class="sec-peek">{@render peek()}</div>
    {/if}
  </div>
</svelte:element>

<style>
  .sec-card {
    position: relative;
    display: flex;
    min-height: 156px;
    overflow: hidden;
    /* edge-light superior (luz física) sobre la superficie sólida. */
    background:
      linear-gradient(180deg, var(--sec-edge-light) 0%, transparent 40%),
      var(--sec-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--hk-card-radius);
    box-shadow: var(--shadow-sm);
    transition: border-color 240ms var(--ease-ios-default);
  }
  .sec-card:hover,
  .sec-card:focus-within {
    border-color: var(--border-strong);
  }

  /* ── Card ampliable (es <button>): reset de UA + affordance de lift ───── */
  .sec-card[data-expandable] {
    width: 100%;
    margin: 0;
    padding: 0;
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    transition:
      border-color 240ms var(--ease-ios-default),
      transform 200ms var(--ease-ios-default);
  }
  .sec-card[data-expandable]:hover { transform: translateY(-1px); }
  .sec-card[data-expandable]:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .sec-expand-caret {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2;
    display: grid;
    place-items: center;
    color: var(--sec-fg-secondary);
    opacity: 0.55;
    transition: opacity 200ms var(--ease-ios-default), color 200ms var(--ease-ios-default);
  }
  .sec-card[data-expandable]:hover .sec-expand-caret,
  .sec-card[data-expandable]:focus-visible .sec-expand-caret {
    opacity: 1;
    color: var(--sec-fg);
  }
  /* Caret-botón inline (modo article con control en cabecera): el disparador
     del drawer cuando la card no es un <button> entero. */
  .sec-caret-btn {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--sec-surface-raised);
    color: var(--sec-fg-secondary);
    cursor: pointer;
    opacity: 0.7;
    transition:
      opacity 200ms var(--ease-ios-default),
      color 200ms var(--ease-ios-default),
      background 200ms var(--ease-ios-default);
  }
  .sec-caret-btn.no-action { margin-left: auto; }
  .sec-card:hover .sec-caret-btn { opacity: 1; }
  .sec-caret-btn:hover { color: var(--sec-fg); background: var(--sec-surface); }
  .sec-caret-btn:focus-visible { outline: none; opacity: 1; box-shadow: var(--focus-ring); }

  /* Slot de control en la cabecera (RangeSelect, etc.): empujado a la derecha. */
  .sec-head-action { margin-left: auto; display: inline-flex; align-items: center; }
  @media (prefers-reduced-motion: reduce) {
    .sec-card[data-expandable] { transition: none; }
    .sec-card[data-expandable]:hover { transform: none; }
  }

  /* ── Capa MATERIA: grano feTurbulence (data-URI estático, cero red) que da
     tactilidad. mix-blend overlay para modular la luz, no pintar gris. ──── */
  .sec-card::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    mix-blend-mode: overlay;
    opacity: var(--sec-grain-opacity);
  }
  /* ── Capa GEOMETRÍA: dot grid neutro con fade radial que lo apaga bajo los
     datos (premium = donde hay dato no hay textura). Origen del fade rota por
     arquetipo: sub-perceptible, evita que las 3 cards sean fotocopia. ────── */
  .sec-card::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background-image: radial-gradient(circle, var(--sec-dot) 1px, transparent 1.2px);
    background-size: var(--sec-dot-size) var(--sec-dot-size);
    -webkit-mask-image: radial-gradient(140% 120% at 0% 0%, #000 0%, rgb(0 0 0 / 0.35) 45%, transparent 80%);
    mask-image: radial-gradient(140% 120% at 0% 0%, #000 0%, rgb(0 0 0 / 0.35) 45%, transparent 80%);
  }
  .sec-card[data-arch='ranked']::after {
    -webkit-mask-image: radial-gradient(140% 120% at 100% 0%, #000 0%, rgb(0 0 0 / 0.35) 45%, transparent 80%);
    mask-image: radial-gradient(140% 120% at 100% 0%, #000 0%, rgb(0 0 0 / 0.35) 45%, transparent 80%);
  }
  .sec-card[data-arch='tiles']::after {
    -webkit-mask-image: radial-gradient(150% 120% at 50% 0%, #000 0%, rgb(0 0 0 / 0.35) 48%, transparent 82%);
    mask-image: radial-gradient(150% 120% at 50% 0%, #000 0%, rgb(0 0 0 / 0.35) 48%, transparent 82%);
  }
  /* En alto contraste / forced-colors la textura es ruido: se apaga. */
  @media (forced-colors: active) {
    .sec-card::before,
    .sec-card::after { display: none; }
  }

  .sec-inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
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
