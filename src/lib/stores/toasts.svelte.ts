/**
 * Toast manager global. Cualquier servicio o componente puede disparar:
 *   import { toasts } from '$stores/toasts.svelte';
 *   toasts.success('Conectado', 'Sesión iniciada en Navidrome');
 *
 * El renderizado lo hace <ToastViewport /> en +layout.svelte.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export type ToastEntry = {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string | undefined;
  duration: number;
};

class ToastsStore {
  items = $state<ToastEntry[]>([]);
  #nextId = 0;

  push(variant: ToastVariant, title: string, description?: string, duration = 4500) {
    const id = this.#nextId++;
    this.items = [...this.items, { id, variant, title, description, duration }];
    return id;
  }

  success(title: string, description?: string) {
    return this.push('success', title, description);
  }
  error(title: string, description?: string) {
    return this.push('error', title, description, 6000);
  }
  warning(title: string, description?: string) {
    return this.push('warning', title, description);
  }
  info(title: string, description?: string) {
    return this.push('info', title, description);
  }

  dismiss(id: number) {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new ToastsStore();
