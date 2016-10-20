# azure-blob-to-s3 [![Build Status](https://travis-ci.org/bendrucker/azure-blob-to-s3.svg?branch=master)](https://travis-ci.org/bendrucker/azure-blob-to-s3)

> Batch copy files from Azure Blob Storage to Amazon S3


## Install

```
$ npm install --save azure-blob-to-s3
```


## Usage

### API

```js
var toS3 = require('azure-blob-to-s3')

toS3({
  azure: {
    connection: '',
    container: 'my-container'
  },
  aws: {
    region: 'us-west-2',
    bucket: 'my-bucket'
  }
})
```

### CLI

```sh
azure-s3 \
  --concurrency 10 \
  --azure-connection "..." \
  --azure-container my-container
  --aws-bucket my-bucket
```

## API

#### `toS3(options)` -> `output`

Copys files from Azure Blob Storage to AWS S3.

##### options

*Required*  
Type: `object`

Options for configuring the copy.

###### concurrency

Type: `number`  
Default: `100`

The maximum number of files to concurrently stream from Azure and into S3.

##### azure

Type: `object`  

##### aws

Type: `object`

## License

MIT © [Ben Drucker](http://bendrucker.me)
