<script lang="ts">
  /**
   * HKActionCard — card "rica" estilo Apple Music para Dashboard/Playlists.
   *
   * Cada card tiene:
   *   - bg accent-tinted (gradient + pattern decorativo en una esquina).
   *   - pattern via ::before con mask radial — solo se ve en una esquina.
   *   - cabecera con icono + kicker + título + sub.
   *   - métrica grande mono (opcional).
   *   - status pill (opcional).
   *   - botón primary del DS (sin movimiento ocioso en idle).
   *
   * Patrones soportados (`pattern` prop):
   *   - 'mesh'   → grid de dots dispersos (ideal para "regenerar").
   *   - 'waves'  → ondas radiales (ideal para "música/mix").
   *   - 'lines'  → líneas diagonales (ideal para "lógica/algoritmo").
   *
   * Tone — color del accent del card, theme-aware via OKLCH:
   *   - 'accent'   → var(--accent), default.
   *   - 'pink'     → tono cálido para cards humanas/cariñosas.
   *   - 'mint'     → fresco para cards de creación/automation.
   *   - 'amber'    → atención sutil sin ser warning.
   *
   * El componente NO maneja network — solo dispara `onAction()` y refleja
   * `isRunning`. La página dueña gestiona el estado real.
   */
  import type { Component } from 'svelte';
  import type { IconWeight } from 'phosphor-svelte';
  import { ArrowsClockwise, Check } from 'phosphor-svelte';

  type Pattern = 'mesh' | 'waves' | 'lines';
  type Tone = 'accent' | 'pink' | 'mint' | 'amber';

  type Props = {
    Icon: Component<{ size?: number | string; weight?: IconWeight }>;
    kicker?: string | undefined;
    title: string;
    description: string;
    /** Métrica destacada en mono-font (ej: "1.842" canciones, "87%"). */
    metric?: string | undefined;
    metricLabel?: string | undefined;
    /** Texto del estado contextual (ej: "Cron diario · 3:00 AM"). */
    statusText?: string | undefined;
    statusTone?: 'idle' | 'running' | 'success' | 'error' | undefined;
    pattern: Pattern;
    tone?: Tone;
    /** Texto del botón en estado idle. */
    actionLabel: string;
    /** Texto del botón mientras corre la acción. */
    runningLabel?: string | undefined;
    /** Texto efímero tras éxito (1.8s). */
    successLabel?: string | undefined;
    isRunning?: boolean | undefined;
    isJustSaved?: boolean | undefined;
    cooldownSec?: number | undefined;
    onAction: () => void;
  };

  let {
    Icon,
    kicker,
    title,
    description,
    metric,
    metricLabel,
    statusText,
    statusTone = 'idle',
    pattern,
    tone = 'accent',
    actionLabel,
    runningLabel = 'Procesando…',
    successLabel = 'Listo',
    isRunning = false,
    isJustSaved = false,
    cooldownSec = 0,
    onAction
  }: Props = $props();

  const disabled = $derived(isRunning || cooldownSec > 0 || isJustSaved);
</script>

