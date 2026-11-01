import { BadRequestException } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new BadRequestException({ message: 'Validation failed', issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return r.data;
}
