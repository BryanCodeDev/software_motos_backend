const { z } = require('zod');

const packageCreateSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().min(2).max(120).optional(),
    description: z.string().optional().nullable(),
    line: z.enum(['person', 'pet', 'combo']).optional().default('person'),
    profile_count: z.coerce.number().int().min(1).max(50).optional().default(1),
    sticker_count: z.coerce.number().int().min(0).max(200).optional().default(0),
    price: z.coerce.number().min(0).max(10000000),
    currency: z.string().length(3).optional().default('COP'),
    original_price: z.coerce.number().min(0).max(10000000).optional().nullable(),
    discount_percent: z.coerce.number().min(0).max(100).optional().nullable(),
    is_active: z.boolean().optional().default(true),
    is_visible: z.boolean().optional().default(true),
    sort_order: z.coerce.number().int().optional().default(0),
    valid_from: z.string().optional().nullable(),
    valid_to: z.string().optional().nullable(),
  }),
});

const packageUpdateSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().optional().nullable(),
    line: z.enum(['person', 'pet', 'combo']).optional(),
    profile_count: z.coerce.number().int().min(1).max(50).optional(),
    sticker_count: z.coerce.number().int().min(0).max(200).optional(),
    price: z.coerce.number().min(0).max(10000000).optional(),
    currency: z.string().length(3).optional(),
    original_price: z.coerce.number().min(0).max(10000000).optional().nullable(),
    discount_percent: z.coerce.number().min(0).max(100).optional().nullable(),
    is_active: z.boolean().optional(),
    is_visible: z.boolean().optional(),
    sort_order: z.coerce.number().int().optional(),
    valid_from: z.string().optional().nullable(),
    valid_to: z.string().optional().nullable(),
  }),
});

const packageProfilesSchema = z.object({
  body: z.array(
    z.object({
      profile_type: z.enum(['person', 'pet']).optional().default('person'),
      quantity_profiles: z.coerce.number().int().min(1).max(50).optional().default(1),
      stickers_per_profile: z.coerce.number().int().min(0).max(20).optional().default(2),
    })
  ).min(1),
});

module.exports = {
  packageCreateSchema,
  packageUpdateSchema,
  packageProfilesSchema,
};
