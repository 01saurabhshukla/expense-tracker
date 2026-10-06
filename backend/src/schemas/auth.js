import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email());

export const signupSchema = z.object({
  email,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
      message: 'Password is too long (max 72 bytes; non-English characters use 2-4 bytes each)',
    }),
  name: z.string().trim().min(1).max(100),
});

// No length rules here: if the signup rules ever change, existing users must
// still be able to log in with the password they chose under the old rules.
export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});
