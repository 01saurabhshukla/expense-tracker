import { AppError } from '../errors.js';

export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

export function errorHandler(err, req, res, next) {
  // A download (CSV/PDF export) that fails after it started sending can't
  // switch to a JSON error any more. Cut the connection instead: the browser
  // then reports a failed download, rather than saving a file that looks
  // complete but is missing rows.
  if (res.headersSent) {
    console.error(JSON.stringify({
      time: new Date().toISOString(),
      level: 'error',
      requestId: req.id,
      message: `Response failed after it started: ${err.message}`,
      stack: err.stack,
    }));
    res.destroy();
    return;
  }

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'MALFORMED_JSON';
    message = 'Request body is not valid JSON';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else {
    console.error(JSON.stringify({
      time: new Date().toISOString(),
      level: 'error',
      requestId: req.id,
      message: err.message,
      stack: err.stack,
    }));
  }

  res.status(status).json({
    error: { status, code, message, details, requestId: req.id },
  });
}
