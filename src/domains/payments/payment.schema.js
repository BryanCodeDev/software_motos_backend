const { z } = require('zod');

const preferenceSchema = z.object({
  body: z.object({
    order_id: z.coerce.number().int().positive(),
  }),
});

module.exports = { preferenceSchema };

