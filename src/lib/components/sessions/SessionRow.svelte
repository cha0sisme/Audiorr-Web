<script lang="ts">
  /**
   * SessionRow — una sesión activa, estilo "Tus dispositivos" de Google,
   * sintonizado con la paleta de Audiorr. Compartida por el panel admin
   * (Housekeeping) y el panel propio (Ajustes).
   *
   * Jerarquía visual: plataforma (título) → país·IP (secundario) →
   * iniciada·vista (terciario). El icono del dispositivo se tiñe con un
   * color por tipo (web/iOS/Android) dentro de la paleta.
   */
  import { Globe, AppleLogo, AndroidLogo, Question, SignOut, ArrowsClockwise } from 'phosphor-svelte';
  import type { SessionView } from '$types/backend';
  import {
    platformTone,
    platformLabel,
    flagEmoji,
    countryLabel,
    formatAbsolute,
    formatRelative
  } from '$utils/session-format';

  type Props = {
    session: SessionView;
    /** Si false, no se muestra el botón de cerrar (p.ej. la sesión actual del
        propio usuario, para no auto-desconectarse). */
    closable?: boolean;
    /** True mientras el cierre de ESTA sesión está en vuelo. */
    closing?: boolean;
    onClose?: () => void;
  };

  let { session, closable = true, closing = false, onClose }: Props = $props();

  const tone = $derived(platformTone(session.platform));
  const Icon = $derived(
    tone === 'web' ? Globe : tone === 'ios' ? AppleLogo : tone === 'android' ? AndroidLogo : Question
  );
  const flag = $derived(flagEmoji(session.country));
</script>

<div class="row" class:current={session.current}>
  <span class="icon" data-tone={tone} aria-hidden="true">
    <Icon size={20} weight="regular" />
  </span>

  <div class="meta">
    <span class="line-1">
      <span class="device">{platformLabel(session.platform)}</span>
      {#if session.current}
        <span class="badge">Este dispositivo</span>
      {/if}
    </span>

    <span class="line-2">
      <span class="loc">
        {#if flag}<span class="flag">{flag}</span>{/if}
        {countryLabel(session.country)}
      </span>
      {#if session.ip}
        <span class="sep">·</span>
        <span class="ip">{session.ip}</span>
      {/if}
    </span>

    <span class="line-3">
      Iniciada {formatAbsolute(session.createdAt)} · vista {formatRelative(session.lastSeen)}
    </span>
  </div>

  {#if closable}
    <button
      type="button"
      class="close"
      disabled={closing}
      onclick={() => onClose?.()}
      title="Cerrar esta sesión"
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
    grid-template-columns: 42px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-canvas);
    border-radius: 14px;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .row.current {
    background: color-mix(in srgb, var(--accent) 9%, var(--bg-canvas));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  /* ── Icono del dispositivo, teñido por tipo (dentro de la paleta) ── */
  .icon {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--bg-surface);
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .icon[data-tone='web'] {
    background: color-mix(in srgb, var(--device-web) 15%, transparent);
    color: var(--device-web);
  }
  .icon[data-tone='ios'] {
    background: color-mix(in srgb, var(--device-ios) 20%, transparent);
    color: var(--device-ios);
  }
  .icon[data-tone='android'] {
    background: color-mix(in srgb, var(--device-android) 18%, transparent);
    color: var(--device-android);
  }
  .icon[data-tone='unknown'] {
    background: var(--bg-surface);
    color: var(--device-unknown);
  }

  /* ── Jerarquía de texto ── */
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
    letter-spacing: -0.005em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .line-2 {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .loc {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-weight: 500;
  }
  .flag {
    font-size: 14px;
    line-height: 1;
  }
  .sep {
    color: var(--text-tertiary);
  }
  .ip {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line-3 {
    font-size: 10.5px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Botón cerrar ── */
  .close {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 13px;
    border: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--status-danger) 11%, transparent);
    color: var(--status-danger);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--duration-fast) ease,
      transform var(--duration-fast) var(--ease-ios-default),
      opacity var(--duration-fast) ease;
  }
  .close:hover:not(:disabled) {
    background: color-mix(in srgb, var(--status-danger) 18%, transparent);
  }
  .close:active:not(:disabled) {
    transform: scale(0.96);
  }
  .close:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .close:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  :global(.close .spin) {
    animation: session-spin 1s linear infinite;
  }
  @keyframes session-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 560px) {
    .close-text {
      display: none;
    }
    .close {
      padding: 7px;
    }
    .line-3 {
      white-space: normal;
    }
  }
</style>
