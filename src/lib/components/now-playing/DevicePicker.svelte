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
   *
   * Reactividad al layout (queue panel abre, sidebar resize, etc.): rAF
   * loop ligero mientras está abierto comprueba si el rect del trigger
   * cambió y re-ancla. Sin coste perceptible (compara dos números).
   *
   * Click outside: pointerdown global con capture-phase que cierra si el
   * target no está dentro del picker ni del trigger. popover="auto" daría
   * light-dismiss nativo pero re-toggle al re-clickear el trigger.
   */

  import { tick } from 'svelte';
  import {
    Desktop,
    Television,
    SpeakerHigh,
    DeviceTablet,
    DeviceMobile,
    Laptop,
    SpeakerSimpleHigh,
    Broadcast,
    CaretRight,
    type IconWeight
  } from 'phosphor-svelte';
  import type { Component } from 'svelte';

  import {
    connectService,
    type ConnectDevice
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
  let lanExpanded = $state(false);

  const LAN_COLLAPSED_LIMIT = 2;

  function recomputeAnchor() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const gap = 12;
    anchorTop = window.innerHeight - rect.top + gap;
    anchorRight = window.innerWidth - rect.right;
  }

  /** Show/hide del popover. Atributo `popover="manual"` requiere control
      programático con `showPopover()` / `hidePopover()`. La animación de
      entrada/cierre la maneja CSS con `@starting-style` + `transition-
      behavior: allow-discrete`. */
  $effect(() => {
    if (!pickerEl) return;
    if (open) {
      recomputeAnchor();
      lanExpanded = false;
      try {
        pickerEl.showPopover();
      } catch {
        // Fallback graceful — el browser no soporta popover attribute.
      }
      tick().then(() => {
        const first = pickerEl?.querySelector<HTMLButtonElement>(
          'button[role="menuitem"]'
        );
        first?.focus();
      });

      // ── Reposicionar mientras está abierto ─────────────────────────────
      // rAF loop ligero: re-ancla cuando el rect del trigger cambia (queue
      // panel abre, sidebar resize, drag, etc.). El cost es comparar dos
      // floats por frame — no perceptible.
      let lastTop = -1;
      let lastRight = -1;
      let rafId = 0;
      const tick2 = () => {
        if (!triggerEl) return;
        const r = triggerEl.getBoundingClientRect();
        const t = window.innerHeight - r.top + 12;
        const ri = window.innerWidth - r.right;
        if (t !== lastTop || ri !== lastRight) {
          anchorTop = t;
          anchorRight = ri;
          lastTop = t;
          lastRight = ri;
        }
        rafId = requestAnimationFrame(tick2);
      };
      rafId = requestAnimationFrame(tick2);

      // ── Click outside ──────────────────────────────────────────────────
      // pointerdown con capture-phase para detectar el click antes que
      // cualquier handler en el subárbol. Si el target no está dentro del
      // picker NI del trigger (re-click del botón debe cerrar via el
      // toggle del parent, no aquí), cerramos.
      const onPointerDown = (e: PointerEvent) => {
        const target = e.target as Node | null;
        if (!target) return;
        if (pickerEl?.contains(target)) return;
        if (triggerEl?.contains(target)) return;
        onClose();
      };
      document.addEventListener('pointerdown', onPointerDown, true);

      const onResize = () => recomputeAnchor();
      window.addEventListener('resize', onResize);
      window.addEventListener('scroll', onResize, true);

      return () => {
        cancelAnimationFrame(rafId);
        document.removeEventListener('pointerdown', onPointerDown, true);
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
  const localDeviceName = $derived(
    connectService.connectedDevices.find((d) => d.isThisDevice)?.name ??
      'Audiorr Web'
  );
  const LocalIcon = $derived(
    iconForDevice({ id: '', name: localDeviceName, type: 'local', isThisDevice: true })
  );

  const visibleLanDevices = $derived(
    lanExpanded ? lanDevices : lanDevices.slice(0, LAN_COLLAPSED_LIMIT)
  );
  const hiddenLanCount = $derived(
    Math.max(0, lanDevices.length - LAN_COLLAPSED_LIMIT)
  );

  /** Mapeo "smart" del icono según el NOMBRE del device. El backend solo
      expone tipos genéricos (controller/receiver/hybrid/lan_device/local)
      pero el name suele contener pistas claras (iPhone, MacBook, Apple TV,
      HomePod, etc.). Regex order matters — el primer match gana. Sin
      match cae al type genérico. */
  function iconForDevice(
    device: ConnectDevice
  ): Component<{ size?: number | string; weight?: IconWeight }> {
    const n = device.name;
    if (/iphone|pixel|galaxy s|android phone|smartphone/i.test(n)) return DeviceMobile;
    if (/ipad|tablet/i.test(n)) return DeviceTablet;
    if (/macbook|laptop|portátil|portatil|surface\b/i.test(n)) return Laptop;
    if (/imac|desktop|pc\b|tower|workstation/i.test(n)) return Desktop;
    if (/apple\s*tv|chromecast|fire\s*tv|smart\s*tv|television|tv\b|roku/i.test(n))
      return Television;
    if (/homepod|sonos|speaker|altavoz|echo|alexa/i.test(n)) return SpeakerHigh;
    if (/audiorr\s*web/i.test(n)) {
      // Sub-detección del propio nombre web (iOS, Android, Mac, PC, Linux)
      if (/\(iOS\)/i.test(n)) return DeviceMobile;
      if (/\(Android\)/i.test(n)) return DeviceMobile;
      if (/\(Mac\)/i.test(n)) return Laptop;
      if (/\(PC\)/i.test(n) || /\(Windows\)/i.test(n)) return Desktop;
      if (/\(Linux\)/i.test(n)) return Desktop;
      return Laptop;
    }
    switch (device.type) {
      case 'controller':
      case 'hybrid':
        return Laptop;
      case 'receiver':
        return SpeakerHigh;
      case 'lan_device':
        return Television;
      case 'local':
        return Laptop;
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

  function onToggle(event: Event) {
    const e = event as ToggleEvent;
    if (e.newState === 'closed' && open) onClose();
  }
</script>

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
        <LocalIcon size={20} weight={isLocalActive ? 'fill' : 'regular'} />
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
          {@const Icon = iconForDevice(device)}
          {@const isActive =
            player.isRemote && player.remoteDeviceName === device.name}
          <button
            type="button"
            class="row"
            class:active={isActive}
            class:remote-active={isActive}
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
                  <span class="eq" aria-hidden="true">
                    <i></i><i></i><i></i>
                  </span>
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

    <!-- ============================================ LAN DEVICES (colapsable) -->
    {#if lanDevices.length > 0}
      <div class="group" role="presentation">
        <h4 class="group-title">Dispositivos en red</h4>
        {#each visibleLanDevices as device (device.id)}
          {@const Icon = iconForDevice(device)}
          {@const isActive = connectService.activeDeviceId === device.id}
          <button
            type="button"
            class="row"
            class:active={isActive}
            class:remote-active={isActive}
            role="menuitem"
            onclick={() => handleLanDeviceClick(device)}
          >
            <span class="row-icon" aria-hidden="true">
              <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
            </span>
            <span class="row-meta">
              <span class="row-name">{device.name}</span>
              <span class="row-sub">
                {#if isActive}
                  <span class="eq" aria-hidden="true">
                    <i></i><i></i><i></i>
                  </span>
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
        {#if hiddenLanCount > 0 && !lanExpanded}
          <button
            type="button"
            class="row-more"
            role="menuitem"
            onclick={() => (lanExpanded = true)}
          >
            <span class="row-more-label">
              Ver {hiddenLanCount} dispositivo{hiddenLanCount === 1 ? '' : 's'} más
            </span>
            <CaretRight size={14} weight="bold" />
          </button>
        {/if}
        {#if lanExpanded && lanDevices.length > LAN_COLLAPSED_LIMIT}
          <button
            type="button"
            class="row-more"
            role="menuitem"
            onclick={() => (lanExpanded = false)}
          >
            <span class="row-more-label">Mostrar menos</span>
          </button>
        {/if}
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

    /* Glass envelope — usa tokens semánticos. Sin border sólido: la
       definición la dan blur + shadow + inset highlight superior. */
    border-radius: var(--radius-2xl, 18px);
    background: var(--bg-glass-solid);
    backdrop-filter: blur(48px) saturate(1.8) brightness(1.05);
    -webkit-backdrop-filter: blur(48px) saturate(1.8) brightness(1.05);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.06),
      0 1px 1px rgb(0 0 0 / 0.04),
      0 24px 56px -8px rgb(0 0 0 / 0.5),
      0 4px 14px -2px rgb(0 0 0 / 0.28);

    color: var(--text-primary);
    overflow: hidden;
    isolation: isolate;

    /* Animación entrada/salida */
    transform-origin: bottom right;
    opacity: 1;
    transform: scale(1) translateY(0);
    transition:
      opacity 220ms var(--ease-ios-default),
      transform 320ms var(--ease-ios-default),
      overlay 220ms var(--ease-ios-default) allow-discrete,
      display 220ms var(--ease-ios-default) allow-discrete;
  }
  .picker:not(:popover-open) {
    opacity: 0;
    transform: scale(0.94) translateY(8px);
  }
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
    padding: 18px 18px 12px;
  }
  .head-icon {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: linear-gradient(
      135deg,
      color-mix(in oklch, var(--accent) 26%, transparent),
      color-mix(in oklch, var(--accent) 10%, transparent)
    );
    color: var(--accent);
    display: grid;
    place-items: center;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1);
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
     BODY
     ========================================================================== */
  .body {
    padding: 4px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: calc(70vh - 100px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 10px;
  }
  /* Sin border-top entre grupos — la separación viene del padding-top + el
     uppercase del group-title. Más limpio, alineado con el lenguaje del
     housekeeping. */
  .group-title {
    margin: 0 0 6px;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  /* ==========================================================================
     ROW — sin borde sólido. La distinción visual es:
       idle     → transparente
       hover    → bg-surface-hover
       active   → bg accent tinted (color-mix con accent)
     ========================================================================== */
  .row {
    position: relative;
    width: 100%;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-radius: 12px;
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background var(--duration-fast, 200ms) var(--ease-ios-default, ease),
      transform var(--duration-fast, 200ms) var(--ease-ios-default, ease);
  }
  .row:hover {
    background: var(--bg-surface-hover);
  }
  .row:focus-visible {
    outline: none;
    background: var(--bg-surface-hover);
    box-shadow: 0 0 0 2px color-mix(in oklch, var(--accent) 50%, transparent);
  }
  .row:active {
    background: var(--bg-surface-active);
    transform: scale(0.985);
  }
  .row.active {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
  }

  /* Icono del row: sin borde sólido. Bg tinted ligero en active, neutral
     bg-surface en idle. Su definición la da el color del icono interno. */
  .row-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--bg-surface);
    display: grid;
    place-items: center;
    color: var(--text-secondary);
    transition: all var(--duration-fast, 200ms) var(--ease-ios-default, ease);
  }
  .row.active .row-icon {
    background: color-mix(in oklch, var(--accent) 20%, transparent);
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
    gap: 6px;
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
    animation: pulse 1.6s var(--ease-ios-default, ease) infinite;
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

  /* Equalizer (rows remote-active) — sin cambios respecto a la versión
     anterior, ya era el componente más premium de la UI. */
  .eq {
    display: inline-flex;
    align-items: flex-end;
    gap: 1.5px;
    height: 10px;
    margin-right: 1px;
  }
  .eq > i {
    display: block;
    width: 2px;
    height: 100%;
    background: var(--accent);
    border-radius: 1px;
    transform-origin: bottom center;
    will-change: transform;
  }
  .eq > i:nth-child(1) { animation: mp-eq-a 1.05s ease-in-out infinite; }
  .eq > i:nth-child(2) { animation: mp-eq-b 0.9s  ease-in-out infinite; }
  .eq > i:nth-child(3) { animation: mp-eq-c 1.15s ease-in-out infinite; }
  @keyframes mp-eq-a {
    0%, 100% { transform: scaleY(0.35); }
    35%      { transform: scaleY(1); }
    62%      { transform: scaleY(0.55); }
  }
  @keyframes mp-eq-b {
    0%, 100% { transform: scaleY(0.7); }
    28%      { transform: scaleY(0.3); }
    58%      { transform: scaleY(1); }
  }
  @keyframes mp-eq-c {
    0%, 100% { transform: scaleY(0.5); }
    44%      { transform: scaleY(0.85); }
    78%      { transform: scaleY(0.3); }
  }
  @media (prefers-reduced-motion: reduce) {
    .eq > i { animation: none; transform: scaleY(0.7); }
  }

  /* Glow ambient detrás del row remote-active — respira lento. */
  .row.remote-active::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: radial-gradient(
      ellipse 80% 100% at center,
      color-mix(in oklch, var(--accent) 16%, transparent) 0%,
      transparent 70%
    );
    pointer-events: none;
    z-index: 0;
    animation: row-breathe 3.6s ease-in-out infinite;
  }
  .row.remote-active > * { position: relative; z-index: 1; }
  @keyframes row-breathe {
    0%, 100% { opacity: 0.35; }
    50%      { opacity: 1; }
  }

  .row-trail {
    position: relative;
    color: var(--accent);
    display: grid;
    place-items: center;
  }
  /* Onda continua del trail icon en remote-active. */
  .row.remote-active .row-trail::before,
  .row.remote-active .row-trail::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 1.5px solid color-mix(in oklch, var(--accent) 55%, transparent);
    pointer-events: none;
    opacity: 0;
    will-change: transform, opacity;
  }
  .row.remote-active .row-trail::before {
    animation: trail-wave 2.2s var(--ease-ios-default, ease) infinite;
  }
  .row.remote-active .row-trail::after {
    animation: trail-wave 2.2s var(--ease-ios-default, ease) infinite 1.1s;
  }
  @keyframes trail-wave {
    0%   { transform: scale(0.5); opacity: 0; }
    20%  { opacity: 0.85; }
    100% { transform: scale(1.9); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .row.remote-active::before,
    .row.remote-active .row-trail::before,
    .row.remote-active .row-trail::after { animation: none; opacity: 0; }
  }

  /* ==========================================================================
     ROW-MORE — botón para expandir/colapsar la lista de dispositivos LAN.
     Visualmente más sutil que los rows reales — no es una opción de
     reproducción, es un control de UI. Padding asimétrico (más a la izq
     para alinearse con el texto de los rows, más estrecho a la dcha por
     el caret).
     ========================================================================== */
  .row-more {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 12px 9px 60px;
    background: transparent;
    border: none;
    border-radius: 10px;
    color: var(--text-tertiary);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition:
      background var(--duration-fast, 200ms) var(--ease-ios-default, ease),
      color var(--duration-fast, 200ms) var(--ease-ios-default, ease);
  }
  .row-more:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .row-more:focus-visible {
    outline: none;
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    box-shadow: 0 0 0 2px color-mix(in oklch, var(--accent) 50%, transparent);
  }
  .row-more-label {
    flex: 1;
  }

  /* ==========================================================================
     FOOTER — connecting state. Sin border-top sólido — un padding-top más
     amplio + opacity baja del texto bastan.
     ========================================================================== */
  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    margin-top: 4px;
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
     SCROLLBAR minimal
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
    transition: background var(--duration-fast, 200ms) var(--ease-ios-default, ease);
  }
  .body:hover::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--text-tertiary) 50%, transparent);
  }
</style>
