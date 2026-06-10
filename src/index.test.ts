import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { setImmediate as tick } from 'node:timers/promises'
import { mockClient } from 'aws-sdk-client-mock'
import { S3Client, HeadObjectCommand, PutObjectCommand, NotFound } from '@aws-sdk/client-s3'
import { copy } from './index.ts'
import type { BlobContainer, ProgressEvent } from './index.ts'

const s3 = mockClient(S3Client)

beforeEach(() => {
  s3.reset()
})

// lib-storage's Upload resolves the client region while computing the
// endpoint even though send() is mocked, so tests must set one explicitly
const aws = { bucket: 'bucket', region: 'us-east-1' }

function notFound (): NotFound {
  return new NotFound({ message: 'NotFound', $metadata: {} })
}

interface FakeBlob {
  name: string
  contentLength?: number
}

interface FakeState {
  downloads: string[]
  downloadOptions: Array<{ maxRetryRequests?: number } | undefined>
  continuationToken: string | undefined
  active: number
  maxActive: number
}

function fakeContainer (pages: FakeBlob[][]): { container: BlobContainer, state: FakeState } {
  const state: FakeState = {
    downloads: [],
    downloadOptions: [],
    continuationToken: undefined,
    active: 0,
    maxActive: 0
  }

  const container = {
    listBlobsFlat () {
      return {
        byPage (settings: { continuationToken?: string } = {}) {
          state.continuationToken = settings.continuationToken
          return (async function * () {
            for (const [index, blobs] of pages.entries()) {
              yield {
                continuationToken: index + 1 < pages.length ? `token-${index + 1}` : '',
                segment: {
                  blobItems: blobs.map((blob) => ({
                    name: blob.name,
                    properties: { contentLength: blob.contentLength }
                  }))
                }
              }
            }
          })()
        }
      }
    },
    getBlobClient (name: string) {
      return {
        async download (offset?: number, count?: number, options?: { maxRetryRequests?: number }) {
          state.downloads.push(name)
          state.downloadOptions.push(options)
          state.active++
          state.maxActive = Math.max(state.maxActive, state.active)
          await tick()
          await tick()
          state.active--
          return { readableStreamBody: Readable.from(['data from ' + name]) }
        }
      }
    }
  }

  return { container, state }
}

test('uploads blobs missing from S3', async () => {
  s3.on(HeadObjectCommand).rejects(notFound())
  s3.on(PutObjectCommand).resolves({})

  const { container, state } = fakeContainer([
    [{ name: 'foo', contentLength: 3 }, { name: 'bar', contentLength: 3 }]
  ])

  const events: ProgressEvent[] = []

  const summary = await copy({
    azure: { client: container },
    aws,
    onProgress: (event) => events.push(event)
  })

  assert.deepEqual(summary, { uploaded: 2, skipped: 0 })
  assert.deepEqual(state.downloads.sort(), ['bar', 'foo'])
  assert.deepEqual(state.downloadOptions, [{ maxRetryRequests: 5 }, { maxRetryRequests: 5 }])

  const puts = s3.commandCalls(PutObjectCommand)
  assert.deepEqual(puts.map((put) => put.args[0].input.Bucket), ['bucket', 'bucket'])
  assert.deepEqual(puts.map((put) => put.args[0].input.Key).sort(), ['bar', 'foo'])

  assert.deepEqual(events.filter((event) => event.type === 'page'), [
    { type: 'page', count: 2, continuationToken: undefined }
  ])
  assert.deepEqual(
    events.filter((event) => event.type === 'upload').map((event) => event.key).sort(),
    ['bar', 'foo']
  )
})

test('skips blobs already on S3 with a matching size', async () => {
  s3.on(HeadObjectCommand).resolves({ ContentLength: 3 })

  const { container, state } = fakeContainer([
    [{ name: 'foo', contentLength: 3 }, { name: 'bar', contentLength: 3 }]
  ])

  const events: ProgressEvent[] = []

  const summary = await copy({
    azure: { client: container },
    aws,
    onProgress: (event) => events.push(event)
  })

  assert.deepEqual(summary, { uploaded: 0, skipped: 2 })
  assert.deepEqual(state.downloads, [])
  assert.equal(s3.commandCalls(PutObjectCommand).length, 0)
  assert.deepEqual(
    events.filter((event) => event.type === 'skip').map((event) => event.key).sort(),
    ['bar', 'foo']
  )
})

test('uploads blobs whose size differs from S3', async () => {
  s3.on(HeadObjectCommand).resolves({ ContentLength: 999 })
  s3.on(PutObjectCommand).resolves({})

  const { container, state } = fakeContainer([[{ name: 'foo', contentLength: 3 }]])

  const summary = await copy({
    azure: { client: container },
    aws: { bucket: aws.bucket, client: new S3Client({ region: aws.region }) }
  })

  assert.deepEqual(summary, { uploaded: 1, skipped: 0 })
  assert.deepEqual(state.downloads, ['foo'])
})

