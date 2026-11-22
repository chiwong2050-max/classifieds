'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const { shortId } = require('../utils/helpers');

function ensureUploadDir() {
  if (!fs.existsSync(config.uploads.dir)) {
    fs.mkdirSync(config.uploads.dir, { recursive: true });
  }
  return config.uploads.dir;
}

/** Derive the thumbnail filename from a stored image filename. */
function thumbFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  return `${base}-thumb.webp`;
}

/**
 * Resize + compress an uploaded image to WebP (main + thumbnail).
 * @param {Buffer} buffer raw uploaded bytes
 * @param {number} position ordering index
 * @returns {Promise<{filename:string,width:number,height:number,bytes:number,position:number}>}
 */
async function processImage(buffer, position = 0) {
  ensureUploadDir();
  const name = `${Date.now().toString(36)}-${shortId(6)}`;
  const mainFile = `${name}.webp`;
  const thumbFile = thumbFilename(mainFile);

  const pipeline = sharp(buffer, { failOn: 'none' }).rotate(); // respect EXIF orientation
  const meta = await pipeline.metadata();

  const maxWidth = Math.min(config.uploads.maxWidth, meta.width || config.uploads.maxWidth);
  const main = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: config.uploads.webpQuality })
    .toBuffer({ resolveWithObject: true });

  await fs.promises.writeFile(path.join(config.uploads.dir, mainFile), main.data);

  const thumb = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 480, height: 360, fit: 'cover', position: 'centre' })
    .webp({ quality: 72 })
    .toBuffer();
  await fs.promises.writeFile(path.join(config.uploads.dir, thumbFile), thumb);

  return {
    filename: mainFile,
    width: main.info.width,
    height: main.info.height,
    bytes: main.info.size,
    position,
  };
}

/** Process an array of multer file objects, capped at the configured limit. */
async function processUploads(files = []) {
  const capped = files.slice(0, config.uploads.maxImages);
  const results = [];
  for (let i = 0; i < capped.length; i += 1) {
    try {
      results.push(await processImage(capped[i].buffer, i));
    } catch (err) {
      // Skip unreadable images rather than failing the whole submission.
      console.warn(`[images] skipped an upload: ${err.message}`);
    }
  }
  return results;
}

/** Best-effort delete of an image and its thumbnail from disk. */
async function removeImage(filename) {
  if (!filename) return;
  const targets = [filename, thumbFilename(filename)];
  for (const t of targets) {
    await fs.promises.rm(path.join(config.uploads.dir, path.basename(t)), { force: true }).catch(() => {});
  }
}

module.exports = { ensureUploadDir, processImage, processUploads, thumbFilename, removeImage };
