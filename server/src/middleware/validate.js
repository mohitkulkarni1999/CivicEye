import { ApiError } from '../utils/ApiError.js';

export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(ApiError.badRequest('Validation failed', details));
    }
    if (source === 'query') {
      Object.assign(req.query, result.data);
    } else {
      req[source] = result.data;
    }
    return next();
  };
}
