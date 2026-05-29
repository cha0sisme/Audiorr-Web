/**
 * tooltip — Svelte action para un tooltip reutilizable en toda la UI.
 *
 * Por qué un action y no un componente: el tooltip debe poder mostrarse
 * "bien en cualquier vista, independientemente del viewport DOM" — o sea,
 * escapar de cualquier `overflow: hidden`, `transform` o stacking context
 * del ancestro (sidebar colapsado, carruseles, sheets…). La única forma
 * robusta es renderizar el nodo flotante en `document.body` con
 * `position: fixed`, calculando la posición desde el rect del trigger.
 * Un action encapsula ese ciclo de vida y se aplica a cualquier elemento:
 *
 *   <a use:tooltip={'Texto'}> … </a>
 *   <button use:tooltip={{ text: 'Texto', placement: 'top' }}> … </button>
 *
 * Estilo: el nodo lleva la clase global `.audiorr-tooltip` (definida en
 * globals.css consumiendo SOLO tokens semánticos), igual que el resto de
 * la UI. El action no inyecta colores inline — solo posición.
 */
import type { Action } from 'svelte/action';

type Placement = 'top' | 'right' | 'bottom' | 'left';

type TooltipParams =
  | string
  | {
      text: string;
      placement?: Placement;
      /** Retraso de aparición en ms. Default 350 (evita flicker al pasar). */
      delay?: number;
    };

/** Distancia entre el trigger y el tooltip, en px. */
const GAP = 8;
/** Margen mínimo respecto al borde del viewport al hacer clamp. */
const VIEWPORT_MARGIN = 8;

function normalize(params: TooltipParams): {
  text: string;
  placement: Placement;
  delay: number;
} {
  if (typeof params === 'string') {
    return { text: params, placement: 'right', delay: 350 };
  }
  return {
    text: params.text,
    placement: params.placement ?? 'right',
    delay: params.delay ?? 350
  };
}

export const tooltip: Action<HTMLElement, TooltipParams> = (node, initial) => {
  let opts = normalize(initial ?? '');
  let tip: HTMLDivElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let removeTimer: ReturnType<typeof setTimeout> | undefined;

  function position() {
    if (!tip) return;
    const trigger = node.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;

    let x = 0;
    let y = 0;
    let placement = opts.placement;

    // Flip horizontal si no cabe a la derecha/izquierda.
    if (placement === 'right' && trigger.right + GAP + tw > window.innerWidth) {
      placement = 'left';
    } else if (placement === 'left' && trigger.left - GAP - tw < 0) {
      placement = 'right';
    }
    // Flip vertical si no cabe arriba/abajo.
    if (placement === 'top' && trigger.top - GAP - th < 0) {
      placement = 'bottom';
    } else if (placement === 'bottom' && trigger.bottom + GAP + th > window.innerHeight) {
      placement = 'top';
    }

    switch (placement) {
      case 'right':
        x = trigger.right + GAP;
        y = trigger.top + trigger.height / 2 - th / 2;
        break;
      case 'left':
        x = trigger.left - GAP - tw;
        y = trigger.top + trigger.height / 2 - th / 2;
        break;
      case 'top':
        x = trigger.left + trigger.width / 2 - tw / 2;
        y = trigger.top - GAP - th;
        break;
      case 'bottom':
        x = trigger.left + trigger.width / 2 - tw / 2;
        y = trigger.bottom + GAP;
        break;
    }

    // Clamp al viewport para que nunca se salga.
    x = Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - tw - VIEWPORT_MARGIN));
    y = Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - th - VIEWPORT_MARGIN));

    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
    tip.dataset.placement = placement;
  }

  function show() {
    if (!opts.text || tip) return;
    if (removeTimer) clearTimeout(removeTimer);

    const el = document.createElement('div');
    el.className = 'audiorr-tooltip';
    el.setAttribute('role', 'tooltip');
    el.textContent = opts.text;
    document.body.appendChild(el);
    tip = el;

    // Posiciona ANTES de pintar visible (evita salto desde 0,0).
    position();
    // Force reflow → la transición de entrada arranca desde el estado inicial.
    void el.offsetWidth;
    el.classList.add('is-visible');
  }

  function hide() {
    if (showTimer) clearTimeout(showTimer);
    showTimer = undefined;
    if (!tip) return;
    const el = tip;
    tip = null;
    el.classList.remove('is-visible');
    // Espera al fade-out antes de quitar del DOM.
    removeTimer = setTimeout(() => el.remove(), 150);
  }

  function scheduleShow() {
    if (showTimer || tip) return;
    showTimer = setTimeout(() => {
      showTimer = undefined;
      show();
    }, opts.delay);
  }

  node.addEventListener('mouseenter', scheduleShow);
  node.addEventListener('focusin', scheduleShow);
  node.addEventListener('mouseleave', hide);
  node.addEventListener('focusout', hide);
  // Al hacer click/activar el trigger el tooltip estorba (navegación, toggle).
  node.addEventListener('pointerdown', hide);

  return {
    update(next: TooltipParams) {
      opts = normalize(next ?? '');
      if (tip) {
        tip.textContent = opts.text;
        position();
      }
    },
    destroy() {
      if (showTimer) clearTimeout(showTimer);
      if (removeTimer) clearTimeout(removeTimer);
      tip?.remove();
      tip = null;
      node.removeEventListener('mouseenter', scheduleShow);
      node.removeEventListener('focusin', scheduleShow);
      node.removeEventListener('mouseleave', hide);
      node.removeEventListener('focusout', hide);
      node.removeEventListener('pointerdown', hide);
    }
  };
};
