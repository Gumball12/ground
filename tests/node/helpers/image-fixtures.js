import sharp from 'sharp';

export async function createImageBuffer(format = 'png') {
  const image = sharp({
    create: {
      background: { alpha: 1, b: 42, g: 23, r: 15 },
      channels: 4,
      height: 2,
      width: 2,
    },
  });

  if (format === 'jpeg') {
    return image.jpeg().toBuffer();
  }

  if (format === 'webp') {
    return image.webp().toBuffer();
  }

  return image.png().toBuffer();
}

export async function createOrientedJpegBuffer() {
  return sharp({
    create: {
      background: { alpha: 1, b: 42, g: 23, r: 15 },
      channels: 3,
      height: 3,
      width: 2,
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}
