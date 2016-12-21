#!/usr/bin/env node

'use strict'

const meow = require('meow')
const Writable = require('stream').Writable
const bole = require('bole')
const copy = require('./')

const cli = meow(`
  Usage:
    azure-s3
      Copies an Azure Blob Storage container's files to an Amazon S3 bucket.

  Options:
    --concurrency
    --azure-connection       Azure Blob Storage connection string
    --azure-container        Azure Blob Storage container name
    --aws-bucket             AWS S3 bucket name
    --aws-region             AWS region for the bucket
    --aws-access-key-id      AWS IAM access key ID
    --aws-secret-access-key  AWS IAM access key secret
`)

const options = {
  concurrency: cli.flags.concurrency,
  logLevel: cli.flags.logLevel,
  azure: {
    connection: cli.flags.azureConnection,
    container: cli.flags.azureContainer,
    token: cli.flags.azureToken
  },
  aws: {
    bucket: cli.flags.awsBucket,
    region: cli.flags.awsRegion,
    awsAccessKeyId: cli.flags.awsAccessKeyId,
    awsSecretAccessKey: cli.flags.awsSecretAccessKey
  }
}

bole.output({
  level: options.logLevel,
  stream: process.stdout
})

copy(options)
  .pipe(new Writable({
    write: function (file, enc, callback) {
      copy.log.s3.info({message: 'file', file})
      callback()
    },
    objectMode: true
  }))
