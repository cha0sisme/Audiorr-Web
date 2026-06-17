/**
 * Estado UI del Sidebar — colapsado vs expandido. Persistido en localStorage
 * para que la preferencia sobreviva a recargas (paridad Spotify desktop).
 *
 * Colapsado (~72px): rail estrecho con logo + iconos del menú + covers de
 * pinned playlists + avatar del UserMenu. Tooltips via `title` attr.
 * Expandido (240px): layout completo con labels, search expandido, nombres.
 */
const LS_KEY = 'audiorr-sidebar-collapsed';

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

class SidebarUIStore {
  collapsed = $state(readInitial());

  /** Si la lista de pinned está expandida más allá del límite ("+N más").
      Ephemeral — no se persiste: cada sesión arranca colapsada para no
      saturar el rail con muchas ancladas. */
  pinnedExpanded = $state(false);

  toggle(): void {
    this.collapsed = !this.collapsed;
    this.#persist();
  }

  set(value: boolean): void {
    this.collapsed = value;
    this.#persist();
  }

  togglePinned(): void {
    this.pinnedExpanded = !this.pinnedExpanded;
  }

  #persist(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LS_KEY, this.collapsed ? '1' : '0');
    } catch {
      /* storage lleno o bloqueado — ignorar */
    }
  }
}

export const sidebarUI = new SidebarUIStore();
