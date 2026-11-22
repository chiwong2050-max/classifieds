'use strict';

const multer = require('multer');
const config = require('../config');

/**
 * Multer in-memory upload handler. Files are held in memory then handed to
 * sharp for resize/compress to WebP before touching disk.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploads.maxFileSizeBytes,
    files: config.uploads.maxImages,
  },
  fileFilter(req, file, cb) {
    const ok = /^image\/(jpeg|png|webp|gif|avif|heic|heif|tiff)$/i.test(file.mimetype);
    if (ok) return cb(null, true);
    // Tag the error with status 400 so the post route can re-render the form
    // with a helpful message instead of surfacing a generic 500.
    const err = new Error('Only image uploads are allowed.');
    err.status = 400;
    return cb(err, false);
  },
});

module.exports = { upload };
