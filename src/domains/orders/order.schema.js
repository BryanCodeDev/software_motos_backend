const { z } = require('zod');

const orderSchema = z.object({
  body: z.object({
    product_id: z.coerce.number().int().positive(),
    variant_id: z.coerce.number().int().positive().optional().nullable(),
    shipping_address: z.object({}).optional().nullable(),
    customization: z.object({}).optional().nullable(),
  }),
});

module.exports = { orderSchema };

