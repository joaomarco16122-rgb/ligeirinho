import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';
@Injectable()
export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodTypeAny) {}
  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success)
      throw new BadRequestException({
        message: 'Dados inválidos.',
        errors: result.error.flatten(),
      });
    return result.data;
  }
}
export const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> =>
  new ZodPipe(schema).transform(data) as z.infer<T>;
