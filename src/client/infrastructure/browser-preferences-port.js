function readStorage(storage, key, fallback) {
  try {
    const value = storage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
}

export class BrowserPreferencesPort {
  constructor({
    chatNotificationsKey,
    lineWrappingKey,
    sidebarVisibleKey,
    userNameKey,
    storage = globalThis.localStorage,
  }) {
    this.chatNotificationsKey = chatNotificationsKey;
    this.lineWrappingKey = lineWrappingKey;
    this.sidebarVisibleKey = sidebarVisibleKey;
    this.storage = storage;
    this.userNameKey = userNameKey;
  }

  getUserName() {
    return readStorage(this.storage, this.userNameKey, '') || '';
  }

  setUserName(name) {
    writeStorage(this.storage, this.userNameKey, name);
  }

  getLineWrappingEnabled() {
    return readStorage(this.storage, this.lineWrappingKey, null) !== 'false';
  }

  setLineWrappingEnabled(enabled) {
    writeStorage(this.storage, this.lineWrappingKey, String(enabled));
  }

  getSidebarVisible() {
    return readStorage(this.storage, this.sidebarVisibleKey, null);
  }

  setSidebarVisible(showSidebar) {
    writeStorage(this.storage, this.sidebarVisibleKey, showSidebar ? 'true' : 'false');
  }

  getChatNotificationsEnabled() {
    return readStorage(this.storage, this.chatNotificationsKey, null) === 'true';
  }

  setChatNotificationsEnabled(enabled) {
    writeStorage(this.storage, this.chatNotificationsKey, String(enabled));
  }
}
