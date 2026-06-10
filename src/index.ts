import { Readable } from 'node:stream'
import { ContainerClient } from '@azure/storage-blob'
import type { BlobItem } from '@azure/storage-blob'
import { S3Client, HeadObjectCommand, NotFound } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

export interface AzureOptions {
  connection: string
  container: string
  token?: string
}

export interface AwsOptions {
  bucket: string
  prefix?: string
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
}

export type ProgressEvent =
  | { type: 'page', count: number, continuationToken?: string }
  | { type: 'skip', key: string }
  | { type: 'upload', key: string, size: number }

export interface CopyOptions {
  concurrency?: number
  azure: AzureOptions
  aws: AwsOptions
  onProgress?: (event: ProgressEvent) => void
  containerClient?: ContainerClient
}

export interface CopySummary {
  uploaded: number
  skipped: number
}

export async function copy (options: CopyOptions): Promise<CopySummary> {
  const concurrency = options.concurrency ?? 100

  const container = options.containerClient ??
    new ContainerClient(options.azure.connection, options.azure.container)

  const credentials = options.aws.accessKeyId != null && options.aws.secretAccessKey != null
    ? { accessKeyId: options.aws.accessKeyId, secretAccessKey: options.aws.secretAccessKey }
    : undefined

  const s3 = new S3Client({ region: options.aws.region, credentials })

  const summary: CopySummary = { uploaded: 0, skipped: 0 }
  const inFlight = new Set<Promise<void>>()
  let failure: { error: unknown } | undefined

  try {
    const pages = container.listBlobsFlat().byPage({ continuationToken: options.azure.token })

    for await (const page of pages) {
      options.onProgress?.({
        type: 'page',
        count: page.segment.blobItems.length,
        continuationToken: page.continuationToken === '' ? undefined : page.continuationToken
      })

      for (const blob of page.segment.blobItems) {
        while (inFlight.size >= concurrency) {
          if (failure != null) break
          await Promise.race(inFlight)
        }

        if (failure != null) break

        const task: Promise<void> = transfer(blob).then(
          () => { inFlight.delete(task) },
          (error: unknown) => {
            inFlight.delete(task)
            failure ??= { error }
          }
        )

        inFlight.add(task)
      }

      if (failure != null) break
    }

    await Promise.all(inFlight)

    if (failure != null) throw failure.error

    return summary
  } finally {
    s3.destroy()
  }

  async function transfer (blob: BlobItem): Promise<void> {
    const key = options.aws.prefix != null ? `${options.aws.prefix}/${blob.name}` : blob.name
    const size = blob.properties.contentLength ?? 0

    if (await exists(key, size)) {
      summary.skipped++
      options.onProgress?.({ type: 'skip', key })
      return
    }

    // maxRetryRequests defaults to 0, where any dropped connection mid-download fails the transfer
    const download = await container
      .getBlobClient(blob.name)
      .download(0, undefined, { maxRetryRequests: 5 })

    const body = download.readableStreamBody
    if (body == null) throw new Error(`Azure returned no stream for blob: ${blob.name}`)

    await new Upload({
      client: s3,
      params: {
        Bucket: options.aws.bucket,
        Key: key,
        Body: Readable.from(body)
      }
    }).done()

    summary.uploaded++
    options.onProgress?.({ type: 'upload', key, size })
  }

  async function exists (key: string, size: number): Promise<boolean> {
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: options.aws.bucket, Key: key }))
      return head.ContentLength === size
    } catch (error) {
      if (error instanceof NotFound) return false
      throw error
    }
  }
}
