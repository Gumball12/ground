export class OutlineController {
  constructor({
    mobileBreakpointQuery = window.matchMedia('(max-width: 768px)'),
    onNavigateToHeading,
    onWillOpen,
  } = {}) {
    this.outlineOpen = false;
    this.activeHeadingFrame = null;
    this.activeHeadingId = null;
    this.headings = [];
    this.pinnedHeadingId = null;
    this.pdfOutline = null;
    this.onNavigateToPdfOutline = null;
    this.onNavigateToHeading = onNavigateToHeading;
    this.onWillOpen = onWillOpen;
    this.panel = document.getElementById('outlinePanel');
    this.closeButton = document.getElementById('outlineClose');
    this.navigation = document.getElementById('outlineNav');
    this.previewContainer = document.getElementById('previewContainer');
    this.toggleButton = document.getElementById('outlineToggle');
    this.mobileBreakpointQuery = mobileBreakpointQuery;
    this.handlePreviewScroll = () => this.scheduleActiveHeadingUpdate();
    this.handleDocumentPointerDown = (event) => {
      if (!this.outlineOpen) {
        return;
      }

      const target = event.target;
      if (
        target instanceof Node
        && (
          this.panel?.contains(target)
          || this.toggleButton?.contains(target)
        )
      ) {
        return;
      }

      this.close();
    };
  }

  initialize() {
    this.toggleButton?.addEventListener('click', () => this.toggle());
    this.closeButton?.addEventListener('click', () => this.close());
    document.addEventListener('pointerdown', this.handleDocumentPointerDown);
  }

  toggle() {
    this.setOpenState(!this.outlineOpen);
  }

  close() {
    this.setOpenState(false);
  }

  setOpenState(nextState) {
    if (nextState && !this.outlineOpen) {
      this.onWillOpen?.();
    }

    this.outlineOpen = nextState;
    this.panel?.classList.toggle('hidden', !this.outlineOpen);
    this.toggleButton?.classList.toggle('active', this.outlineOpen);
    this.panel?.setAttribute('aria-hidden', String(!this.outlineOpen));
    this.toggleButton?.setAttribute('aria-expanded', String(this.outlineOpen));

    if (this.outlineOpen) {
      this.refresh();
      return;
    }

    this.cleanup();
  }

  refresh() {
    if (!this.navigation) {
      return;
    }

    if (!this.outlineOpen) {
      this.cleanup();
      return;
    }

    if (this.pdfOutline) {
      this.renderPdfOutline();
      return;
    }

    const previewContent = document.getElementById('previewContent');
    const headings = previewContent?.querySelectorAll('h1, h2, h3, h4, h5, h6') ?? [];

    if (headings.length === 0) {
      this.navigation.innerHTML = '<div class="outline-empty">No headings found</div>';
      this.cleanup();
      return;
    }

    const items = Array.from(headings).map((heading, index) => {
      if (!heading.id) {
        heading.id = `heading-${index}-${heading.textContent.trim().toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40)}`;
      }

      return {
        id: heading.id,
        level: Number.parseInt(heading.tagName[1], 10),
        sourceLine: Number.parseInt(heading.getAttribute('data-source-line') || '', 10),
        text: heading.textContent.trim(),
      };
    });

    this.navigation.innerHTML = items.map((item) => (
      `<button class="outline-item" data-level="${item.level}" data-target="${item.id}"${Number.isFinite(item.sourceLine) ? ` data-source-line="${item.sourceLine}"` : ''} title="${item.text.replace(/"/g, '&quot;')}">${item.text}</button>`
    )).join('');

    this.navigation.querySelectorAll('.outline-item').forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.dataset.target);
        this.navigateToHeading(target, button.dataset.target, { behavior: 'auto' });

        if (this.mobileBreakpointQuery.matches) {
          this.close();
        }
      });
    });

    this.observeHeadings(Array.from(headings));
  }

  setPdfOutline(outline, onNavigate) {
    this.cleanup();
    this.pdfOutline = Array.isArray(outline) && outline.length > 0 ? outline : null;
    this.onNavigateToPdfOutline = this.pdfOutline ? onNavigate : null;
    this.activeHeadingId = null;
    this.toggleButton?.classList.toggle('hidden', !this.pdfOutline);

    if (!this.pdfOutline) {
      this.navigation?.replaceChildren();
      this.close();
      return;
    }

    if (this.outlineOpen) {
      this.renderPdfOutline();
    }
  }

  clearPdfOutline() {
    this.pdfOutline = null;
    this.onNavigateToPdfOutline = null;
    this.activeHeadingId = null;
    this.pinnedHeadingId = null;
    this.navigation?.replaceChildren();
    this.toggleButton?.classList.add('hidden');
    this.close();
  }

  renderPdfOutline() {
    if (!this.navigation || !this.pdfOutline) {
      return;
    }

    this.cleanup();
    this.navigation.replaceChildren();
    const fragment = document.createDocumentFragment();
    let itemIndex = 0;
    const appendItems = (items, level = 1) => {
      items.forEach((item) => {
        if (!item || typeof item !== 'object') {
          return;
        }

        const title = String(item.title ?? '').trim();
        if (title) {
          const id = `pdf-outline-${itemIndex}`;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'outline-item';
          button.dataset.level = String(Math.min(level, 6));
          button.dataset.target = id;
          button.title = title;
          button.textContent = title;
          button.addEventListener('click', () => {
            this.setActiveItem(id, { behavior: 'auto' });
            this.onNavigateToPdfOutline?.(item);
            if (this.mobileBreakpointQuery.matches) {
              this.close();
            }
          });
          fragment.appendChild(button);
          itemIndex += 1;
        }

        if (Array.isArray(item.items)) {
          appendItems(item.items, Math.min(level + 1, 6));
        }
      });
    };

    appendItems(this.pdfOutline);
    if (fragment.childNodes.length === 0) {
      this.navigation.innerHTML = '<div class="outline-empty">No outline found</div>';
      return;
    }

    this.navigation.appendChild(fragment);
  }

  cleanup({ preservePinnedHeading = false } = {}) {
    if (this.activeHeadingFrame) {
      cancelAnimationFrame(this.activeHeadingFrame);
      this.activeHeadingFrame = null;
    }

    this.previewContainer?.removeEventListener('scroll', this.handlePreviewScroll);
    this.headings = [];
    if (!preservePinnedHeading) {
      this.pinnedHeadingId = null;
    }
  }

  setActiveItem(id, { scrollIntoView = true, behavior = 'smooth' } = {}) {
    this.activeHeadingId = id;

    this.navigation?.querySelectorAll('.outline-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.target === id);
    });

    if (scrollIntoView) {
      this.navigation?.querySelector('.outline-item.active')?.scrollIntoView({
        behavior,
        block: 'nearest',
      });
    }
  }

  observeHeadings(headings) {
    this.cleanup({ preservePinnedHeading: true });

    if (!this.previewContainer || headings.length === 0) {
      return;
    }

    this.headings = headings;
    this.previewContainer.addEventListener('scroll', this.handlePreviewScroll, { passive: true });

    const pinnedHeading = this.getPinnedHeading();
    if (pinnedHeading) {
      this.setActiveItem(pinnedHeading.id, {
        behavior: 'auto',
        scrollIntoView: true,
      });
      return;
    }

    this.updateActiveHeading();
  }

  scheduleActiveHeadingUpdate() {
    if (this.activeHeadingFrame) {
      return;
    }

    this.activeHeadingFrame = requestAnimationFrame(() => {
      this.activeHeadingFrame = null;
      this.updateActiveHeading();
    });
  }

  updateActiveHeading() {
    if (!this.previewContainer || this.headings.length === 0) {
      return;
    }

    const pinnedHeading = this.getPinnedHeading();
    if (pinnedHeading && this.shouldKeepPinnedHeadingActive(pinnedHeading)) {
      this.setActiveItem(pinnedHeading.id, {
        behavior: 'auto',
        scrollIntoView: true,
      });
      return;
    }

    this.pinnedHeadingId = null;
    const focusLine = this.previewContainer.scrollTop;
    let activeHeading = this.headings[0];

    for (const heading of this.headings) {
      const headingOffset = this.getHeadingScrollTop(heading);
      if (headingOffset > focusLine) {
        break;
      }

      activeHeading = heading;
    }

    this.setActiveItem(activeHeading.id, {
      behavior: 'auto',
      scrollIntoView: true,
    });
  }

  getHeadingScrollTop(heading) {
    if (!this.previewContainer) {
      return 0;
    }

    const previewRect = this.previewContainer.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    return this.previewContainer.scrollTop + (headingRect.top - previewRect.top);
  }

  getPinnedHeading() {
    if (!this.pinnedHeadingId) {
      return null;
    }

    return this.headings.find((heading) => heading.id === this.pinnedHeadingId) ?? null;
  }

  shouldKeepPinnedHeadingActive(heading) {
    if (!this.previewContainer || !heading?.isConnected) {
      return false;
    }

    const headingTop = this.getHeadingScrollTop(heading) - this.previewContainer.scrollTop;
    const headingBottom = headingTop + heading.getBoundingClientRect().height;
    const activationWindow = this.previewContainer.clientHeight * 0.45;

    return headingBottom > -48 && headingTop < activationWindow;
  }

  notifyHeadingNavigation(target, headingId) {
    if (!target) {
      return;
    }

    const sourceLine = Number.parseInt(target.getAttribute('data-source-line') || '', 10);
    this.onNavigateToHeading?.({
      headingId,
      sourceLine: Number.isFinite(sourceLine) ? sourceLine : null,
    });
  }

  navigateToHeading(target, headingId, { behavior = 'auto' } = {}) {
    if (!target || !headingId) {
      return false;
    }

    this.pinnedHeadingId = headingId;
    this.notifyHeadingNavigation(target, headingId);
    this.scrollHeadingIntoView(target, { behavior });
    this.setActiveItem(headingId, { behavior });
    return true;
  }

  scrollHeadingIntoView(target, { behavior = 'smooth' } = {}) {
    if (!target || !this.previewContainer) {
      return;
    }

    const previewRect = this.previewContainer.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextScrollTop = this.previewContainer.scrollTop + (targetRect.top - previewRect.top);

    this.previewContainer.scrollTo({
      behavior,
      top: Math.max(nextScrollTop, 0),
    });
  }
}
