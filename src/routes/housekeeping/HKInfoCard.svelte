<script lang="ts">
  /**
   * HKInfoCard — variante "informativa" de HKActionCard.
   *
   * Misma estética (glass + pattern decorativo + tone accent) pero sin
   * botón ni métrica obligatoria. El cuerpo del card es un slot
   * (`children`) — el caller decide qué mete: lista, grid de avatares,
   * sparkline, etc.
   *
   * Patrones y tonos: idénticos a HKActionCard (mesh / waves / lines,
   * accent / pink / mint / amber).
   */
  import type { Snippet, Component } from 'svelte';
  import type { IconWeight } from 'phosphor-svelte';

  type Pattern = 'mesh' | 'waves' | 'lines';
  type Tone = 'accent' | 'pink' | 'mint' | 'amber';

  type Props = {
    Icon: Component<{ size?: number | string; weight?: IconWeight }>;
    kicker?: string | undefined;
    title: string;
    description?: string | undefined;
    pattern: Pattern;
    tone?: Tone;
    children: Snippet;
  };

  let {
    Icon,
    kicker,
    title,
    description,
    pattern,
    tone = 'accent',
    children
  }: Props = $props();
</script>

<article class="hk-info-card" data-pattern={pattern} data-tone={tone}>
  <header>
    <span class="hk-info-icon" aria-hidden="true">
      <Icon size={18} weight="regular" />
    </span>
    <div class="hk-info-meta">
      {#if kicker}
        <span class="hk-info-kicker">{kicker}</span>
      {/if}
      <h3 class="hk-info-title">{title}</h3>
      {#if description}
        <p class="hk-info-desc">{description}</p>
      {/if}
    </div>
  </header>

  <div class="hk-info-body">
    {@render children()}
  </div>
</article>

<style>
  /* Hereda el mismo lenguaje visual que HKActionCard pero sin footer. */
  .hk-info-card {
    --card-accent: var(--accent);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--card-accent) 14%, var(--bg-glass-solid)) 0%,
        var(--bg-glass-solid) 70%
      );
    backdrop-filter: var(--hk-card-blur);
    -webkit-backdrop-filter: var(--hk-card-blur);
    border-radius: 18px;
    overflow: hidden;
    isolation: isolate;
    transition: transform 240ms var(--hk-spring-soft);
  }
  .hk-info-card:hover {
    transform: translateY(-1px);
  }

  .hk-info-card[data-tone='pink']  { --card-accent: oklch(0.7 0.18 12);  }
  .hk-info-card[data-tone='mint']  { --card-accent: oklch(0.72 0.16 165); }
  .hk-info-card[data-tone='amber'] { --card-accent: oklch(0.78 0.15 75);  }

  /* Pattern decorativo en esquina top-right (mismo helper que HKActionCard). */
  .hk-info-card::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    opacity: 0.55;
    -webkit-mask-image: radial-gradient(
      ellipse 80% 70% at 100% 0%,
      black 0%,
      transparent 70%
    );
    mask-image: radial-gradient(
      ellipse 80% 70% at 100% 0%,
      black 0%,
      transparent 70%
    );
  }
  .hk-info-card[data-pattern='mesh']::before {
    background-image: radial-gradient(
      circle,
      color-mix(in srgb, var(--card-accent) 50%, transparent) 1.2px,
      transparent 1.8px
    );
    background-size: 14px 14px;
  }
  .hk-info-card[data-pattern='waves']::before {
    background:
      radial-gradient(circle at 80% 20%, color-mix(in srgb, var(--card-accent) 38%, transparent) 0%, transparent 28%),
      radial-gradient(circle at 60% 40%, color-mix(in srgb, var(--card-accent) 24%, transparent) 0%, transparent 22%),
      radial-gradient(circle at 90% 50%, color-mix(in srgb, var(--card-accent) 28%, transparent) 0%, transparent 25%);
    background-size: 100% 100%;
  }
  .hk-info-card[data-pattern='lines']::before {
    background-image: repeating-linear-gradient(
      -45deg,
      transparent 0,
      transparent 7px,
      color-mix(in srgb, var(--card-accent) 32%, transparent) 7px,
      color-mix(in srgb, var(--card-accent) 32%, transparent) 8px
    );
  }

  .hk-info-card > * { position: relative; z-index: 1; }

  .hk-info-card header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .hk-info-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    background: color-mix(in srgb, var(--card-accent) 18%, transparent);
    color: var(--card-accent);
    flex-shrink: 0;
  }
  .hk-info-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }
  .hk-info-kicker {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--card-accent);
  }
  .hk-info-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .hk-info-desc {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: 1.55;
  }

  .hk-info-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>
