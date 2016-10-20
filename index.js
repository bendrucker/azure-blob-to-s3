'use strict'

const assert = require('assert')
const azure = require('azure-storage')
const BlobList = require('azure-blob-list-stream')
const aws = require('aws-sdk')
const Queue = require('queue')
const RetryStream = require('retry-stream-proxy')
const EventEmitter = require('events')

module.exports = copy

function copy (options) {
  assert(options.azure, 'azure config is required')
  assert(options.aws, 'aws config is required')

  const queue = Queue({
    concurrency: options.concurrency || 100
  })

  const events = new EventEmitter()

  const blob = azure.createBlobService(options.azure.connection)
  const s3 = new aws.S3({
    region: options.aws.region,
    accessKeyId: options.aws.accessKeyId,
    secretAccessKey: options.aws.secretAccessKey,
    params: {
      Bucket: options.aws.bucket
    }
  })

  BlobList(blob, options.azure.container)
    .on('data', function (file) {
      queue.push(function (callback) {
        const stream = new RetryStream(createBlobStream.bind(null, file), {
          delay: 1000
        })
        .on('error', (err) => events.emit('failed', {err, file}))

        s3.upload({Key: file.name, Body: stream}, callback)
      })
    })
    .once('end', function () {
      events.emit('length', queue.length)
      queue.start()
    })

  let index = 0
  queue
    .on('error', (err) => events.emit('error', err))
    .on('success', (result) => events.emit('success', result, index++))
    .on('end', () => events.emit('end'))

  return events

  function createBlobStream (file) {
    return blob.createReadStream(options.azure.container, file.name)
  }
}
