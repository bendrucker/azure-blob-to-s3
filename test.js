'use strict'

const test = require('tape')
const proxyquire = require('proxyquire')
const fromArray = require('from2-array')
const fromString = require('from2-string')

test('normal', function (t) {
  t.plan(4)

  const files = {
    foo: 'bar',
    bar: 'baz'
  }

  const copy = proxyquire('./', {
    'azure-storage': {
      createBlobService: function (connection) {
        t.equal(connection, 'connection string')
        return {
          createReadStream: function (container, filename) {
            t.equal(container, 'container')
            return fromString(files[filename])
          }
        }
      }
    },
    'azure-blob-list-stream': function (blob, container) {
      t.equal(typeof blob.createReadStream, 'function')
      t.equal(container, 'container')

      return fromArray.obj(Object.keys(files).map(name => ({name})))
    },
    'aws-sdk/clients/s3': function (options) {
      t.ok(options)
      return {
        headObject: function (params, callback) {
          callback(Object.assign(new Error('Not found'), {code: 'NotFound'}))
        },
        upload: function (params, callback) {
          callback(null, {})
        }
      }
    }
  })

  copy({
    aws: {},
    azure: {
      connection: 'connection string',
      container: 'container'
    }
  })
})

test('skip', function (t) {
  t.plan(4)

  const files = {
    foo: 'bar',
    bar: 'baz'
  }

  const copy = proxyquire('./', {
    'azure-storage': {
      createBlobService: function (connection) {
        t.equal(connection, 'connection string')
        return {
          createReadStream: () => t.fail('should not read files')
        }
      }
    },
    'azure-blob-list-stream': function (blob, container) {
      t.equal(typeof blob.createReadStream, 'function')
      t.equal(container, 'container')

      return fromArray.obj(Object.keys(files).map(name => ({name, contentLength: '10'})))
    },
    'aws-sdk/clients/s3': function (options) {
      t.ok(options)
      return {
        headObject: function (params, callback) {
          callback(null, {
            ContentLength: '10'
          })
        },
        upload: () => t.fail('should not upload files')
      }
    }
  })

  copy({
    aws: {},
    azure: {
      connection: 'connection string',
      container: 'container'
    }
  })
})
