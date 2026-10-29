const { z } = require('zod');

const profileSchema = z.object({
  body: z.object({
    display_name: z
      .string()
      .trim()
      .min(2, 'El nombre debe tener al menos 2 caracteres')
      .max(100)
      .optional(),
    photo_url: z
      .string()
      .max(500, 'La URL de la fotografía es demasiado larga')
      .optional()
      .nullable(),
    blood_type: z.string().max(10).optional().nullable(),
    allergies: z.string().max(2000).optional().nullable(),
    medical_conditions: z.string().max(2000).optional().nullable(),
    medications: z.string().max(2000).optional().nullable(),
    additional_info: z.string().max(2000).optional().nullable(),
    emergency_note: z.string().max(255).optional().nullable(),
  }),
});

const photoUploadSchema = z.object({
  body: z.object({
    photo_data: z.string().optional().nullable(),
  }),
});

const privacySchema = z.object({
  body: z.object({
    settings: z.record(z.boolean()),
  }),
});

module.exports = { profileSchema, privacySchema, photoUploadSchema };

