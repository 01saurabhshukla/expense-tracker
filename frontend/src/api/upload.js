import { API_URL } from '../config.js';
import { freshAccessToken, refreshSession, toApiError, ApiError } from './client.js';

// Uploads one statement file and reports how many bytes have been sent.
//
// XMLHttpRequest instead of fetch(): fetch can't report upload progress.
//
// Session expiry mid-upload: the backend checks the token BEFORE reading the
// file, so a token only has to be valid when the upload starts. We make sure
// it has at least a minute left (freshAccessToken). If it was rejected
// anyway (TOKEN_EXPIRED), we renew it and send the file once more.
//
// Returns { promise, abort }. The promise resolves to the created upload.
export function uploadStatement(file, { onProgress } = {}) {
  let xhr = null;
  let aborted = false;

  const sendOnce = async () => {
    const token = await freshAccessToken();
    return new Promise((resolve, reject) => {
      xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}/uploads`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status, headers: { 'Content-Type': 'application/json' } }));
      xhr.onerror = () => reject(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'The connection was lost during the upload. Please try again.' }));
      xhr.onabort = () => reject(new ApiError({ status: 0, code: 'ABORTED', message: 'Upload cancelled.' }));
      const form = new FormData();
      form.append('file', file, file.name);
      xhr.send(form);
    });
  };

  const promise = (async () => {
    let res = await sendOnce();
    if (res.status === 401 && !aborted) {
      const err = await toApiError(res.clone());
      if (err.code !== 'TOKEN_EXPIRED') throw err;
      await refreshSession();
      onProgress?.(0);
      res = await sendOnce();
    }
    if (!res.ok) throw await toApiError(res);
    return (await res.json()).upload;
  })();

  return {
    promise,
    abort() {
      aborted = true;
      xhr?.abort();
    },
  };
}
