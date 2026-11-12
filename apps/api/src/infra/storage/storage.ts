import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { AppConfig } from '../../config/app-config.js';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/**
 * Private object storage for document files. Only the API reads and writes it: browsers never
 * get a storage URL. Keys never contain file names or personal data.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Streams the object. Throws if it does not exist. */
  get(key: string): Promise<Readable>;
  /** Development only: create the bucket when missing. */
  ensureReady(): Promise<void>;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: AppConfig['storage']) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
        ...(this.config.sse ? { ServerSideEncryption: this.config.sse } : {}),
      }),
    );
  }

  async get(key: string): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!res.Body) throw new Error('Empty object body');
    return res.Body as Readable;
  }

  async ensureReady(): Promise<void> {
    if (!this.config.createBucket) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }
  }
}

/** Tests only. */
export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<Readable> {
    const found = this.objects.get(key);
    if (!found) return Promise.reject(new Error('NoSuchKey'));
    return Promise.resolve(Readable.from([found.body]));
  }

  ensureReady(): Promise<void> {
    return Promise.resolve();
  }
}

export function createObjectStorage(config: AppConfig['storage']): ObjectStorage {
  return config.driver === 'memory' ? new MemoryObjectStorage() : new S3ObjectStorage(config);
}
