'use strict'

const assert = require('assert')
const azure = require('azure-storage')
const BlobList = require('azure-blob-list-stream')
const S3 = require('aws-sdk/clients/s3')
const RetryStream = require('retry-stream-proxy')
const through = require('through2')
const Throttled = require('throttled-transform-stream').default
const bole = require('bole')

const log = {
  azure: bole('azure'),
  s3: bole('s3')
}

module.exports = Object.assign(copy, { log })

function copy (options) {
  assert(options.azure, 'azure config is required')
  assert(options.aws, 'aws config is required')

  if (!options.concurrency) options.concurrency = 100

  const blob = azure.createBlobService(options.azure.connection)
  const s3 = new S3({
    region: options.aws.region,
    accessKeyId: options.aws.accessKeyId,
    secretAccessKey: options.aws.secretAccessKey,
    params: {
      Bucket: options.aws.bucket
    }
  })

  const ThrottledTransfer = Throttled.create(transfer, undefined, {
    queriesPerSecond: options.concurrency
  })

  return BlobList(blob, options.azure.container, options.azure.token)
    .on('page', (page) => log.azure.info({ message: 'page', page }))
    .pipe(through.obj(function (file, enc, callback) {
      log.azure.debug({ message: 'file', file })
      callback(null, file)
    }))
    .pipe(new ThrottledTransfer({ objectMode: true }))
    .on('error', log.s3.error)

  function transfer (file, enc, callback) {
    s3.headObject({ Key: file.name }, function (err, object) {
      if (err && err.code !== 'NotFound') return callback(err)

      if (object) {
        log.s3.debug({ message: 'head', object, filename: file.name })

        if (Number(file.contentLength) === Number(object.ContentLength)) {
          log.s3.debug({ message: 'skip', filename: file.name })
          return callback(null)
        }
      }

      const stream = new RetryStream(createBlobStream.bind(null, file.name), {
        delay: 1000
      })

      const key = options.aws.prefix ? `${options.aws.prefix}/${file.name}` : file.name
      s3.upload({ Key: key, Body: stream }, callback)
    })
  }

  function createBlobStream (filename) {
    return blob.createReadStream(options.azure.container, filename)
  }
}
