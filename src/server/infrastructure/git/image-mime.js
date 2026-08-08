const IMAGE_MIME_TYPES = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});

export function getImageMimeType(filePath) {
  const normalizedPath = String(filePath ?? '').toLowerCase();
  const extension = Object.keys(IMAGE_MIME_TYPES).find((candidate) => normalizedPath.endsWith(candidate));
  return extension ? IMAGE_MIME_TYPES[extension] : 'application/octet-stream';
}
