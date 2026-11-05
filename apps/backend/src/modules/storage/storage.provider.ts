import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Private file storage for driver documents. Files are NEVER served by a public URL:
 * the API streams them only to authorised admins, and every download is audited.
 */
export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/** DEVELOPMENT/TEST: files on local disk. Refused in production by config validation. */
export class LocalDiskStorage implements StorageProvider {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    if (!/^[a-z0-9/-]+$/i.test(key)) throw new Error('invalid storage key');
    const full = resolve(join(this.root, key));
    // Blocks "../" path traversal even if a key were ever built from unexpected input.
    if (!full.startsWith(this.root + sep)) throw new Error('storage key escapes root');
    return full;
  }

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, data, { mode: 0o600, flag: 'wx' }); // never overwrite an existing file
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

export interface S3StorageOptions {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** For S3-compatible services (Supabase Storage, Cloudflare R2, MinIO). Omit for AWS. */
  endpoint?: string;
  /** Supabase and MinIO need path-style URLs (endpoint/bucket/key). */
  forcePathStyle: boolean;
  /** Ask the service to encrypt at rest with its own keys (AWS, R2). Some services reject it. */
  serverSideEncryption: boolean;
}

/**
 * S3-compatible PRIVATE storage for driver documents (a private Supabase Storage bucket, Cloudflare
 * R2 or AWS S3). The bucket must not allow public access; the API reads files with its own
 * credentials and never hands out bucket URLs.
 *
 * Tested against an S3 emulator (moto) in `storage.s3.int-spec.ts`; NOT yet verified against the
 * real bucket, which needs owner action OA-12.
 */
export class S3Storage implements StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly opts: S3StorageOptions) {
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      maxAttempts: 3,
    });
  }

  private checkKey(key: string): string {
    if (!/^[a-z0-9/-]+$/i.test(key) || key.includes('//') || key.startsWith('/')) {
      throw new Error('invalid storage key');
    }
    return key;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: this.checkKey(key),
        Body: data,
        ContentType: contentType,
        ...(this.opts.serverSideEncryption ? { ServerSideEncryption: 'AES256' as const } : {}),
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.checkKey(key) }),
    );
    if (!res.Body) throw new Error('empty object');
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.checkKey(key) }),
    );
  }
}

/** Accepted document formats, identified by their first bytes — never by the file name or client header. */
export function sniffDocumentType(
  data: Buffer,
): 'image/jpeg' | 'image/png' | 'application/pdf' | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg';
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  return null;
}

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
