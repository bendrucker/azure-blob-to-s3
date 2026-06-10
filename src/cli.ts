#!/usr/bin/env node

import meow from 'meow'
import { copy } from './index.ts'

const cli = meow(`
  Usage:
    azure-s3
      Copies an Azure Blob Storage container's files to an Amazon S3 bucket.

  Options:
    --concurrency            Maximum number of simultaneous transfers (default: 100)
    --azure-connection       Azure Blob Storage connection string
    --azure-container        Azure Blob Storage container name
    --azure-token            Continuation token from a previous run's page output
    --aws-bucket             AWS S3 bucket name
    --aws-prefix             (Optional) A string between an Amazon S3 bucket name and an object name, for example: bucket/prefix1/file
    --aws-region             AWS region for the bucket
    --aws-access-key-id      AWS IAM access key ID
    --aws-secret-access-key  AWS IAM access key secret
    --log-level              "info" (default) logs pages and the final summary, "debug" also logs every skip and upload
`, {
  importMeta: import.meta,
  flags: {
    concurrency: { type: 'number' },
    azureConnection: { type: 'string', isRequired: true },
    azureContainer: { type: 'string', isRequired: true },
    azureToken: { type: 'string' },
    awsBucket: { type: 'string', isRequired: true },
    awsPrefix: { type: 'string' },
    awsRegion: { type: 'string' },
    awsAccessKeyId: { type: 'string' },
    awsSecretAccessKey: { type: 'string' },
    logLevel: { type: 'string', default: 'info' }
  }
})

const debug = cli.flags.logLevel === 'debug'

try {
  const summary = await copy({
    concurrency: cli.flags.concurrency,
    azure: {
      connection: cli.flags.azureConnection,
      container: cli.flags.azureContainer,
      token: cli.flags.azureToken
    },
    aws: {
      bucket: cli.flags.awsBucket,
      prefix: cli.flags.awsPrefix,
      region: cli.flags.awsRegion,
      accessKeyId: cli.flags.awsAccessKeyId,
      secretAccessKey: cli.flags.awsSecretAccessKey
    },
    onProgress (event) {
      if (event.type === 'page' || debug) {
        console.log(JSON.stringify(event))
      }
    }
  })

  console.log(JSON.stringify({ type: 'summary', ...summary }))
} catch (error) {
  console.log(JSON.stringify({
    type: 'error',
    message: error instanceof Error ? error.message : String(error)
  }))
  process.exitCode = 1
}
