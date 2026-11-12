const { z } = require('zod');

const consentRecordSchema = z.object({
  body: z.object({
    document_type: z.enum(['terms', 'privacy', 'data_processing', 'sensitive_data', 'notifications']),
    document_version: z.string().min(1).max(20).optional().nullable(),
    accepted: z.boolean(),
    purpose: z.string().max(1000).optional().nullable(),
    method: z.enum(['register', 'privacy_center', 'profile_update', 'admin_update']).default('register'),
  }),
});

const dataRequestSchema = z.object({
  body: z.object({
    request_type: z.enum(['access', 'rectification', 'suppression', 'portability', 'revocation', 'consultation']),
    details: z.string().max(2000).optional().nullable(),
  }),
});

const dataRequestResponseSchema = z.object({
  body: z.object({
    status: z.enum(['completed', 'rejected']),
    response: z.string().max(2000).optional().nullable(),
  }),
});

module.exports = { consentRecordSchema, dataRequestSchema, dataRequestResponseSchema };