<article class="hk-action-card" data-pattern={pattern} data-tone={tone}>
  <!-- Cabecera: icono cuadrado con tinted bg + meta de la card. -->
  <header>
    <span class="hk-action-icon" aria-hidden="true">
      <Icon size={18} weight="regular" />
    </span>
    <div class="hk-action-meta">
      {#if kicker}
        <span class="hk-action-kicker">{kicker}</span>
      {/if}
      <h3 class="hk-action-title">{title}</h3>
      <p class="hk-action-desc">{description}</p>
    </div>
  </header>

  <!-- Métrica grande (opcional). -->
  {#if metric}
    <div class="hk-action-metric">
      <span class="hk-action-metric-value">{metric}</span>
      {#if metricLabel}
        <span class="hk-action-metric-label">{metricLabel}</span>
      {/if}
    </div>
  {/if}

  <!-- Footer: status pill + botón. -->
  <footer>
    {#if statusText}
      <span class="hk-action-status" data-tone={statusTone}>
        <span class="hk-action-dot" aria-hidden="true"></span>
        {statusText}
      </span>
    {:else}
      <span></span>
    {/if}

    <button
      type="button"
      class="hk-action-btn"
      class:saved={isJustSaved}
      {disabled}
      onclick={onAction}
    >
      {#if isJustSaved}
        <Check size={13} weight="bold" /> {successLabel}
      {:else if isRunning}
        <ArrowsClockwise size={13} weight="bold" class="spin" />
        {runningLabel}
      {:else if cooldownSec > 0}
        Espera {cooldownSec}s
      {:else}
        {actionLabel}
      {/if}
    </button>
  </footer>
</article>

<style>
  /* ============================================================================
     === Action Card base ===
     ============================================================================
     Layout: stack vertical icon→title→metric→footer. Bg con gradient
     accent-tinted + ::before con pattern mask radial. Sin shadows, sin
     borders gruesos — todo el "wow" viene de los patterns + métricas
     tipográficas grandes en mono. */

  .hk-action-card {
    /* Cada tone se traduce a un OKLCH específico. Theme-agnostic
       (oklch resuelve igual en dark/light). */
    --card-accent: var(--accent);
    --card-accent-l-bg: 0.5;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    min-height: 220px;
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
  .hk-action-card:hover {
    transform: translateY(-1px);
  }

  /* Tone overrides — solo cambian --card-accent, el resto se recalcula. */
  .hk-action-card[data-tone='pink']  { --card-accent: oklch(0.7 0.18 12);  }
  .hk-action-card[data-tone='mint']  { --card-accent: oklch(0.72 0.16 165); }
  .hk-action-card[data-tone='amber'] { --card-accent: oklch(0.78 0.15 75);  }

  /* ============================================================================
     === Patterns decorativos (::before, mask radial en esquina) ===
     ============================================================================
     `pointer-events: none` para que no bloqueen el contenido. `mask-image`
     limita la visibilidad a la esquina top-right (la única "rica" — el
     resto del card es legible y limpio). */

  .hk-action-card::before {
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
  .hk-action-card[data-pattern='mesh']::before {
    background-image: radial-gradient(
      circle,
      color-mix(in srgb, var(--card-accent) 50%, transparent) 1.2px,
      transparent 1.8px
    );
    background-size: 14px 14px;
  }
  .hk-action-card[data-pattern='waves']::before {
    background:
      radial-gradient(circle at 80% 20%, color-mix(in srgb, var(--card-accent) 38%, transparent) 0%, transparent 28%),
      radial-gradient(circle at 60% 40%, color-mix(in srgb, var(--card-accent) 24%, transparent) 0%, transparent 22%),
      radial-gradient(circle at 90% 50%, color-mix(in srgb, var(--card-accent) 28%, transparent) 0%, transparent 25%);
    background-size: 100% 100%;
  }
  .hk-action-card[data-pattern='lines']::before {
    background-image: repeating-linear-gradient(
      -45deg,
      transparent 0,
      transparent 7px,
      color-mix(in srgb, var(--card-accent) 32%, transparent) 7px,
      color-mix(in srgb, var(--card-accent) 32%, transparent) 8px
    );
  }

  /* Asegurar que todo el contenido va por encima del pattern. */
  .hk-action-card > * {
    position: relative;
    z-index: 1;
  }

  /* ============================================================================
     === Header del card (icon + meta) ===
     ============================================================================ */
  .hk-action-card header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .hk-action-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    background: color-mix(in srgb, var(--card-accent) 18%, transparent);
    color: var(--card-accent);
    flex-shrink: 0;
  }
  .hk-action-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .hk-action-kicker {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--card-accent);
  }
  .hk-action-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .hk-action-desc {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: 1.55;
    max-width: 50ch;
  }

  /* ============================================================================
     === Métrica grande en mono ===
     ============================================================================ */
  .hk-action-metric {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: auto;
  }
  .hk-action-metric-value {
    font-family: 'Söhne Mono', var(--font-mono);
    font-size: 36px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .hk-action-metric-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  /* ============================================================================
     === Footer (status + botón) ===
     ============================================================================ */
  .hk-action-card footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: auto;
    flex-wrap: wrap;
  }

  .hk-action-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--bg-canvas);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
  }
  .hk-action-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--text-tertiary);
  }
  .hk-action-status[data-tone='running'] .hk-action-dot {
    background: var(--card-accent);
    animation: hk-dot-pulse 1.4s ease-in-out infinite;
  }
  .hk-action-status[data-tone='success'] .hk-action-dot {
    background: oklch(0.72 0.18 145);
  }
  .hk-action-status[data-tone='error'] .hk-action-dot {
    background: var(--status-danger);
  }
  @keyframes hk-dot-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%      { transform: scale(1.6); opacity: 0.5; }
  }

  /* Botón embebido en la card — bg accent del card, no global. */
  .hk-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--card-accent);
    border: 0;
    border-radius: 999px;
    color: #fff;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.005em;
    cursor: pointer;
    transition:
      transform 200ms var(--hk-spring),
      filter 200ms var(--hk-spring-soft);
  }
  .hk-action-btn:hover:not(:disabled) { filter: brightness(1.08); }
  .hk-action-btn:active:not(:disabled) { transform: scale(0.96); }
  .hk-action-btn:disabled { opacity: 0.42; cursor: not-allowed; }
  .hk-action-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .hk-action-btn.saved {
    background: oklch(0.72 0.18 145);
  }

  /* Spin del icono refresh durante operación. */
  :global(.hk-action-btn .spin) {
    animation: hk-spin 1s linear infinite;
  }
  @keyframes hk-spin { to { transform: rotate(360deg); } }

  /* El único movimiento que queda (pulso del dot en running, spin del
     refresh) es feedback de acción real — aun así lo desactivamos si el
     usuario pide reduced-motion. */
  @media (prefers-reduced-motion: reduce) {
    .hk-action-status[data-tone='running'] .hk-action-dot { animation: none; }
    :global(.hk-action-btn .spin) { animation: none; }
  }
</style>
