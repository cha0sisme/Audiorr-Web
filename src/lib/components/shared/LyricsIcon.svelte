<script lang="ts">
  /**
   * LyricsIcon — icono de letras. Carga el SVG de /public como mask-image
   * para que el color del path herede `currentColor` (los SVG raw tienen
   * `fill="#000000"` hardcoded, mask les quita el color y lo decide el bg).
   *
   * Toggle outlined ↔ filled via prop `filled`. API mimética a Phosphor
   * (size en px) para que sustituir <MicrophoneStage size={20} weight="fill" />
   * por <LyricsIcon size={20} filled /> sea drop-in.
   */
  type Props = {
    size?: number;
    filled?: boolean;
  };
  let { size = 20, filled = false }: Props = $props();
  const url = $derived(filled ? '/lyrics-filled.svg' : '/lyrics-outlined.svg');
</script>

<span
  class="lyrics-icon"
  aria-hidden="true"
  style:--lyr-size="{size}px"
  style:--lyr-mask="url({url})"
></span>

<style>
  .lyrics-icon {
    display: inline-block;
    width: var(--lyr-size);
    height: var(--lyr-size);
    background: currentColor;
    -webkit-mask: var(--lyr-mask) no-repeat center / contain;
            mask: var(--lyr-mask) no-repeat center / contain;
    flex-shrink: 0;
  }
</style>
