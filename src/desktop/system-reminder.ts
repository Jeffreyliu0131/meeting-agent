/** Keeps native notification callbacks on the same guarded consent path as the bubble. */
export interface NotificationPort {
  on(event: 'click' | 'close' | 'failed', callback: () => void): unknown;
  removeAllListeners(): unknown;
  show(): void;
  close(): void;
}
export class SystemReminder {
  private current: { id: string; notification: NotificationPort } | null = null;
  constructor(
    private ports: {
      supported: () => boolean;
      create: (options: { title: string; body: string; silent: boolean }) => NotificationPort;
      accept: (id: string) => void;
      dismiss: (id: string) => void;
      failed: () => void;
    },
  ) {}
  show(id: string, title: string, body: string) {
    if (this.current?.id === id) return;
    this.clear();
    if (!this.ports.supported()) {
      this.ports.failed();
      this.ports.dismiss(id);
      return;
    }
    try {
      const notification = this.ports.create({ title, body, silent: true });
      this.current = { id, notification };
      notification.on('click', () => {
        if (this.current?.notification !== notification) return;
        this.clear();
        this.ports.accept(id);
      });
      notification.on('close', () => {
        if (this.current?.notification !== notification) return;
        this.clear();
        this.ports.dismiss(id);
      });
      notification.on('failed', () => {
        if (this.current?.notification !== notification) return;
        this.clear();
        this.ports.failed();
        this.ports.dismiss(id);
      });
      notification.show();
    } catch {
      this.clear();
      this.ports.failed();
      this.ports.dismiss(id);
    }
  }
  clear() {
    const notification = this.current?.notification;
    this.current = null;
    if (notification) {
      notification.removeAllListeners();
      try {
        notification.close();
      } catch {
        /* Failure must never start capture or re-alert. */
      }
    }
  }
}
