import { afterEach, describe, expect, it } from 'vitest';

import { uiFeatureTabActivityMethods } from '../../src/client/application/app-shell/ui-feature-tab-activity.js';
import { ImageLightboxController } from '../../src/client/presentation/image-lightbox-controller.js';

function createController() {
  document.body.innerHTML = `
    <div id="preview">
      <img id="preview-image" src="/fixtures/sample-image.png" alt="Sample image">
    </div>
  `;

  const previewElement = document.getElementById('preview');
  const previewImage = document.getElementById('preview-image');
  const controller = new ImageLightboxController({ previewElement });

  return { controller, previewElement, previewImage };
}

function openLightbox({ controller, previewImage }) {
  previewImage.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
  }));

  expect(controller.isOpen).toBe(true);
  expect(controller.overlayRoot.open).toBe(true);
}

function setViewportMetrics(controller, {
  imageHeight = 300,
  imageWidth = 400,
  viewportHeight = 150,
  viewportWidth = 200,
} = {}) {
  Object.defineProperty(controller.viewport, 'clientWidth', {
    configurable: true,
    value: viewportWidth,
  });
  Object.defineProperty(controller.viewport, 'clientHeight', {
    configurable: true,
    value: viewportHeight,
  });
  Object.defineProperty(controller.imageElement, 'offsetWidth', {
    configurable: true,
    value: imageWidth,
  });
  Object.defineProperty(controller.imageElement, 'offsetHeight', {
    configurable: true,
    value: imageHeight,
  });
  controller.viewport.getBoundingClientRect = () => ({
    bottom: viewportHeight,
    height: viewportHeight,
    left: 0,
    right: viewportWidth,
    top: 0,
    width: viewportWidth,
  });

  controller.clampOffsets();
  controller.syncTransform();
}

function dispatchTouchPointer(target, type, {
  clientX,
  clientY,
  pointerId,
} = {}) {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX,
    clientY,
    pointerId,
    pointerType: 'touch',
  }));
}

