const { z } = require('zod');

const orderSchema = z.object({
  body: z.object({
    product_id: z.coerce.number().int().positive(),
    design_id: z.coerce.number().int().positive().optional(),
    variant_id: z.coerce.number().int().positive().optional(),
    shipping_address: z.record(z.any()).optional().nullable(),
    customization: z.record(z.any()).optional().nullable(),
  }),
});

const stickerOrderSchema = z.object({
  body: z.object({
    design_id: z.coerce.number().int().positive(),
  }),
});

const packageOrderSchema = z.object({
  body: z.object({
    package_id: z.coerce.number().int().positive().optional(),
    profile_ids: z.array(z.coerce.number().int().positive()).optional(),
    new_profiles: z.array(z.object({
      profile_type: z.enum(['person', 'pet', 'managed_person']).optional().default('person'),
      relationship: z.string().max(50).optional().nullable(),
      display_name: z.string().trim().min(2).max(100).optional().default(''),
      is_managed_by_third_party: z.boolean().optional().default(false),
      consent_accepted: z.boolean().optional().default(false),
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
      pet_lost: z.boolean().optional().default(false),
      pet_reward: z.string().max(200).optional().nullable(),
    })).optional(),
    shipping_address: z.record(z.any()).optional().nullable(),
    customization: z.record(z.any()).optional().nullable(),
  }).refine((data) => {
    const hasPackage = Boolean(data.package_id);
    const hasProfiles = Boolean(data.profile_ids && data.profile_ids.length > 0);
    const hasNewProfiles = Boolean(data.new_profiles && data.new_profiles.length > 0);
    return hasPackage && (hasProfiles || hasNewProfiles);
  }, {
    message: 'Se requiere package_id y al menos un perfil (existente o nuevo)',
    path: ['package_id'],
  }),
});

module.exports = {
  orderSchema,
  stickerOrderSchema,
  packageOrderSchema,
};
