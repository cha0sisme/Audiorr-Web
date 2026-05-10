/**
 * Cover blur cross-fade — animación de cambio de canción inspirada en el
 * Dynamic Island de iOS. El cover saliente se desvanece con blur + ligero
 * zoom-out mientras el entrante aparece con blur reverso + zoom-in.
 *
 * Uso típico: con `{#key coverUrl}` envolviendo el `<img>` del cover.
 *
 * ```svelte
 * {#key coverUrl}
 *   <div class="cover-frame" in:coverBlurIn out:coverBlurOut>
 *     <img src={coverUrl} alt="" />
 *   </div>
 * {/key}
 * ```
 *
 * Curva: `ease-out-expo` mirror del SmartMix morph — sensación premium,
 * deceleración natural que evita el "snap" final.
 *
 * Duraciones asimétricas (in 320ms, out 240ms): el entrante necesita más
 * tiempo para que el blur "asiente" y el ojo registre el nuevo cover. El
 * saliente puede irse más rápido — lo que hace falta es que NO chocque con
 * el entrante.
 */

import type { TransitionConfig } from 'svelte/transition';

/** Helper para encadenar transiciones con `--ease-out-expo`. */
function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function coverBlurIn(_node: Element): TransitionConfig {
  return {
    duration: 320,
    easing: easeOutExpo,
    css: (t) => {
      const u = 1 - t;
      return `
        opacity: ${t};
        filter: blur(${u * 10}px);
        transform: scale(${0.94 + t * 0.06});
      `;
    }
  };
}

export function coverBlurOut(_node: Element): TransitionConfig {
  return {
    duration: 240,
    easing: easeOutExpo,
    css: (t) => {
      const u = 1 - t;
      return `
        opacity: ${t};
        filter: blur(${u * 10}px);
        transform: scale(${1 + u * 0.04});
      `;
    }
  };
}
