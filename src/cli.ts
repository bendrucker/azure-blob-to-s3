#!/usr/bin/env node

import { inspect } from 'node:util'
import meow from 'meow'
import { copy } from './index.ts'

const cli = meow(`
  Usage:
    azure-s3
      Copies an Azure Blob Storage container's files to an Amazon S3 bucket.

      Credentials are resolved by the cloud SDKs: DefaultAzureCredential for
      Azure (environment, workload identity, managed identity, Azure CLI) and
      the default credential provider chain for AWS (environment, shared
      config, SSO, IAM roles).

  Options:
    --concurrency      Maximum number of simultaneous transfers, 0 for unlimited (default: 30)
    --azure-account    Azure storage account name
    --azure-container  Azure Blob Storage container name
    --azure-token      Continuation token from a previous run's page output
    --aws-bucket       AWS S3 bucket name
    --aws-prefix       (Optional) A string between an Amazon S3 bucket name and an object name, for example: bucket/prefix1/file
    --aws-region       AWS region for the bucket
    --log-level        "info" (default) logs pages and the final summary, "debug" also logs every skip and upload
`, {
  importMeta: import.meta,
  flags: {
    concurrency: { type: 'number' },
    azureAccount: { type: 'string', isRequired: true },
    azureContainer: { type: 'string', isRequired: true },
    azureToken: { type: 'string' },
    awsBucket: { type: 'string', isRequired: true },
    awsPrefix: { type: 'string' },
    awsRegion: { type: 'string' },
    logLevel: { type: 'string', default: 'info' }
  }
})

const debug = cli.flags.logLevel === 'debug'

try {
  const summary = await copy({
    concurrency: cli.flags.concurrency,
    azure: {
      account: cli.flags.azureAccount,
      container: cli.flags.azureContainer,
      token: cli.flags.azureToken
    },
    aws: {
      bucket: cli.flags.awsBucket,
      prefix: cli.flags.awsPrefix,
      region: cli.flags.awsRegion
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
    message: error instanceof Error ? error.message : inspect(error)
  }))
  process.exitCode = 1
}
