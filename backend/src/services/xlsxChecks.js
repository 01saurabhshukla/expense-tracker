import yauzl from 'yauzl';
import { open } from 'node:fs/promises';
import { AppError } from '../errors.js';

// An .xlsx is a zip of XML files. A normal bank statement workbook has ~10-20
// entries and a few MB of XML at most.
export const XLSX_LIMITS = {
  maxEntries: 200,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  // XML compresses well (10-30:1 is normal); far beyond that is a zip bomb.
  maxCompressionRatio: 100,
  // Ratios are only meaningful for big entries; tiny ones are bounded by the
  // total limit anyway.
  ratioCheckAboveBytes: 1024 * 1024,
};

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\3\4"
// Old binary .xls files AND password-protected .xlsx files both use this
// "OLE2 compound file" container instead of a zip.
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const REQUIRED_ENTRIES = ['[Content_Types].xml', 'xl/workbook.xml'];

const invalid = () =>
  new AppError(400, 'INVALID_XLSX', 'File is not a valid .xlsx workbook (it may be damaged)');

// Gate ④ for .xlsx. Proves the file is a safe, real .xlsx before anything
// tries to read the spreadsheet itself. This is not parsing: no cell is read.
export async function assertSafeXlsx(filePath) {
  const magic = await readFirstBytes(filePath, OLE2_MAGIC.length);

  if (magic.equals(OLE2_MAGIC)) {
    throw new AppError(
      415,
      'LEGACY_OR_PROTECTED_WORKBOOK',
      'Old .xls and password-protected workbooks are not supported. Save it as .xlsx without a password, or as CSV.',
    );
  }
  if (!magic.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) throw invalid();

  let zip;
  try {
    // strictFileNames: reject entry names with "..", absolute paths or "\".
    // validateEntrySizes: error if an entry decompresses to more (or fewer)
    // bytes than its header claims.
    zip = await yauzl.openPromise(filePath, { strictFileNames: true, validateEntrySizes: true });
  } catch {
    throw invalid();
  }

  try {
    if (zip.entryCount > XLSX_LIMITS.maxEntries) {
      throw new AppError(400, 'XLSX_TOO_COMPLEX', 'Workbook contains too many internal files');
    }

    const names = new Set();
    let declaredTotal = 0;

    for await (const entry of zip.eachEntry()) {
      // Step 1 — check what the entry *claims* (cheap, nothing decompressed).
      if (entry.isEncrypted()) throw invalid();

      declaredTotal += entry.uncompressedSize;
      if (declaredTotal > XLSX_LIMITS.maxTotalUncompressedBytes) {
        throw new AppError(400, 'XLSX_TOO_LARGE', 'Workbook expands to more than 50 MB');
      }

      const ratio = entry.uncompressedSize / Math.max(entry.compressedSize, 1);
      if (entry.uncompressedSize > XLSX_LIMITS.ratioCheckAboveBytes && ratio > XLSX_LIMITS.maxCompressionRatio) {
        throw new AppError(400, 'SUSPICIOUS_COMPRESSION', 'Workbook is compressed suspiciously well (possible zip bomb)');
      }

      names.add(entry.fileName);

      // Step 2 — prove the claim. The sizes above were written by whoever made
      // the file and can lie. Decompress for real, keep nothing; yauzl errors
      // as soon as the output exceeds the declared size, so the work is capped.
      if (!entry.fileName.endsWith('/')) await decompressAndDiscard(zip, entry);
    }

    if (!REQUIRED_ENTRIES.every((name) => names.has(name))) throw invalid();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw invalid(); // corrupt zip, size mismatch, bad entry name, ...
  } finally {
    if (zip.isOpen) zip.close();
  }
}

async function decompressAndDiscard(zip, entry) {
  const stream = await zip.openReadStreamPromise(entry);
  for await (const chunk of stream) {
    // Reading is the check: yauzl throws mid-stream if the size is a lie.
  }
}

async function readFirstBytes(filePath, count) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(count);
    const { bytesRead } = await handle.read(buffer, 0, count, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
