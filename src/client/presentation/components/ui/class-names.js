export function classNames(...parts) {
  return parts.flat().flatMap((part) => (
    part && typeof part === 'object'
      ? Object.keys(part).filter((className) => part[className])
      : part || []
  )).join(' ');
}
