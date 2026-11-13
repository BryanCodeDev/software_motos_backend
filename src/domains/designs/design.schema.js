const { z } = require('zod');

const designParamsSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

const designQuerySchema = z.object({
  query: z.object({
    product_id: z.coerce.number().int().positive().optional(),
  }),
});

const updateDesignSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    slug: z.string().trim().min(2).max(120).optional(),
    description: z.string().optional().nullable(),
    image_url: z.string().url().optional().nullable(),
    is_available: z.boolean().optional(),
    sort_order: z.coerce.number().int().optional(),
  }),
});

module.exports = {
  designParamsSchema,
  designQuerySchema,
  updateDesignSchema,
};
