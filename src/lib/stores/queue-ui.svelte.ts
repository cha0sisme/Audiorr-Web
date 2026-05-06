/**
 * Estado UI del QueuePanel — solo controla apertura/cierre desde el botón
 * "Cola" del MiniPlayer. La data viene de queueManager (single source of
 * truth) — este store NO duplica queue/currentIndex.
 */
class QueueUIStore {
  isOpen = $state(false);

  open(): void {
    this.isOpen = true;
  }
  close(): void {
    this.isOpen = false;
  }
  toggle(): void {
    this.isOpen = !this.isOpen;
  }
}

export const queueUI = new QueueUIStore();
