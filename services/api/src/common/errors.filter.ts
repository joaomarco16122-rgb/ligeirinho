import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
@Catch()
export class ErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorsFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (error instanceof HttpException)
      return response.status(error.getStatus()).json(error.getResponse());
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const status =
        error.code === 'P2025' ? 404 : error.code === 'P2002' || error.code === 'P2003' ? 409 : 500;
      return response.status(status).json({
        statusCode: status,
        message:
          status === 404
            ? 'Registro não encontrado.'
            : status === 409
              ? 'Dados em conflito com um registro existente.'
              : 'Não foi possível concluir a operação.',
      });
    }
    this.logger.error(
      JSON.stringify({
        event: 'request_failed',
        error: error instanceof Error ? error.name : 'unknown',
      }),
    );
    return response
      .status(500)
      .json({ statusCode: 500, message: 'Não foi possível concluir a operação. Tente novamente.' });
  }
}
