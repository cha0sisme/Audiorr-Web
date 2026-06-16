<script lang="ts">
  /**
   * SessionRow — una sesión activa, estilo "Tus dispositivos". Compartida por
   * el panel admin (Housekeeping → Personas) y el panel propio (Ajustes).
   *
   * Lenguaje limpio: dos líneas (plataforma + badge · ubicación/IP/última vista),
   * sin la fecha de inicio verbosa (va al tooltip). El icono se infiere del
   * platform del backend y, si no lo clasificó, del user-agent (así Android no
   * cae a "Desconocido"). Logos de marca con weight fill (regular no renderiza).
   */
  import { Globe, AppleLogo, AndroidLogo, DeviceMobile, SignOut, ArrowsClockwise } from 'phosphor-svelte';
  import type { SessionView } from '$types/backend';
  import {
    platformToneFromSession,
    platformLabelFromTone,
    flagEmoji,
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
  const flag = $derived(flagEmoji(session.country));
</script>

<div class="row" class:current={session.current} title={`Iniciada ${formatAbsolute(session.createdAt)}`}>
  <span class="icon" data-tone={tone} aria-hidden="true">
    <Icon size={18} weight={iconWeight} />
  </span>

  <div class="meta">
    <span class="line-1">
      <span class="device">{label}</span>
      {#if session.current}
        <span class="badge">Este dispositivo</span>
      {/if}
    </span>

    <span class="line-2">
      {#if flag}
        <span class="loc"><span class="flag">{flag}</span>{(session.country ?? '').toUpperCase()}</span>
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
    grid-template-columns: 38px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-surface);
    border-radius: var(--radius-md);
  }
  .row.current {
    background: color-mix(in srgb, var(--accent) 9%, var(--bg-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent);
  }

  /* ── Icono del dispositivo, teñido por tipo ── */
  .icon {
    width: 38px;
    height: 38px;
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
  .icon[data-tone='unknown'] { background: var(--bg-surface-elevated);                                  color: var(--device-unknown); }

  /* ── Texto: 2 líneas ── */
  .meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
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
  .badge {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--text-accent);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .line-2 {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .loc {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .flag { font-size: 13px; line-height: 1; }
  .sep { color: var(--text-tertiary); opacity: 0.6; }
  .ip {
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .seen { flex-shrink: 0; white-space: nowrap; }

  /* ── Botón cerrar ── */
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
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .close:hover:not(:disabled) { background: color-mix(in srgb, var(--status-danger) 17%, transparent); }
  .close:active:not(:disabled) { transform: scale(0.96); }
  .close:disabled { opacity: 0.45; cursor: not-allowed; }
  .close:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  :global(.close .spin) { animation: session-spin 1s linear infinite; }
  @keyframes session-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    :global(.close .spin) { animation: none; }
  }

  @media (max-width: 560px) {
    .close-text { display: none; }
    .close { padding: 7px; }
  }
</style>
