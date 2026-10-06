// One JSON line per event, same shape as the request logger, for code that
// runs outside a request (the background worker).
export function log(level, message, fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}
