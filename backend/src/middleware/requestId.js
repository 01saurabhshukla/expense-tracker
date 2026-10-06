import { randomUUID } from 'node:crypto';

const HEADER = 'x-request-id';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestId(req, res, next) {
  const incoming = req.get(HEADER);
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.set(HEADER, req.id);
  next();
}
