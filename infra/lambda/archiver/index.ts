import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { archive } from "./handler.js";

const BUCKET_NAME = process.env["DATA_BUCKET_NAME"];
if (!BUCKET_NAME) throw new Error("DATA_BUCKET_NAME env var not set");

const s3 = new S3Client({});

async function listSessionFolders(): Promise<Array<{ date: string; session_id: string }>> {
  const folders: Array<{ date: string; session_id: string }> = [];
  let dateToken: string | undefined;
  // List date "folders" first (CommonPrefixes under raw/sessions/).
  do {
    const dateRes = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: "raw/sessions/",
        Delimiter: "/",
        ContinuationToken: dateToken,
      }),
    );
    dateToken = dateRes.IsTruncated ? dateRes.NextContinuationToken : undefined;
    for (const cp of dateRes.CommonPrefixes ?? []) {
      const datePrefix = cp.Prefix; // raw/sessions/2026-05-24/
      if (!datePrefix) continue;
      const date = datePrefix.split("/")[2];
      if (!date) continue;
      // Now list session subfolders under this date.
      let sToken: string | undefined;
      do {
        const sRes = await s3.send(
          new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: datePrefix,
            Delimiter: "/",
            ContinuationToken: sToken,
          }),
        );
        sToken = sRes.IsTruncated ? sRes.NextContinuationToken : undefined;
        for (const sp of sRes.CommonPrefixes ?? []) {
          const sessionPrefix = sp.Prefix; // raw/sessions/2026-05-24/11291/
          if (!sessionPrefix) continue;
          const session_id = sessionPrefix.split("/")[3];
          if (!session_id) continue;
          folders.push({ date, session_id });
        }
      } while (sToken);
    }
  } while (dateToken);
  return folders;
}

export async function handler(): Promise<{ ok: boolean; result: unknown }> {
  const metrics: Array<{ name: string; value: number; dim?: Record<string, string> }> = [];

  const result = await archive({
    listActiveSessionFolders: listSessionFolders,
    listParts: async (Prefix) => {
      const out: Array<{ key: string; lastModified: Date; size: number }> = [];
      let token: string | undefined;
      do {
        const res = await s3.send(
          new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix, ContinuationToken: token }),
        );
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
        for (const o of res.Contents ?? []) {
          if (o.Key && o.LastModified) {
            out.push({ key: o.Key, lastModified: o.LastModified, size: o.Size ?? 0 });
          }
        }
      } while (token);
      return out;
    },
    objectExists: async (Key) => {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key }));
        return true;
      } catch {
        return false;
      }
    },
    getObjectText: async (Key) => {
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key }));
      return (await res.Body?.transformToString()) ?? "";
    },
    putObject: async (Key, Body) => {
      await s3.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key, Body }));
    },
    deleteObjects: async (keys) => {
      // S3 DeleteObjects supports up to 1000 keys per call.
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET_NAME,
            Delete: { Objects: chunk.map((Key) => ({ Key })) },
          }),
        );
      }
    },
    now: () => new Date(),
    emitMetric: (name, value, dim) => metrics.push({ name, value, dim }),
  });

  console.log(JSON.stringify({ level: "info", msg: "archiver.tick", result, metrics }));
  return { ok: true, result };
}
