// Shows an API error the way the backend explains it, plus the request id so
// a problem can be found in the server logs.
const FRIENDLY = {
  NETWORK_ERROR: 'Could not reach the server. Check your connection and try again.',
  CORS_ORIGIN_NOT_ALLOWED: 'This site is not allowed to use the API (server configuration).',
};

export function ErrorAlert({ error, title }) {
  if (!error) return null;
  const message = FRIENDLY[error.code] ?? error.message ?? 'Something went wrong.';
  return (
    <div className="alert error" role="alert">
      {title && <strong>{title} </strong>}
      {message}
      {error.requestId && <span className="request-id">Reference: {error.requestId}</span>}
    </div>
  );
}

// fetch() rejects with a TypeError when the network is down or the server is
// unreachable; turn it into something ErrorAlert can show.
export function asApiError(err) {
  if (err?.code) return err;
  return { code: 'NETWORK_ERROR', message: FRIENDLY.NETWORK_ERROR };
}