describe('ImageLightboxController browser behavior', () => {
  let controller;

  afterEach(() => {
    controller?.destroy();
    controller = null;
    document.body.innerHTML = '';
  });

  it('opens modally and restores focus after closing', () => {
    const setup = createController();
    controller = setup.controller;
    setup.previewImage.tabIndex = 0;
    setup.previewImage.focus();

    openLightbox(setup);

    const buttons = Array.from(controller.overlayRoot.querySelectorAll('button:not(:disabled)'));
    expect(document.activeElement).toBe(buttons[0]);

    controller.overlayRoot.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(controller.isOpen).toBe(false);
    expect(document.activeElement).toBe(setup.previewImage);
  });

  it('yields inert ownership to the blocking tab lock', () => {
    const setup = createController();
    controller = setup.controller;
    const overlay = document.createElement('dialog');
    const takeover = document.createElement('button');
    overlay.append(takeover);
    document.body.append(overlay);
    const context = {
      elements: {
        tabLockCopy: document.createElement('p'),
        tabLockOverlay: overlay,
        tabLockTakeoverButton: takeover,
        tabLockTitle: document.createElement('h2'),
      },
    };
    Object.assign(context, uiFeatureTabActivityMethods);

    openLightbox(setup);
    context.showTabLockOverlay({ reason: 'taken-over' });

    expect(controller.isOpen).toBe(false);
    expect(overlay.open).toBe(true);
    expect(document.activeElement).toBe(takeover);
  });

  it('opens the lightbox and updates zoom through the toolbar buttons', () => {
    const setup = createController();
    controller = setup.controller;

    openLightbox(setup);

    const zoomInButton = controller.overlayRoot.querySelector('[aria-label="Zoom in"]');
    const zoomOutButton = controller.overlayRoot.querySelector('[aria-label="Zoom out"]');

    zoomInButton.click();
    expect(controller.scale).toBe(1.25);
    expect(controller.zoomLabel.textContent).toBe('125%');

    zoomOutButton.click();
    expect(controller.scale).toBe(1);
    expect(controller.zoomLabel.textContent).toBe('100%');
  });

  it('uses ctrl-wheel as pinch zoom without changing pan offsets', () => {
    const setup = createController();
    controller = setup.controller;

    openLightbox(setup);
    setViewportMetrics(controller);

    controller.setScale(2);
    controller.offsetX = 50;
    controller.offsetY = 40;
    controller.syncTransform();

    const pinchEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 75,
      ctrlKey: true,
      deltaY: -12,
    });

    controller.viewport.dispatchEvent(pinchEvent);

    expect(pinchEvent.defaultPrevented).toBe(true);
    expect(controller.scale).toBe(2.25);
    expect(controller.offsetX).toBe(50);
    expect(controller.offsetY).toBe(40);
  });

  it('pans a zoomed image for non-pinch wheel gestures and ignores them at base zoom', () => {
    const setup = createController();
    controller = setup.controller;

    openLightbox(setup);
    setViewportMetrics(controller);

    const baseWheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 30,
      deltaY: 20,
    });

    controller.viewport.dispatchEvent(baseWheelEvent);

    expect(baseWheelEvent.defaultPrevented).toBe(false);
    expect(controller.scale).toBe(1);
    expect(controller.offsetX).toBe(0);
    expect(controller.offsetY).toBe(0);

    controller.setScale(2);

    const panWheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 30,
      deltaY: 20,
    });

    controller.viewport.dispatchEvent(panWheelEvent);

    expect(panWheelEvent.defaultPrevented).toBe(true);
    expect(controller.scale).toBe(2);
    expect(controller.offsetX).toBe(-30);
    expect(controller.offsetY).toBe(-20);
  });

  it('supports touch pinch zoom and one-finger pan after pinch', () => {
    const setup = createController();
    controller = setup.controller;

    openLightbox(setup);
    setViewportMetrics(controller);

    dispatchTouchPointer(controller.viewport, 'pointerdown', {
      clientX: 70,
      clientY: 75,
      pointerId: 1,
    });
    dispatchTouchPointer(controller.viewport, 'pointerdown', {
      clientX: 130,
      clientY: 75,
      pointerId: 2,
    });

    dispatchTouchPointer(controller.viewport, 'pointermove', {
      clientX: 40,
      clientY: 75,
      pointerId: 1,
    });
    dispatchTouchPointer(controller.viewport, 'pointermove', {
      clientX: 160,
      clientY: 75,
      pointerId: 2,
    });

    expect(controller.scale).toBe(2);
    expect(controller.offsetX).toBe(0);
    expect(controller.offsetY).toBe(0);

    dispatchTouchPointer(controller.viewport, 'pointerup', {
      clientX: 160,
      clientY: 75,
      pointerId: 2,
    });
    dispatchTouchPointer(controller.viewport, 'pointermove', {
      clientX: 70,
      clientY: 75,
      pointerId: 1,
    });

    expect(controller.offsetX).toBe(30);
    expect(controller.offsetY).toBe(0);

    dispatchTouchPointer(controller.viewport, 'pointerup', {
      clientX: 70,
      clientY: 75,
      pointerId: 1,
    });
  });

  it('moves the image while a pinch gesture shifts its midpoint', () => {
    const setup = createController();
    controller = setup.controller;

    openLightbox(setup);
    setViewportMetrics(controller);

    dispatchTouchPointer(controller.viewport, 'pointerdown', {
      clientX: 70,
      clientY: 75,
      pointerId: 1,
    });
    dispatchTouchPointer(controller.viewport, 'pointerdown', {
      clientX: 130,
      clientY: 75,
      pointerId: 2,
    });

    dispatchTouchPointer(controller.viewport, 'pointermove', {
      clientX: 60,
      clientY: 75,
      pointerId: 1,
    });
    dispatchTouchPointer(controller.viewport, 'pointermove', {
      clientX: 180,
      clientY: 75,
      pointerId: 2,
    });

    expect(controller.scale).toBe(2);
    expect(controller.offsetX).toBe(20);
    expect(controller.offsetY).toBe(0);

    dispatchTouchPointer(controller.viewport, 'pointerup', {
      clientX: 60,
      clientY: 75,
      pointerId: 1,
    });
    dispatchTouchPointer(controller.viewport, 'pointerup', {
      clientX: 180,
      clientY: 75,
      pointerId: 2,
    });
  });
});
