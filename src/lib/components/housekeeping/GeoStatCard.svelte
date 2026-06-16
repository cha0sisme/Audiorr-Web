<script lang="ts">
  /**
   * GeoStatCard — card de métrica con fondo geométrico generativo 2026.
   *
   * Inspirada en las cover variants del backend (aurora / prism / ripple): un
   * "mundo" de color por card con texto claro encima. El fondo es estático
   * (color y geometría, sin movimiento ocioso); el contenido lo decide el
   * caller vía snippet (un número grande, una mini-lista, lo que toque).
   *
   * Solo consume tokens semánticos --geo-* (paleta definida en semantic.css).
   */
  import type { Component, Snippet } from 'svelte';
  import type { IconWeight } from 'phosphor-svelte';

  type Props = {
    variant: 'aurora' | 'prism' | 'ripple';
    Icon: Component<{ size?: number | string; weight?: IconWeight }>;
    kicker: string;
    children: Snippet;
  };

  let { variant, Icon, kicker, children }: Props = $props();
</script>

<article class="geo-card" data-variant={variant}>
  <div class="geo-bg" aria-hidden="true"></div>
  <div class="geo-scrim" aria-hidden="true"></div>
  <div class="geo-content">
    <header class="geo-head">
      <span class="geo-icon"><Icon size={16} weight="fill" /></span>
      <span class="geo-kicker">{kicker}</span>
    </header>
    <div class="geo-body">
      {@render children()}
    </div>
  </div>
</article>

<style>
  .geo-card {
    position: relative;
    overflow: hidden;
    border-radius: var(--hk-card-radius);
    min-height: 148px;
    display: flex;
    isolation: isolate;
    /* Sombra suave de elevación coherente con un tile flotante. */
    box-shadow: var(--shadow-sm);
  }

  /* ─── Fondos geométricos (estáticos) ─────────────────────────────────── */
  .geo-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
  }
  /* aurora — radiales suaves superpuestos sobre base oscura: boreal. */
  .geo-card[data-variant='aurora'] .geo-bg {
    background:
      radial-gradient(120% 95% at 0% 0%, color-mix(in oklch, var(--geo-blue) 80%, transparent), transparent 58%),
      radial-gradient(115% 100% at 100% 12%, color-mix(in oklch, var(--geo-violet) 72%, transparent), transparent 55%),
      radial-gradient(130% 120% at 55% 110%, color-mix(in oklch, var(--geo-cyan) 60%, transparent), transparent 60%),
      var(--geo-ink);
  }
  /* prism — conic facetado tipo cristal. */
  .geo-card[data-variant='prism'] .geo-bg {
    background:
      conic-gradient(
        from 210deg at 78% 22%,
        color-mix(in oklch, var(--geo-magenta) 90%, var(--geo-ink)),
        color-mix(in oklch, var(--geo-blue) 90%, var(--geo-ink)),
        color-mix(in oklch, var(--geo-amber) 80%, var(--geo-ink)),
        color-mix(in oklch, var(--geo-magenta) 90%, var(--geo-ink))
      );
  }
  /* ripple — ondas concéntricas sobre degradado azul→ink. */
  .geo-card[data-variant='ripple'] .geo-bg {
    background:
      repeating-radial-gradient(
        circle at 82% 118%,
        color-mix(in oklch, var(--geo-fg) 22%, transparent) 0,
        color-mix(in oklch, var(--geo-fg) 22%, transparent) 1.5px,
        transparent 1.5px,
        transparent 17px
      ),
      radial-gradient(105% 105% at 82% 118%, var(--geo-teal), var(--geo-blue) 55%, var(--geo-ink));
  }

  /* Scrim de legibilidad: oscurece sutil hacia abajo-izquierda (zona del
     número/label) para que el texto claro siempre lea, sin matar el color. */
  .geo-scrim {
    position: absolute;
    inset: 0;
    z-index: 1;
    background: linear-gradient(
      155deg,
      transparent 0%,
      transparent 42%,
      color-mix(in oklch, var(--geo-ink) 55%, transparent) 100%
    );
  }

  .geo-content {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    width: 100%;
    color: var(--geo-fg);
  }

  .geo-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .geo-icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    background: color-mix(in oklch, var(--geo-fg) 18%, transparent);
    color: var(--geo-fg);
    flex-shrink: 0;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  .geo-kicker {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--geo-fg-secondary);
  }

  .geo-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: auto;
    min-width: 0;
  }
</style>
