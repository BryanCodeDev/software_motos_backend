const { z } = require('zod');

const shippingAddressSchema = z.object({
  fullName: z.string().min(3, 'Nombre completo requerido'),
  phone: z.string().min(7, 'Teléfono requerido'),
  address: z.string().min(5, 'Dirección requerida'),
  city: z.string().min(2, 'Ciudad requerida'),
  department: z.string().min(2, 'Departamento requerido'),
  postalCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const orderSchema = z.object({
  body: z.object({
    product_id: z.coerce.number().int().positive(),
    variant_id: z.coerce.number().int().positive().optional().nullable(),
    shipping_address: shippingAddressSchema.optional().nullable(),
    customization: z.object({}).optional().nullable(),
  }),
});

module.exports = { orderSchema };

