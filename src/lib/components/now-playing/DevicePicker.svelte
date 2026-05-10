<script lang="ts">
  /**
   * DevicePicker — popover Liquid Glass anclado al botón "Devices" del MiniPlayer.
   *
   * Mirror del iOS DevicePickerView.swift (sheet) adaptado a popover web.
   * Reactivo a `connectService` + `player` ($state runes).
   *
   * Por qué `popover="manual"` (HTML5 top-layer):
   *   El `.player` aplica `backdrop-filter`, lo que crea un containing block
   *   para `position: fixed` Y un overflow:hidden. Cualquier popover dentro
   *   del subárbol queda anclado al .player y se corta. El atributo
   *   `popover` renderiza en el top-layer del browser — NO le afecta
   *   overflow, transform, filter ni stacking de ancestros. Soportado en
   *   todos los navegadores modernos (Chrome 114+, Safari 17+, Firefox 125+,
   *   2024+ baseline).
   *
   * Sin AirPlay/Bluetooth route picker — la web no tiene equivalente nativo
   * (ni AVRoutePickerView ni MediaSession lo exponen). El user usa la UI
   * del SO si quiere routear audio a otro device de salida.
   */

  import { tick } from 'svelte';
  import {
    Desktop,
    Television,
    SpeakerHigh,
    DeviceTablet,
    SpeakerSimpleHigh,
    Broadcast,
    type IconWeight
  } from 'phosphor-svelte';
  import type { Component } from 'svelte';

  import {
    connectService,
    type ConnectDevice,
    type ConnectDeviceType
  } from '$services/ConnectService.svelte';
  import { player } from '$stores/player.svelte';

  type Props = {
    open: boolean;
    /** Botón disparador — se usa para anclar el popover en CSS via
        `anchor-name` (con fallback a JS getBoundingClientRect en navegadores
        sin CSS Anchor Positioning todavía). */
    triggerEl: HTMLElement | null;
    onClose: () => void;
  };

  let { open, triggerEl, onClose }: Props = $props();

  let pickerEl: HTMLDivElement | null = $state(null);
  let anchorTop = $state(0);
  let anchorRight = $state(0);

  function recomputeAnchor() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const gap = 12;
    // El popover top-layer NO está en el flow normal; las coords son del
    // viewport. Anclamos por bottom (sale desde arriba del trigger) y right
    // (alineado al borde derecho del trigger).
    anchorTop = window.innerHeight - rect.top + gap;
    anchorRight = window.innerWidth - rect.right;
  }

  /** Show/hide del popover — el atributo `popover="manual"` requiere control
      programático con `showPopover()` / `hidePopover()`. La animación de
      cierre la maneja CSS con `transition-behavior: allow-discrete` y
      `@starting-style`. */
  $effect(() => {
    if (!pickerEl) return;
    if (open) {
      recomputeAnchor();
      try {
        pickerEl.showPopover();
      } catch {
        // showPopover puede tirar si el browser no lo soporta — fallback al
        // CSS display:block (escapa de overflow gracias a position:fixed,
        // aunque no del backdrop-filter containing block).
      }
      tick().then(() => {
        const first = pickerEl?.querySelector<HTMLButtonElement>(
          'button[role="menuitem"]'
        );
        first?.focus();
      });
      const onResize = () => recomputeAnchor();
      window.addEventListener('resize', onResize);
      window.addEventListener('scroll', onResize, true);
      return () => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('scroll', onResize, true);
        try {
          if (pickerEl?.matches(':popover-open')) pickerEl.hidePopover();
        } catch {
          /* noop */
        }
      };
    }
    return;
  });

  /** Filtra el self del listado hub. */
  const otherHubDevices = $derived(
    connectService.connectedDevices.filter((d) => !d.isThisDevice)
  );
  const lanDevices = $derived(connectService.lanDevices);
  const hubConnected = $derived(connectService.hubConnected);
  const isLocalActive = $derived(
    !player.isRemote && connectService.activeDeviceId === null
  );
  /** Nombre amigable del device local — viene del UA detectado en
      ConnectService. Lo mostramos como subtitle del row local para dar
      sensación de "este dispositivo concreto". */
  const localDeviceName = $derived(
    connectService.connectedDevices.find((d) => d.isThisDevice)?.name ??
      'Audiorr Web'
  );

  function iconForType(
    type: ConnectDeviceType
  ): Component<{ size?: number | string; weight?: IconWeight }> {
    switch (type) {
      case 'controller':
      case 'hybrid':
        return Desktop;
      case 'receiver':
        return SpeakerHigh;
      case 'lan_device':
        return Television;
      case 'local':
        return Desktop;
      default:
        return DeviceTablet;
    }
  }

  function handleLocalClick() {
    if (player.isRemote || connectService.activeDeviceId !== null) {
      connectService.switchToLocal();
    }
    onClose();
  }

  function handleHubDeviceClick(_device: ConnectDevice) {
    // Comportamiento iOS hoy: requestSync — el hub responde con el
    // playback_state_update del device si lo tiene cacheado, y el handler
    // espeja al `player`. Tomar control activo (este device empieza,
    // aquel pausa) requeriría sendRemoteCommand("pause", target=device.id)
    // + cargar la cola aquí; diferido a futuro.
    connectService.requestSync();
    onClose();
  }

  function handleLanDeviceClick(device: ConnectDevice) {
    if (connectService.activeDeviceId === device.id) {
      connectService.stopCasting();
    } else {
      connectService.castToDevice(device);
    }
    onClose();
  }

  /** Light-dismiss nativo del attribute popover dispara `toggle`/`beforetoggle`.
      Cuando el browser cierra el popover (Esc o click fuera), notificamos al
      parent para sincronizar el state. */
  function onToggle(event: Event) {
    const e = event as ToggleEvent;
    if (e.newState === 'closed' && open) onClose();
  }
