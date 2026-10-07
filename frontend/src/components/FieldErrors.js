// Turns a VALIDATION_ERROR's details ([{ field, message }]) into
// { email: 'Invalid email address', … } for showing under each input.
export function fieldErrors(error) {
  if (error?.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) return {};
  return Object.fromEntries(error.details.map((d) => [d.field, d.message]));
}
