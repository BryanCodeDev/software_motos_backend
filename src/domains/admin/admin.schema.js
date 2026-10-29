const { z } = require('zod');

const bootstrapAdminSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    token: z.string().min(1, 'Token de bootstrapping requerido'),
  }),
});

module.exports = { bootstrapAdminSchema };

