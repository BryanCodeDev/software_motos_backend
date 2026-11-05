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
    date_of_birth: z.string().optional().nullable(),
    height_cm: z.coerce.number().min(30).max(300).optional().nullable(),
    weight_kg: z.coerce.number().min(1).max(500).optional().nullable(),
    is_pregnant: z.boolean().optional().nullable(),
    medical_devices: z.string().max(2000).optional().nullable(),
    primary_doctor_name: z.string().max(200).optional().nullable(),
    primary_doctor_phone: z.string().max(30).optional().nullable(),
    insurance_company: z.string().max(200).optional().nullable(),
    insurance_policy_number: z.string().max(100).optional().nullable(),
    document_number: z.string().max(50).optional().nullable(),
    is_organ_donor: z.boolean().optional().nullable(),
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

