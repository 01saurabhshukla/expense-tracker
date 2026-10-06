export function requestLogger(req, res, next) {
  const start = performance.now();

  res.on('close', () => {
    const status = res.statusCode;
    const entry = {
      time: new Date().toISOString(),
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status,
      durationMs: Math.round(performance.now() - start),
      aborted: !res.writableFinished,
    };
    console.log(JSON.stringify(entry));
  });

  next();
}
