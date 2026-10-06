import { AppError } from '../errors.js';

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return next(validationError('Invalid request body', result.error));

    req.body = result.data;
    next();
  };
}

// In Express 5 `req.query` is read-only, so the cleaned values go on
// `req.validatedQuery` instead. Handlers must read from there.
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(validationError('Invalid query parameters', result.error));

    req.validatedQuery = result.data;
    next();
  };
}

function validationError(message, zodError) {
  const details = zodError.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}
