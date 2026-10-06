import busboy from 'busboy';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../errors.js';
import { removeFile } from './uploadStorage.js';

// Room for multipart boundaries and part headers on top of the file itself.
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;
const FIELD_NAME = 'file';

const tooLarge = (maxBytes) =>
  new AppError(413, 'FILE_TOO_LARGE', `File is larger than ${Math.floor(maxBytes / 1024 / 1024)} MB`);

// Streams exactly one multipart file field named "file" to a temp file,
// counting bytes and computing SHA-256 as it goes. Nothing is held in memory.
// On any failure (limits, bad multipart, client disconnect) the temp file is
// deleted before the error is thrown.
export async function receiveSingleFile(req, { maxBytes, tmpDir }) {
  // Honest clients declare the size up front: reject before reading a byte.
  const declaredBytes = Number(req.get('content-length'));
  if (declaredBytes > maxBytes + MULTIPART_OVERHEAD_BYTES) {
    req.res.set('Connection', 'close');
    throw tooLarge(maxBytes);
  }

  let parser;
  try {
    // files: 1 + fields: 0 = exactly one file and nothing else.
    // busboy fires its limits when a count *reaches* the limit, not when it
    // goes over. So: no `parts` limit (parts: 1 would reject the one
    // legitimate file), and fileSize is maxBytes + 1 so 'limit' only fires
    // once a byte beyond maxBytes actually arrives — a file of exactly
    // maxBytes is allowed.
    parser = busboy({
      headers: req.headers,
      limits: { files: 1, fields: 0, fileSize: maxBytes + 1 },
    });
  } catch {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected a multipart/form-data upload');
  }

  const tempPath = path.join(tmpDir, randomUUID());
  let fileStream = null;
  let fileWritten = null;

  try {
    return await new Promise((resolve, reject) => {
      parser.on('file', (fieldName, stream, info) => {
        fileStream = stream;

        if (fieldName !== FIELD_NAME) {
          stream.resume(); // discard it
          return reject(new AppError(400, 'UNEXPECTED_FIELD', `Send the file in a field named "${FIELD_NAME}"`));
        }

        const originalFilename = cleanFilename(info.filename);
        // The extension only declares which checks to run; the content checks
        // afterwards must agree with it, so a renamed file can't slip through.
        const format = formatFromFilename(originalFilename);
        if (format instanceof AppError) {
          stream.resume();
          return reject(format);
        }

        const hash = createHash('sha256');
        let sizeBytes = 0;
        const meter = new Transform({
          transform(chunk, encoding, callback) {
            sizeBytes += chunk.length;
            hash.update(chunk);
            callback(null, chunk);
          },
        });

        // busboy stops passing data once fileSize is exceeded and emits 'limit'.
        stream.on('limit', () => reject(tooLarge(maxBytes)));

        // 'wx' = create, and fail if the file somehow already exists.
        fileWritten = pipeline(stream, meter, createWriteStream(tempPath, { flags: 'wx' }))
          .then(() => ({ tempPath, sizeBytes, sha256: hash.digest('hex'), originalFilename, format }));
        fileWritten.catch(reject);
      });

      parser.on('filesLimit', () => reject(new AppError(400, 'TOO_MANY_FILES', 'Upload exactly one file')));
      parser.on('fieldsLimit', () => reject(new AppError(400, 'UNEXPECTED_FIELD', 'Only a file may be sent')));
      parser.on('error', () => reject(new AppError(400, 'MALFORMED_UPLOAD', 'Upload body is not valid multipart data')));

      parser.on('close', () => {
        if (!fileWritten) return reject(new AppError(400, 'NO_FILE', `No file found in field "${FIELD_NAME}"`));
        fileWritten.then(resolve, reject);
      });

      // The client disconnected before sending the whole body (network drop,
      // closed tab). `complete` is true only if every byte arrived.
      req.on('close', () => {
        if (!req.complete) reject(new AppError(400, 'UPLOAD_ABORTED', 'Upload was interrupted'));
      });

      req.pipe(parser);
    });
  } catch (err) {
    // Stop writing, wait until the write stream has fully closed (so it can't
    // re-create the file after we delete it), then delete the partial file.
    fileStream?.destroy();
    await fileWritten?.catch(() => {});
    await removeFile(tempPath);
    throw err;
  }
}

const FORMAT_BY_EXTENSION = { '.csv': 'csv', '.xlsx': 'xlsx' };

function formatFromFilename(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.xls') {
    return new AppError(
      415,
      'LEGACY_OR_PROTECTED_WORKBOOK',
      'Old .xls files are not supported. Open it in Excel or LibreOffice and save it as .xlsx or CSV.',
    );
  }
  return (
    FORMAT_BY_EXTENSION[extension] ??
    new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only .csv and .xlsx files are supported')
  );
}

// The name is only ever displayed, never used as a path. Strip any directory
// part (both / and \), control characters, and cap the length.
function cleanFilename(name) {
  const base = String(name ?? '').split(/[\\/]/).pop();
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 255);
  return cleaned || 'upload';
}
