const { z } = require('zod');

const identifierSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID inválido'),
  }),
});

module.exports = { identifierSchema };

