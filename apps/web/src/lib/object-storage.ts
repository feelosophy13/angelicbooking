/**
 * Cloudflare R2 (S3-compatible object storage) for uploaded files. Two buckets:
 *  - public: pictures shown on the booking page, served straight from a CDN domain;
 *  - private: client form photos and signatures, only ever read through the app after a permission check.
 * Without the R2_* variables everything falls back to storing bytes in Postgres, so local development
 * and tests need no cloud account.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type Visibility = "public" | "private";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBucket: string;
  privateBucket: string;
  /** Where the public bucket is served from, no trailing slash, e.g. https://images.angelicbooking.com */
  publicBaseUrl: string;
  /** Override for tests; defaults to the account's R2 endpoint. */
  endpoint: string;
}

export function r2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const publicBucket = env.R2_PUBLIC_BUCKET;
  const privateBucket = env.R2_PRIVATE_BUCKET;
  const publicBaseUrl = env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !publicBucket || !privateBucket || !publicBaseUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, publicBucket, privateBucket, publicBaseUrl, endpoint: env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com` };
}

let cached: { key: string; client: S3Client } | null = null;
function clientFor(c: R2Config): S3Client {
  const key = `${c.endpoint}|${c.accessKeyId}`;
  if (cached?.key === key) return cached.client;
  const client = new S3Client({
    region: "auto",
    endpoint: c.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    // R2 does not implement the SDK's newer default checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  cached = { key, client };
  return client;
}

const bucketOf = (c: R2Config, v: Visibility) => (v === "public" ? c.publicBucket : c.privateBucket);

export async function putObject(c: R2Config, visibility: Visibility, key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void> {
  await clientFor(c).send(new PutObjectCommand({ Bucket: bucketOf(c, visibility), Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
}

export async function getObject(c: R2Config, visibility: Visibility, key: string): Promise<{ body: Buffer; contentType: string | null } | null> {
  try {
    const out = await clientFor(c).send(new GetObjectCommand({ Bucket: bucketOf(c, visibility), Key: key }));
    if (!out.Body) return null;
    return { body: Buffer.from(await out.Body.transformToByteArray()), contentType: out.ContentType ?? null };
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw e;
  }
}

export async function deleteObject(c: R2Config, visibility: Visibility, key: string): Promise<void> {
  await clientFor(c).send(new DeleteObjectCommand({ Bucket: bucketOf(c, visibility), Key: key }));
}

/** The CDN address of an object in the public bucket. */
export const publicObjectUrl = (c: R2Config, key: string) => `${c.publicBaseUrl}/${key}`;

/** The object key behind a public CDN address, or null when the address is not ours. */
export function keyFromPublicUrl(c: R2Config, url: string | null | undefined): string | null {
  if (!url || !url.startsWith(`${c.publicBaseUrl}/`)) return null;
  return decodeURIComponent(url.slice(c.publicBaseUrl.length + 1).split("?")[0]!);
}
