const { z } = require('zod');

const commonPersonFields = {
  display_name: z.string().trim().min(2).max(100).optional(),
  photo_url: z.string().max(500).optional().nullable(),
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
};

const commonFields = {
  profile_type: z.enum(['person', 'pet', 'managed_person']).optional(),
  relationship: z.string().max(50).optional().nullable(),
  is_managed_by_third_party: z.boolean().optional().nullable(),
  consent_accepted: z.boolean().optional().nullable(),
};

const petFields = {
  pet_species: z.string().max(50).optional().nullable(),
  pet_breed: z.string().max(100).optional().nullable(),
  pet_age: z.string().max(30).optional().nullable(),
  pet_birth_date: z.string().optional().nullable(),
  pet_sex: z.enum(['macho', 'hembra', 'no_especificado']).optional().nullable(),
  pet_weight: z.coerce.number().min(0.1).max(1000).optional().nullable(),
  pet_color: z.string().max(60).optional().nullable(),
  pet_characteristics: z.string().max(2000).optional().nullable(),
  pet_microchip: z.string().max(80).optional().nullable(),
  pet_sterilized: z.boolean().optional().nullable(),
  pet_vaccines: z.string().max(2000).optional().nullable(),
  pet_allergies: z.string().max(2000).optional().nullable(),
  pet_medications: z.string().max(2000).optional().nullable(),
  pet_conditions: z.string().max(2000).optional().nullable(),
  pet_vet_name: z.string().max(150).optional().nullable(),
  pet_vet_phone: z.string().max(30).optional().nullable(),
  pet_owner_name: z.string().max(150).optional().nullable(),
  pet_owner_phone: z.string().max(30).optional().nullable(),
  pet_alternate_contacts: z.string().max(2000).optional().nullable(),
  pet_care_instructions: z.string().max(2000).optional().nullable(),
  pet_lost: z.boolean().optional().nullable(),
  pet_reward: z.string().max(200).optional().nullable(),
};

const profileCreateSchema = z.object({
  body: z.object({
    ...commonFields,
    ...commonPersonFields,
    ...petFields,
  }).refine((data) => {
    if (data.profile_type === 'managed_person' && data.is_managed_by_third_party && !data.consent_accepted) {
      return false;
    }
    return true;
  }, {
    message: 'Se requiere consentimiento para perfiles gestionados por terceros',
    path: ['consent_accepted'],
  }),
});

const profileUpdateSchema = z.object({
  body: z.object({
    ...commonFields,
    ...commonPersonFields,
    ...petFields,
  }),
});

const photoUploadSchema = z.object({
  body: z.object({
    profile_id: z.string().uuid().optional(),
    photo_data: z.string().optional().nullable(),
  }),
});

const privacySchema = z.object({
  body: z.object({
    settings: z.record(z.boolean()),
  }),
});

module.exports = {
  profileCreateSchema,
  profileUpdateSchema,
  photoUploadSchema,
  privacySchema,
};
