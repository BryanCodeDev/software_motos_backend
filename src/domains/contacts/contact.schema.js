const { z } = require('zod');

const contactSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'El nombre es requerido').max(100),
    relationship: z.string().max(50).optional(),
    phone: z.string().max(30).optional().nullable(),
    email: z.string().email('Correo inválido').max(255).optional().nullable(),
    is_public: z.boolean().optional(),
    display_phone: z.boolean().optional(),
    display_email: z.boolean().optional(),
    priority_order: z.number().int().min(0).optional(),
  }),
});

module.exports = { contactSchema };

