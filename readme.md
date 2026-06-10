# `azure-blob-to-s3` [![tests](https://github.com/bendrucker/azure-blob-to-s3/workflows/tests/badge.svg)](https://github.com/bendrucker/azure-blob-to-s3/actions?query=workflow%3Atests)

> Batch copy files from Azure Blob Storage to Amazon S3

* Streams each blob from Azure into S3 without buffering it in memory or on disk
* Skips unnecessary uploads (files with a matching key and `Content-Length` already on S3)
* Retries (frequent) failed downloads from Azure mid-stream
* Reports progress through a callback; the CLI prints [ndjson](http://ndjson.org/)

For large workloads (either number of files or bytes), you should run this from AWS in the same region where your bucket is located. This will minimize cost and offer reliable/fast/cheap uploads to S3. You will be billed per byte by Azure for [outbound data transfer](https://azure.microsoft.com/en-us/pricing/details/bandwidth/).

## Install

```
$ npm install --save azure-blob-to-s3
```

Requires Node.js >= 22.18. This package is ESM-only.

## Breaking Changes in v2

* ESM-only and requires Node.js >= 22.18.
* `copy()` returns a `Promise` of a summary instead of a stream. Progress arrives through the `onProgress` callback.
* `concurrency` caps the number of simultaneous transfers. In v1 it throttled new transfers per second.
* `azure.token` is now the opaque continuation string from a `page` progress event. v1 token objects are not compatible.
* The copy fails fast: the first transfer error rejects the promise after in-flight transfers settle.
* The library no longer logs. The CLI prints ndjson to stdout.

## Usage

### API

```js
import { copy } from 'azure-blob-to-s3'

const summary = await copy({
  azure: {
    connection: '',
    container: 'my-container'
  },
  aws: {
    region: 'us-west-2',
    bucket: 'my-bucket',
    prefix: 'my-prefix'
  },
  onProgress (event) {
    console.log(event)
  }
})
// => { uploaded: 100, skipped: 2 }
```

### CLI

```sh
azure-s3 \
  --concurrency 10 \
  --azure-connection "..." \
  --azure-container my-container \
  --aws-bucket my-bucket \
  --aws-prefix my-prefix
```

## API

#### `copy(options)` -> `Promise<CopySummary>`

Copies files from Azure Blob Storage to AWS S3. Resolves with `{ uploaded, skipped }` counts once every file has been transferred or skipped. Rejects on the first transfer error, after in-flight transfers settle.

##### options

*Required*
Type: `object`

Options for configuring the copy.

###### concurrency

Type: `number`
Default: `100`

The maximum number of files to concurrently stream from Azure into S3.

###### onProgress

Type: `function`

Called with a progress event object for each operation:

* `{ type: 'page', count, continuationToken }`: a page of blobs was listed. Pass `continuationToken` as `azure.token` to resume a later run from this point.
* `{ type: 'skip', key }`: the file already exists on S3 with a matching size.
* `{ type: 'upload', key, size }`: the file was uploaded.

##### azure

*Required*
Type: `object`

###### connection

*Required*
Type: `string`

Azure Blob Storage connection string.

###### container

*Required*
Type: `string`

Azure Blob Storage container name.

###### token

Type: `string`
Default: `undefined`

A continuation token (from a `page` progress event) where the file list operation will begin.

##### aws

*Required*
Type: `object`

###### bucket

*Required*
Type: `string`

AWS S3 bucket name.

###### prefix

Type: `string`

A string between the bucket name and each object name, for example: `bucket/prefix1/file`.

###### region

Type: `string`

AWS region for the bucket. Falls back to the AWS SDK's default resolution.

###### accessKeyId / secretAccessKey

Type: `string`

AWS IAM credentials. When omitted, the AWS SDK's default credential chain is used.

## License

MIT © [Ben Drucker](http://bendrucker.me)
