const { z } = require('zod');

const emailSchema = z.string().email('Correo inválido');
const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128, 'La contraseña es demasiado larga');

const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(100),
    email: emailSchema,
    password: passwordSchema,
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(1, 'La contraseña es requerida'),
  }),
});

const forgotPasswordSchema = z.object({
  body: z.object({
    email: emailSchema,
  }),
});

const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Token requerido'),
    password: passwordSchema,
  }),
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};

