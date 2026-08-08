export const chatFeature = {
  updateChatMessages(messages, { initial = false } = {}) {
    const previousIds = new Set(this.chatMessageIds);
    const localPeerId = this.lobby.getLocalUser()?.peerId ?? null;

    this.chatMessages = messages;
    this.chatMessageIds = new Set(messages.map((message) => message.id));

    if (!this.chatInitialSyncComplete) {
      if (initial) {
        this.chatInitialSyncComplete = true;
      }

      this.renderChat();
      return;
    }

    const newRemoteMessages = messages.filter((message) => (
      !previousIds.has(message.id)
      && message.peerId
      && message.peerId !== localPeerId
    ));

    if (this.chatIsOpen) {
      this.chatUnreadCount = 0;
    } else if (newRemoteMessages.length > 0) {
      this.chatUnreadCount += newRemoteMessages.length;
    }

    for (const message of newRemoteMessages) {
      this.maybeNotifyChatMessage(message);
    }

    this.renderChat();
  },

  toggleChatPanel() {
    if (this.chatIsOpen) {
      this.closeChatPanel();
      return;
    }

    this.openChatPanel();
  },

  openChatPanel() {
    this.chatIsOpen = true;
    this.chatUnreadCount = 0;
    this.renderChat();
    requestAnimationFrame(() => {
      this.elements.chatInput?.focus();
      this.scrollChatToBottom();
    });
  },

  closeChatPanel() {
    if (!this.chatIsOpen) {
      return;
    }

    this.chatIsOpen = false;
    this.renderChat();
  },

  handleChatSubmit() {
    if (!this.isTabActive) {
      return;
    }

    const input = this.elements.chatInput;
    if (!input) {
      return;
    }

    const sentMessage = this.lobby.sendChatMessage(input.value);
    if (!sentMessage) {
      input.focus();
      return;
    }

    input.value = '';
    if (!this.chatIsOpen) {
      this.openChatPanel();
      return;
    }

    this.renderChat();
  },

  renderChat() {
    this.elements.chatContainer?.classList.toggle('is-open', this.chatIsOpen);
    this.elements.chatPanel?.classList.toggle('hidden', !this.chatIsOpen);

    this.syncChatToggleButton();
    this.syncChatNotificationButton();
    const list = this.elements.chatMessages;
    const emptyState = this.elements.chatEmptyState;

    if (this.elements.chatStatus) {
      this.elements.chatStatus.textContent = this.chatInitialSyncComplete
        ? `${this.globalUsers.length} online`
        : 'Syncing...';
    }

    if (!list) {
      return;
    }

    if (!this.chatIsOpen) {
      return;
    }

    list.replaceChildren();

    if (this.chatMessages.length === 0) {
      emptyState?.classList.remove('hidden');
      list.classList.add('hidden');
      return;
    }

    emptyState?.classList.add('hidden');
    list.classList.remove('hidden');

    const fragment = document.createDocumentFragment();
    this.chatMessages.forEach((message) => {
      fragment.appendChild(this.createChatMessageElement(message));
    });
    list.appendChild(fragment);

    this.scrollChatToBottom();
  },

  createChatMessageElement(message) {
    const item = document.createElement('article');
    const isLocal = message.peerId === this.lobby.getLocalUser()?.peerId;
    item.className = 'chat-message';
    item.classList.toggle('is-local', isLocal);

    const avatar = document.createElement('div');
    avatar.className = 'chat-message-avatar';
    avatar.style.backgroundColor = message.userColor || 'var(--color-primary)';
    avatar.textContent = (message.userName || '?').charAt(0).toUpperCase();
    avatar.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'chat-message-body';

    const meta = document.createElement('div');
    meta.className = 'chat-message-meta';

    const author = document.createElement('span');
    author.className = 'chat-message-author';
    author.textContent = isLocal ? `${message.userName} (you)` : message.userName;

    const time = document.createElement('span');
    time.className = 'chat-message-time';
    time.textContent = this.formatChatTimestamp(message.createdAt);

    meta.append(author, time);

    const fileLabel = this.getChatMessageFileLabel(message.filePath);
    if (fileLabel) {
      const file = document.createElement('span');
      file.className = 'chat-message-file';
      file.textContent = fileLabel;
      meta.append(file);
    }

    const text = document.createElement('p');
    text.className = 'chat-message-text';
    text.textContent = message.text;

    body.append(meta, text);
    item.append(avatar, body);
    return item;
  },

  scrollChatToBottom() {
    const list = this.elements.chatMessages;
    if (!list) {
      return;
    }

    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  },

  formatChatTimestamp(value) {
    if (!Number.isFinite(value)) {
      return '';
    }

    try {
      return this.chatTimeFormatter.format(new Date(value));
    } catch {
      return '';
    }
  },

  getChatMessageFileLabel(filePath) {
    if (!filePath) {
      return '';
    }

    return this.getDisplayName(filePath);
  },

  formatChatToastMessage(message) {
    const sender = message?.userName || 'Someone';
    const text = String(message?.text ?? '').replace(/\s+/g, ' ').trim();
    const compactText = text.length > 88 ? `${text.slice(0, 85).trimEnd()}...` : text;
    return `${sender}: ${compactText}`;
  },

  syncChatNotificationButton() {
    const button = this.elements.chatNotificationButton;
    if (!button) {
      return;
    }

    const permission = this.notifications?.getPermission?.() ?? 'unsupported';
    const enabled = permission === 'granted';
    const unavailable = permission === 'unsupported';

    button.classList.toggle('is-enabled', enabled);
    button.classList.toggle('is-blocked', permission === 'denied');
    button.disabled = unavailable;
    button.hidden = unavailable;
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'Desktop alerts on' : 'Enable desktop alerts';
    button.title = permission === 'denied'
      ? 'Desktop alerts are blocked in browser settings'
      : enabled
        ? 'Desktop alerts enabled'
        : 'Allow desktop alerts for new chat messages';
  },

  async handleChatNotificationToggle() {
    const permission = await this.notifications?.requestPermission?.();
    this.syncChatNotificationButton();

    if (permission === 'granted') {
      return;
    }

    if (permission === 'denied') {
      this.chatToastController.show('Desktop alerts are blocked. Allow them in browser site settings.', 5000);
      return;
    }

    if (permission === 'unsupported') {
      this.chatToastController.show('This browser does not support desktop alerts.', 5000);
    }
  },

  syncChatToggleButton() {
    const button = this.elements.chatToggleButton;
    const badge = this.elements.chatToggleBadge;
    if (!button) {
      return;
    }

    const hasUnread = this.chatUnreadCount > 0;
    const shouldEmphasizeUnread = hasUnread && !this.chatIsOpen;

    button.classList.toggle('is-active', this.chatIsOpen);
    button.classList.toggle('is-unread', shouldEmphasizeUnread);
    button.setAttribute('aria-expanded', String(this.chatIsOpen));
    button.setAttribute(
      'aria-label',
      hasUnread ? `Open team chat, ${this.chatUnreadCount} unread` : 'Open team chat',
    );
    button.title = this.chatUnreadCount > 0
      ? `Team chat (${this.chatUnreadCount} unread)`
      : 'Team chat';

    if (!badge) {
      return;
    }

    badge.classList.toggle('hidden', !hasUnread);
    badge.textContent = this.chatUnreadCount > 9 ? '9+' : String(this.chatUnreadCount);
  },

  maybeNotifyChatMessage(message) {
    if (!this.chatInitialSyncComplete) {
      return;
    }

    if (!this.isTabActive) {
      return;
    }

    const notification = this.notifications?.show?.({
      body: String(message?.text ?? '').replace(/\s+/g, ' ').trim(),
      onClick: () => {
        window.focus?.();
        notification?.close?.();
        this.openChatPanel();
      },
      tag: `collabmd-chat-${message?.id ?? 'message'}`,
      title: `New message from ${message?.userName || 'Someone'}`,
    });
    if (notification || this.chatIsOpen) {
      return;
    }

    (this.chatToastController ?? this.toastController).show(this.formatChatToastMessage(message), 4000);
  },
};
