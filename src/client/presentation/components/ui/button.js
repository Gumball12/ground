import { classNames } from './class-names.js';

/**
 * @typedef {object} ButtonClassOptions
 * @property {'primary'|'secondary'|'danger'|'ghost'} [variant]
 * @property {'md'|'lg'|'compact'} [size]
 * @property {boolean} [toggle]
 * @property {boolean} [toolbar]
 * @property {boolean} [action]
 * @property {boolean} [wide]
 * @property {boolean} [surface]
 * @property {boolean} [pill]
 * @property {boolean} [hidden]
 * @property {boolean} [active]
 * @property {string|string[]} [extra]
 */

/**
 * @param {ButtonClassOptions} [options]
 * @returns {string}
 */
export function buttonClassNames(options = {}) {
  const {
    variant = 'secondary',
    size = 'md',
    toggle = false,
    toolbar = false,
    action = false,
    wide = false,
    surface = false,
    pill = false,
    hidden = false,
    active = false,
    extra = [],
  } = options;

  return classNames(
    'ui-button',
    variant && `ui-button--${variant}`,
    size !== 'md' && `ui-button--${size}`,
    {
      'ui-button--toggle': toggle,
      'ui-button--toolbar': toolbar,
      'ui-button--action': action,
      'ui-button--wide': wide,
      'ui-button--surface': surface,
      'ui-button--pill': pill,
      active,
      hidden,
    },
    extra,
  );
}
