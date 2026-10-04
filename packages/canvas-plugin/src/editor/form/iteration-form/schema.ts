import { z } from 'zod';

export const IterationFormSchema = z.object({
  items_ref: z.string().optional(),
  outputs: z
    .array(
      z.object({
        name: z.string(),
        ref: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
});

export type IterationFormSchemaType = z.infer<typeof IterationFormSchema>;
