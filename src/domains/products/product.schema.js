const { z } = require('zod');

const productSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100),
    slug: z.string().trim().min(2).max(120).optional(),
    description: z.string().optional().nullable(),
    price: z.coerce.number().nonnegative().optional(),
    currency: z.string().length(3).optional().default('COP'),
    is_active: z.boolean().optional(),
    is_purchasable: z.boolean().optional(),
    is_visible: z.boolean().optional(),
    variant_options: z.string().optional().nullable(),
    sort_order: z.coerce.number().int().optional(),
  }),
});

module.exports = { productSchema };

