import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastController } from '../../src/client/presentation/toast-controller.js';

describe('ToastController lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="toasts"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('removes a leaving toast when its CSS transition ends', () => {
    const controller = new ToastController(document.getElementById('toasts'));
    const toast = controller.show('Saved', 10);

    vi.advanceTimersByTime(10);
    expect(toast).toHaveClass('leaving');
    toast.dispatchEvent(new Event('transitionend'));

    expect(toast).not.toBeInTheDocument();
  });

  it('removes a leaving toast after a bounded fallback when no event fires', () => {
    const controller = new ToastController(document.getElementById('toasts'));
    const toast = controller.show('Saved', 10);

    vi.advanceTimersByTime(10);
    vi.advanceTimersByTime(400);

    expect(toast).not.toBeInTheDocument();
  });

  it('removes without waiting for motion when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const controller = new ToastController(document.getElementById('toasts'));
    const toast = controller.show('Saved', 10);

    vi.advanceTimersByTime(10);
    expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    vi.runOnlyPendingTimers();

    expect(toast).not.toBeInTheDocument();
  });
});
