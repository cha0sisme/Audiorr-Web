/**
 * Motion constants — para `svelte/motion` (Spring) y otras animaciones que
 * no expresan bien sus parámetros en CSS variables.
 *
 * Por qué un módulo TS y no `--var`:
 *   - Springs reales (stiffness/damping/mass) son 3 números relacionados;
 *     pegarlos en un solo CSS var como string requiere parse en JS.
 *   - Ganamos type-safety + autocomplete + jump-to-definition al consumir.
 *   - Las duraciones/easings sí siguen viviendo en CSS — son lo que CSS
 *     trata bien.
 *
 * Convención: todos los configs son `as const` para tipado estricto y
 * referencia estable (Spring no se reinicia si el config no cambia).
 */

/**
 * Spring para entrada de cards en carruseles (HorizontalScrollSection).
 * Stiffness 220 + damping 26 da un suave "asentamiento" iOS-like sin
 * overshoot perceptible. Para tracklists usar la curva CSS linear/ease-out
 * vía tokens — no merece la fisicalidad de un spring.
 */
export const SPRING_CARD_ENTRY = {
  stiffness: 0.18,
  damping: 0.5
} as const;
