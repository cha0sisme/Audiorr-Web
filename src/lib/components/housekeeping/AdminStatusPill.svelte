<script lang="ts">
  /**
   * AdminStatusPill — pill compacta de estado: dot de color + texto.
   *
   * El color comunica ESTADO real (no decoración): ok/success = verde,
   * warning = ámbar, error/down = rojo, running = acento (con pulso sutil),
   * idle = neutro. Reusa los tokens `--status-*` semánticos. El pulso de
   * `running` respeta `prefers-reduced-motion`.
   */
  type Tone = 'idle' | 'running' | 'ok' | 'warn' | 'error';

  type Props = {
    tone: Tone;
    label: string;
  };

  let { tone, label }: Props = $props();
</script>

<span class="pill" data-tone={tone}>
  <span class="dot" aria-hidden="true"></span>
  {label}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: var(--radius-full);
    background: var(--bg-surface-elevated);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    background: var(--text-tertiary);
  }
  .pill[data-tone='ok'] .dot      { background: var(--status-success); }
  .pill[data-tone='warn'] .dot    { background: var(--status-warning); }
  .pill[data-tone='error'] .dot   { background: var(--status-danger); }
  .pill[data-tone='running'] .dot {
    background: var(--accent);
    animation: pill-pulse 1.4s ease-in-out infinite;
  }
  @keyframes pill-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%      { transform: scale(1.5); opacity: 0.5; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pill[data-tone='running'] .dot { animation: none; }
  }
</style>
