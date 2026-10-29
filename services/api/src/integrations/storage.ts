import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost, PresignedPostOptions } from '@aws-sdk/s3-presigned-post';
import { z } from 'zod';
import { IntegrationUnavailable } from './transport';
const upload = z
  .object({
    deliveryId: z.string().uuid(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'audio/mp4', 'audio/webm']),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  })
  .strict();
export type UploadInput = z.infer<typeof upload>;
export interface UploadPrincipal {
  id: string;
  role: string;
  establishmentId: string | null;
  courierId: string | null;
}
export interface DeliveryUploadAccess {
  id: string;
  establishmentId: string;
  courierId: string | null;
  status: string;
}
export interface UploadPolicy {
  key: string;
  maxBytes: number;
  contentType: UploadInput['contentType'];
  state: 'quarantined';
}
export function authorizeUpload(
  principal: UploadPrincipal,
  delivery: DeliveryUploadAccess,
  input: UploadInput,
  makeId: () => string = randomUUID,
): UploadPolicy {
  const data = upload.parse(input);
  if (
    delivery.id !== data.deliveryId ||
    ['FINALIZADO', 'CANCELADO'].includes(delivery.status) ||
    !delivery.courierId
  )
    throw new Error('Anexo indisponível para este atendimento.');
  const allowed =
    (principal.role === 'ESTABLISHMENT' &&
      principal.establishmentId === delivery.establishmentId) ||
    (principal.role === 'COURIER' && principal.courierId === delivery.courierId);
  if (!allowed) throw new Error('Sem autorização para anexar arquivos a este atendimento.');
  const maxBytes = data.contentType.startsWith('image/') ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
  if (data.sizeBytes > maxBytes) throw new Error('Arquivo excede o limite da categoria.');
  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'audio/mp4': 'm4a',
    'audio/webm': 'webm',
  }[data.contentType];
  // Never use user-supplied filenames/paths, and never serve objects before inspection.
  return {
    key: `quarantine/${delivery.establishmentId}/${delivery.id}/${makeId()}.${extension}`,
    maxBytes,
    contentType: data.contentType,
    state: 'quarantined',
  };
}
export interface UploadAdapter {
  prepare(
    principal: UploadPrincipal,
    delivery: DeliveryUploadAccess,
    input: UploadInput,
  ): Promise<{
    url: string;
    fields: Record<string, string>;
    objectKey: string;
    expiresInSeconds: number;
    state: 'quarantined';
  }>;
}
export type PostSigner = (
  client: S3Client,
  options: PresignedPostOptions,
) => Promise<{ url: string; fields: Record<string, string> }>;
export class S3QuarantineUploads implements UploadAdapter {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly sign: PostSigner = createPresignedPost,
  ) {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('S3_BUCKET inválido.');
  }
  async prepare(principal: UploadPrincipal, delivery: DeliveryUploadAccess, input: UploadInput) {
    const policy = authorizeUpload(principal, delivery, input);
    try {
      const result = await this.sign(this.client, {
        Bucket: this.bucket,
        Key: policy.key,
        Expires: 60,
        Fields: { 'Content-Type': policy.contentType, 'x-amz-meta-delivery-id': delivery.id },
        Conditions: [
          ['content-length-range', 1, policy.maxBytes],
          ['eq', '$Content-Type', policy.contentType],
          ['eq', '$key', policy.key],
          ['eq', '$x-amz-meta-delivery-id', delivery.id],
        ],
      });
      return {
        ...result,
        objectKey: policy.key,
        expiresInSeconds: 60,
        state: 'quarantined' as const,
      };
    } catch {
      throw new IntegrationUnavailable('S3');
    }
  }
}
export function createS3UploadAdapter(env: NodeJS.ProcessEnv): S3QuarantineUploads {
  if (env.STORAGE_PROVIDER !== 's3' || !env.S3_BUCKET || !env.S3_REGION)
    throw new Error(
      'Uploads indisponíveis: configure armazenamento S3 e inspeção antes da publicação.',
    );
  const endpoint = env.S3_ENDPOINT ? new URL(env.S3_ENDPOINT) : undefined;
  if (
    endpoint &&
    (endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.protocol !== 'https:' &&
        !(
          env.NODE_ENV !== 'production' &&
          endpoint.protocol === 'http:' &&
          ['localhost', '127.0.0.1', 'minio'].includes(endpoint.hostname)
        )))
  )
    throw new Error(
      'Endpoint S3 deve usar HTTPS; HTTP somente em serviço local de desenvolvimento.',
    );
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: endpoint?.toString(),
    forcePathStyle: env.S3_FORCE_PATH_STYLE === '1',
  });
  // Uses the SDK credential chain; local signing requires real SDK credentials, not proxy placeholders.
  return new S3QuarantineUploads(client, env.S3_BUCKET);
}