test('uploads blobs with an unknown size even when S3 has an empty object', async () => {
  s3.on(HeadObjectCommand).resolves({ ContentLength: 0 })
  s3.on(PutObjectCommand).resolves({})

  const { container, state } = fakeContainer([[{ name: 'foo' }]])

  const summary = await copy({
    azure: { client: container },
    aws
  })

  assert.deepEqual(summary, { uploaded: 1, skipped: 0 })
  assert.deepEqual(state.downloads, ['foo'])
})

test('ignores an empty aws prefix', async () => {
  s3.on(HeadObjectCommand).rejects(notFound())
  s3.on(PutObjectCommand).resolves({})

  const { container } = fakeContainer([[{ name: 'foo', contentLength: 3 }]])

  await copy({
    azure: { client: container },
    aws: { ...aws, prefix: '' }
  })

  const puts = s3.commandCalls(PutObjectCommand)
  assert.deepEqual(puts.map((put) => put.args[0].input.Key), ['foo'])
})

test('applies the aws prefix to object keys', async () => {
  s3.on(HeadObjectCommand).rejects(notFound())
  s3.on(PutObjectCommand).resolves({})

  const { container } = fakeContainer([[{ name: 'foo', contentLength: 3 }]])

  await copy({
    azure: { client: container },
    aws: { ...aws, prefix: 'pre' }
  })

  const heads = s3.commandCalls(HeadObjectCommand)
  assert.deepEqual(heads.map((head) => head.args[0].input.Key), ['pre/foo'])

  const puts = s3.commandCalls(PutObjectCommand)
  assert.deepEqual(puts.map((put) => put.args[0].input.Key), ['pre/foo'])
})

test('forwards the resume token and reports page continuation tokens', async () => {
  s3.on(HeadObjectCommand).rejects(notFound())
  s3.on(PutObjectCommand).resolves({})

  const { container, state } = fakeContainer([
    [{ name: 'foo', contentLength: 3 }],
    [{ name: 'bar', contentLength: 3 }]
  ])

  const events: ProgressEvent[] = []

  await copy({
    azure: { client: container, token: 'resume-token' },
    aws,
    onProgress: (event) => events.push(event)
  })

  assert.equal(state.continuationToken, 'resume-token')
  assert.deepEqual(events.filter((event) => event.type === 'page'), [
    { type: 'page', count: 1, continuationToken: 'token-1' },
    { type: 'page', count: 1, continuationToken: undefined }
  ])
})

test('treats NotFound errors from another SDK copy as missing', async () => {
  // simulates aws.client built from a separately installed @aws-sdk/client-s3,
  // whose NotFound class fails instanceof checks against this package's copy
  const error = new Error('NotFound')
  error.name = 'NotFound'
  s3.on(HeadObjectCommand).rejects(error)
  s3.on(PutObjectCommand).resolves({})

  const { container } = fakeContainer([[{ name: 'foo', contentLength: 3 }]])

  const summary = await copy({ azure: { client: container }, aws })

  assert.deepEqual(summary, { uploaded: 1, skipped: 0 })
})

test('rejects on non-NotFound head errors', async () => {
  s3.on(HeadObjectCommand).rejects(new Error('Access Denied'))

  const { container, state } = fakeContainer([[{ name: 'foo', contentLength: 3 }]])

  await assert.rejects(
    copy({ azure: { client: container }, aws }),
    /Access Denied/
  )

  assert.deepEqual(state.downloads, [])
  assert.equal(s3.commandCalls(PutObjectCommand).length, 0)
})

test('requires azure account and container without a client', async () => {
  await assert.rejects(copy({ azure: {}, aws }), TypeError)
})

test('rejects a non-positive concurrency', async () => {
  const { container } = fakeContainer([[]])
  await assert.rejects(
    copy({ concurrency: 0, azure: { client: container }, aws }),
    RangeError
  )
})

test('bounds concurrent transfers', async () => {
  s3.on(HeadObjectCommand).rejects(notFound())
  s3.on(PutObjectCommand).resolves({})

  const blobs = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, contentLength: 3 }))
  const { container, state } = fakeContainer([blobs])

  const summary = await copy({
    concurrency: 2,
    azure: { client: container },
    aws
  })

  assert.deepEqual(summary, { uploaded: 6, skipped: 0 })
  assert.ok(state.maxActive <= 2, `expected at most 2 concurrent downloads, saw ${state.maxActive}`)
})
