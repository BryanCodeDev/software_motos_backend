const { z } = require('zod');

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  design: z.coerce.number().int().positive().optional().nullable(),
  status: z.string().optional().nullable(),
  batch: z.coerce.number().int().positive().optional().nullable(),
  origin: z.enum(['inventory', 'on_demand']).optional().nullable(),
  from: z.string().datetime().optional().nullable(),
  to: z.string().datetime().optional().nullable(),
});

const packageIdSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

const batchIdSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

const createBatchSchema = z.object({
  body: z.object({
    design_id: z.coerce.number().int().positive('Diseño requerido'),
    quantity: z.coerce.number().int().min(1).max(10000).default(1),
    notes: z.string().max(500).optional().nullable(),
  }),
});

const setPackageStatusSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    status: z.enum([
      'available', 'reserved', 'assigned', 'in_production', 'printed',
      'dispatched', 'delivered', 'cancelled', 'retired',
    ]),
  }),
});

const receiveBatchSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    quantity_confirmed: z.coerce.number().int().min(0).optional().default(0),
  }),
});

const exportSchema = z.object({
  query: z.object({
    design: z.coerce.number().int().positive().optional().nullable(),
    origin: z.enum(['inventory', 'on_demand']).optional().nullable(),
    batch: z.coerce.number().int().positive().optional().nullable(),
    status: z.string().optional().nullable(),
    order_id: z.coerce.number().int().positive().optional().nullable(),
    format: z.enum(['csv', 'zip']).default('csv'),
  }),
});

module.exports = {
  paginationSchema,
  packageIdSchema,
  batchIdSchema,
  createBatchSchema,
  setPackageStatusSchema,
  receiveBatchSchema,
  exportSchema,
};
