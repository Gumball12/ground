export class BrowserNotificationPort {
  getApi() {
    return typeof globalThis.Notification === 'function'
      ? globalThis.Notification
      : null;
  }

  getPermission() {
    return this.getApi()?.permission ?? 'unsupported';
  }

  async requestPermission() {
    const api = this.getApi();
    if (!api || typeof api.requestPermission !== 'function') {
      return 'unsupported';
    }

    if (api.permission !== 'default') {
      return api.permission;
    }

    try {
      return await api.requestPermission();
    } catch {
      return api.permission ?? 'default';
    }
  }

  show({ body, onClick, tag, title } = {}) {
    const api = this.getApi();
    if (!api || api.permission !== 'granted' || !body) {
      return null;
    }

    try {
      const notification = new api(title, {
        body,
        renotify: true,
        tag,
      });
      if (onClick) {
        notification.onclick = onClick;
      }
      return notification;
    } catch {
      return null;
    }
  }
}
