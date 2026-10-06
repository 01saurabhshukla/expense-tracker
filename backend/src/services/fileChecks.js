import { createReadStream } from 'node:fs';
import { AppError } from '../errors.js';

// Gate ④ for CSV: the file must be real UTF-8 text. This is a safety check,
// not parsing — it says nothing about whether the text is a bank statement.
export async function assertUtf8Text(filePath) {
  // fatal: true makes the decoder throw on any invalid byte sequence instead
  // of silently replacing it with "�".
  const decoder = new TextDecoder('utf-8', { fatal: true });

  try {
    for await (const chunk of createReadStream(filePath)) {
      // NUL bytes never appear in a text CSV; they mean a binary file or a
      // UTF-16 export ("Unicode text" in Excel).
      if (chunk.includes(0)) {
        throw new AppError(400, 'NOT_A_TEXT_FILE', 'File is not a text CSV (save it as "CSV UTF-8")');
      }
      decoder.decode(chunk, { stream: true });
    }
    decoder.decode(); // flush: catches a file that ends halfway through a character
  } catch (err) {
    if (err instanceof TypeError) {
      throw new AppError(400, 'INVALID_ENCODING', 'File is not valid UTF-8 text (save it as "CSV UTF-8")');
    }
    throw err;
  }
}
