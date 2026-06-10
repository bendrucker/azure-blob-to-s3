import { Readable } from 'node:stream'
import { DefaultAzureCredential } from '@azure/identity'
import { ContainerClient } from '@azure/storage-blob'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

export interface AzureOptions {
  account?: string
  container?: string
  token?: string
  client?: BlobContainer
}

export interface AwsOptions {
  bucket: string
  prefix?: string
  region?: string
  client?: S3Client
}

export type ProgressEvent =
  | { type: 'page', count: number, continuationToken?: string }
  | { type: 'skip', key: string }
  | { type: 'upload', key: string, size: number }

export interface BlobSummary {
  name: string
  properties: { contentLength?: number }
}

export interface BlobPage {
  continuationToken?: string
  segment: { blobItems: BlobSummary[] }
}

export interface BlobContainer {
  listBlobsFlat: () => {
    byPage: (settings?: { continuationToken?: string }) => AsyncIterable<BlobPage>
  }
  getBlobClient: (name: string) => {
    download: (
      offset?: number,
      count?: number,
      options?: { maxRetryRequests?: number }
    ) => Promise<{ readableStreamBody?: NodeJS.ReadableStream }>
  }
}

export interface CopyOptions {
  concurrency?: number
  azure: AzureOptions
  aws: AwsOptions
  onProgress?: (event: ProgressEvent) => void
}

export interface CopySummary {
  uploaded: number
  skipped: number
}

function defaultContainer (azure: AzureOptions): BlobContainer {
  const { account, container } = azure
  if (account == null || container == null) {
    throw new TypeError('azure.account and azure.container are required when azure.client is not provided')
  }
  return new ContainerClient(
    `https://${account}.blob.core.windows.net/${container}`,
    new DefaultAzureCredential()
  )
}

export async function copy (options: CopyOptions): Promise<CopySummary> {
  const concurrency = options.concurrency ?? 100
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer')
  }

  const container = options.azure.client ?? defaultContainer(options.azure)

  const ownsS3Client = options.aws.client == null
  const s3 = options.aws.client ?? new S3Client({ region: options.aws.region })

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
    if (ownsS3Client) s3.destroy()
  }

  async function transfer (blob: BlobSummary): Promise<void> {
    const key = options.aws.prefix ? `${options.aws.prefix}/${blob.name}` : blob.name
    const size = blob.properties.contentLength

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
    options.onProgress?.({ type: 'upload', key, size: size ?? 0 })
  }

  async function exists (key: string, size: number | undefined): Promise<boolean> {
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: options.aws.bucket, Key: key }))
      return size != null && head.ContentLength === size
    } catch (error) {
      // instanceof NotFound fails when aws.client comes from a different
      // installed copy of @aws-sdk/client-s3, so match on the error name
      if (error instanceof Error && error.name === 'NotFound') return false
      throw error
    }
  }
}