</script>

<!-- popover="manual" + control programático: el atributo `auto` permitiría
     light-dismiss nativo, pero también cierra cuando el user clickea
     CUALQUIER otro elemento con popover (incluido el botón trigger), lo
     que produce un toggle reentrante incómodo. Con manual gestionamos
     close en click-outside vía `beforetoggle` (browser detecta Esc) +
     onClose desde el parent al re-clickear el trigger. -->
<div
  bind:this={pickerEl}
  popover="manual"
  class="picker"
  role="menu"
  aria-label="Reproducir en"
  style:bottom="{anchorTop}px"
  style:right="{anchorRight}px"
  ontoggle={onToggle}
  tabindex={-1}
>
  <header class="head">
    <div class="head-icon" aria-hidden="true">
      <Broadcast size={16} weight="bold" />
    </div>
    <div class="head-text">
      <h3 class="head-title">Reproducir en</h3>
      <p class="head-sub">
        {#if !hubConnected}
          Conectando al Hub…
        {:else if otherHubDevices.length === 0 && lanDevices.length === 0}
          Solo este dispositivo disponible
        {:else}
          {otherHubDevices.length + lanDevices.length} dispositivo{otherHubDevices.length + lanDevices.length === 1 ? '' : 's'} disponible{otherHubDevices.length + lanDevices.length === 1 ? '' : 's'}
        {/if}
      </p>
    </div>
  </header>

  <div class="body">
    <!-- ============================================ LOCAL -->
    <button
      type="button"
      class="row"
      class:active={isLocalActive}
      role="menuitem"
      onclick={handleLocalClick}
    >
      <span class="row-icon" aria-hidden="true">
        <Desktop size={20} weight={isLocalActive ? 'fill' : 'regular'} />
      </span>
      <span class="row-meta">
        <span class="row-name">{localDeviceName}</span>
        <span class="row-sub">
          {#if isLocalActive}
            <span class="pulse" aria-hidden="true"></span>
            Reproduciendo aquí
          {:else}
            Tocar para volver al local
          {/if}
        </span>
      </span>
      {#if isLocalActive}
        <span class="row-trail" aria-hidden="true">
          <SpeakerSimpleHigh size={16} weight="fill" />
        </span>
      {/if}
    </button>

    <!-- ============================================ HUB DEVICES -->
    {#if otherHubDevices.length > 0}
      <div class="group" role="presentation">
        <h4 class="group-title">Audiorr Connect</h4>
        {#each otherHubDevices as device (device.id)}
          {@const Icon = iconForType(device.type)}
          {@const isActive =
            player.isRemote && player.remoteDeviceName === device.name}
          <button
            type="button"
            class="row"
            class:active={isActive}
            role="menuitem"
            onclick={() => handleHubDeviceClick(device)}
          >
            <span class="row-icon" aria-hidden="true">
              <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
            </span>
            <span class="row-meta">
              <span class="row-name">{device.name}</span>
              <span class="row-sub">
                {#if isActive}
                  <span class="pulse" aria-hidden="true"></span>
                  Reproduciendo
                {:else}
                  Tocar para reflejar
                {/if}
              </span>
            </span>
            {#if isActive}
              <span class="row-trail" aria-hidden="true">
                <SpeakerSimpleHigh size={16} weight="fill" />
              </span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    <!-- ============================================ LAN DEVICES -->
    {#if lanDevices.length > 0}
      <div class="group" role="presentation">
        <h4 class="group-title">Dispositivos en red</h4>
        {#each lanDevices as device (device.id)}
          {@const isActive = connectService.activeDeviceId === device.id}
          <button
            type="button"
            class="row"
            class:active={isActive}
            role="menuitem"
            onclick={() => handleLanDeviceClick(device)}
          >
            <span class="row-icon" aria-hidden="true">
              <Television size={20} weight={isActive ? 'fill' : 'regular'} />
            </span>
            <span class="row-meta">
              <span class="row-name">{device.name}</span>
              <span class="row-sub">
                {#if isActive}
                  <span class="pulse" aria-hidden="true"></span>
                  Casting
                {:else}
                  Tocar para enviar
                {/if}
              </span>
            </span>
            {#if isActive}
              <span class="row-trail" aria-hidden="true">
                <SpeakerSimpleHigh size={16} weight="fill" />
              </span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if !hubConnected}
    <footer class="status">
      <span class="spinner" aria-hidden="true"></span>
      <span class="status-text">Conectando al Hub…</span>
    </footer>
  {/if}
</div>

<style>
  /* ==========================================================================
     LIQUID GLASS POPOVER
     - popover="manual" → top-layer del browser, escapa overflow + transform.
     - position:fixed con bottom/right anclado al trigger via JS.
     - Animación de entrada/salida con @starting-style + transition-behavior
       allow-discrete (Chrome 117+, Safari 17.4+, Firefox 129+).
     ========================================================================== */
  .picker {
    /* Reset del display:none default del popover attribute */
    position: fixed;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    inset: auto;

    /* Geometría */
    width: 320px;
    max-width: calc(100vw - 32px);
    max-height: 70vh;

    /* Glass envelope */
    border-radius: 18px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-glass-solid);
    backdrop-filter: blur(48px) saturate(1.8) brightness(1.05);
    -webkit-backdrop-filter: blur(48px) saturate(1.8) brightness(1.05);
    box-shadow:
      0 1px 0 0 rgb(255 255 255 / 0.05) inset,
      0 24px 48px -12px rgb(0 0 0 / 0.45),
      0 4px 12px -2px rgb(0 0 0 / 0.25);

    color: var(--text-primary);
    overflow: hidden;
    isolation: isolate;

    /* Animación de entrada/salida con discrete property */
    transform-origin: bottom right;
    opacity: 1;
    transform: scale(1) translateY(0);
    transition:
      opacity 200ms var(--ease-ios-default),
      transform 280ms var(--ease-ios-default),
      overlay 200ms var(--ease-ios-default) allow-discrete,
      display 200ms var(--ease-ios-default) allow-discrete;
  }
  /* Estado closed (popover attribute lo aplica con display:none).
     transition-behavior: allow-discrete permite animar la transición. */
  .picker:not(:popover-open) {
    opacity: 0;
    transform: scale(0.94) translateY(8px);
  }
  /* @starting-style aplica al primer paint cuando el popover se abre,
     creando una transición desde estos valores a los del estado open. */
  @starting-style {
    .picker:popover-open {
      opacity: 0;
      transform: scale(0.94) translateY(8px);
    }
  }

  /* ==========================================================================
     HEAD — header con icono accent + título + descripción contextual
     ========================================================================== */
  .head {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 12px;
    padding: 18px 18px 14px;
  }
  .head-icon {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: linear-gradient(
      135deg,
      color-mix(in oklch, var(--accent) 22%, transparent),
      color-mix(in oklch, var(--accent) 8%, transparent)
    );
    color: var(--accent);
    display: grid;
    place-items: center;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08);
  }
  .head-text {
    min-width: 0;
  }
  .head-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .head-sub {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.3;
  }

  /* ==========================================================================
     BODY — list of rows scroll
     ========================================================================== */
  .body {
    padding: 0 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: calc(70vh - 110px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 8px;
  }
  .group + .group {
    border-top: 1px solid var(--border-subtle);
    margin-top: 6px;
    padding-top: 12px;
  }
  .group-title {
    margin: 0 0 4px;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  /* ==========================================================================
     ROW — tappable device entry
     - Layout: icon · meta · trail-indicator
     - Active: borde sutil + bg tinted accent + texto accent + scale del icon
     ========================================================================== */
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 12px;
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .row:hover {
    background: var(--bg-surface-hover);
  }
  .row:focus-visible {
    background: var(--bg-surface-hover);
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 25%, transparent);
  }
  .row:active {
    background: var(--bg-surface-active);
    transform: scale(0.985);
  }
  .row.active {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
    border-color: color-mix(in oklch, var(--accent) 28%, transparent);
  }

  .row-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--bg-surface);
    display: grid;
    place-items: center;
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    transition: all var(--duration-fast) var(--ease-ios-default);
  }
  .row.active .row-icon {
    background: color-mix(in oklch, var(--accent) 18%, transparent);
    border-color: color-mix(in oklch, var(--accent) 32%, transparent);
    color: var(--accent);
  }

  .row-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .row-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.2;
  }
  .row.active .row-name {
    color: var(--accent);
  }
  .row-sub {
    font-size: 11px;
    color: var(--text-tertiary);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.active .row-sub {
    color: color-mix(in oklch, var(--accent) 90%, transparent);
  }

  .pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 0 var(--accent);
    animation: pulse 1.6s var(--ease-ios-default) infinite;
  }
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in oklch, var(--accent) 60%, transparent);
    }
    70% {
      box-shadow: 0 0 0 6px color-mix(in oklch, var(--accent) 0%, transparent);
    }
    100% {
      box-shadow: 0 0 0 0 color-mix(in oklch, var(--accent) 0%, transparent);
    }
  }

  .row-trail {
    color: var(--accent);
    display: grid;
    place-items: center;
  }

  /* ==========================================================================
     FOOTER — connecting state indicator
     ========================================================================== */
  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 18px;
    border-top: 1px solid var(--border-subtle);
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .status-text {
    line-height: 1.3;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid var(--text-tertiary);
    border-top-color: transparent;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ==========================================================================
     SCROLLBAR — minimal y solo en hover (estilo iOS)
     ========================================================================== */
  .body::-webkit-scrollbar {
    width: 6px;
  }
  .body::-webkit-scrollbar-track {
    background: transparent;
  }
  .body::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 3px;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .body:hover::-webkit-scrollbar-thumb {
    background: var(--border-subtle);
  }
</style>
