<script lang="ts">
  /**
   * SessionRow — una sesión activa, estilo "Tus dispositivos". Compartida por
   * Personas (Housekeeping) y Ajustes (panel propio). Diseño 2026 (spec
   * design-lead): superficie blanda sin bordes, país por NOMBRE (los emojis de
   * bandera no renderizan en Chromium/Windows), "este dispositivo" marcado con
   * un dot de presencia + badge neutro (nunca el azul de marca), y la acción de
   * cerrar revelándose en hover/focus para no gritar en reposo.
   */
  import { Globe, AppleLogo, AndroidLogo, DeviceMobile, SignOut, ArrowsClockwise } from 'phosphor-svelte';
  import type { SessionView } from '$types/backend';
  import {
    platformToneFromSession,
    platformLabelFromTone,
    countryName,
    formatAbsolute,
    formatRelative
  } from '$utils/session-format';

  type Props = {
    session: SessionView;
    /** Si false, no se muestra el botón de cerrar (sesión actual del propio
        usuario, para no auto-desconectarse). */
    closable?: boolean;
    /** True mientras el cierre de ESTA sesión está en vuelo. */
    closing?: boolean;
    onClose?: () => void;
  };

  let { session, closable = true, closing = false, onClose }: Props = $props();

  const tone = $derived(platformToneFromSession(session));
  const label = $derived(platformLabelFromTone(tone));
  const Icon = $derived(
    tone === 'web' ? Globe : tone === 'ios' ? AppleLogo : tone === 'android' ? AndroidLogo : DeviceMobile
  );
  // Los logos de marca solo renderizan bien en fill; los genéricos, en regular.
  const iconWeight = $derived(tone === 'ios' || tone === 'android' ? 'fill' : 'regular');
  const country = $derived(countryName(session.country));
</script>

<div class="row" class:current={session.current} title={`Iniciada ${formatAbsolute(session.createdAt)}`}>
  <span class="icon" data-tone={tone} aria-hidden="true">
    <Icon size={18} weight={iconWeight} />
    {#if session.current}<span class="dot"></span>{/if}
  </span>

  <div class="meta">
    <span class="line-1">
      <span class="device">{label}</span>
      {#if session.current}
        <span class="badge">Este dispositivo</span>
      {/if}
    </span>

    <span class="line-2">
      {#if country}
        <span class="loc">{country}</span>
        <span class="sep">·</span>
      {/if}
      {#if session.ip}
        <span class="ip">{session.ip}</span>
        <span class="sep">·</span>
      {/if}
      <span class="seen">vista {formatRelative(session.lastSeen)}</span>
    </span>
  </div>

  {#if closable}
    <button
      type="button"
      class="close"
      class:closing-visible={closing}
      disabled={closing}
      onclick={() => onClose?.()}
      aria-label="Cerrar esta sesión"
    >
      {#if closing}
        <ArrowsClockwise size={14} weight="bold" class="spin" />
      {:else}
        <SignOut size={14} weight="bold" />
      {/if}
      <span class="close-text">Cerrar</span>
    </button>
  {/if}
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  /* "Este dispositivo": un peldaño más elevado, por materia — sin azul. */
  .row.current { background: var(--bg-surface-elevated); }

  /* ── Icono del dispositivo, teñido por tipo ── */
  .icon {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    display: grid;
    place-items: center;
    background: var(--bg-surface-elevated);
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .icon[data-tone='web']     { background: color-mix(in srgb, var(--device-web) 15%, transparent);     color: var(--device-web); }
  .icon[data-tone='ios']     { background: color-mix(in srgb, var(--device-ios) 22%, transparent);     color: var(--device-ios); }
  .icon[data-tone='android'] { background: color-mix(in srgb, var(--device-android) 18%, transparent); color: var(--device-android); }
  .icon[data-tone='unknown'] { background: var(--bg-surface-active);                                    color: var(--device-unknown); }
  /* Dot de presencia de la sesión actual — verde, no azul. El anillo del color
     del fondo de la fila current lo hace "respirar". */
  .dot {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    background: var(--device-active);
    border: 2px solid var(--bg-surface-elevated);
  }

  /* ── Texto: 2 líneas ── */
  .meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .line-1 {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .device {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Badge NEUTRO (etiqueta, no semáforo) — el color lo lleva el dot. */
  .badge {
    flex-shrink: 0;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    background: var(--bg-surface-active);
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .line-2 {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .loc { flex-shrink: 0; }
  .sep { opacity: 0.5; }
  .ip {
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .seen { flex-shrink: 0; white-space: nowrap; }

  /* ── Botón cerrar — se revela en hover/focus (no grita en reposo) ── */
  .close {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 0;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--status-danger) 10%, transparent);
    color: var(--status-danger);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .row:hover .close,
  .row:focus-within .close,
  .close.closing-visible,
  .close:focus-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .close:hover:not(:disabled) { background: color-mix(in srgb, var(--status-danger) 17%, transparent); }
  .close:active:not(:disabled) { transform: scale(0.96); }
  .close:disabled { opacity: 0.45; cursor: not-allowed; }
  .close:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  :global(.close .spin) { animation: session-spin 1s linear infinite; }
  @keyframes session-spin { to { transform: rotate(360deg); } }

  /* Touch: sin hover, el botón siempre visible. */
  @media (hover: none) {
    .close { opacity: 1; pointer-events: auto; }
  }
  @media (prefers-reduced-motion: reduce) {
    .close { transition: background var(--duration-fast) var(--ease-ios-default); opacity: 1; pointer-events: auto; }
    :global(.close .spin) { animation: none; }
  }

  @media (max-width: 560px) {
    .close-text { display: none; }
    .close { padding: 7px; opacity: 1; pointer-events: auto; }
  }
</style>
