'use srict'

const meow = require('meow')
const ora = require('ora')
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
  azure: {
    connection: cli.flags.azureConnection,
    container: cli.flags.azureContainer
  },
  aws: {
    bucket: cli.flags.awsBucket,
    region: cli.flags.awsRegion,
    awsAccessKeyId: cli.flags.awsAccessKeyId,
    awsSecretAccessKey: cli.flags.awsSecretAccessKey
  }
}

const listSpinner = ora(`Listing contents of "${options.azure.container}" from Azure`).start()

copy(options)
  .once('length', function (length) {
    const size = length.toLocaleString()
    listSpinner.text = listSpinner.text + ' (' + size + ' files)'
    success(listSpinner)

    let index = 0
    const fileSpinner = ora('').start()
    increment()

    this.on('success', increment)
    this.on('failed', console.error.bind(console))
    this.on('error', console.error.bind(console))

    function increment () {
      index++
      fileSpinner.text = `Uploading files (${index.toLocaleString()} / ${size}) to S3`

      if (index + 1 === length) {
        fileSpinner.text = `Uploaded ${size} files to S3 (${options.aws.bucket})`
        success(fileSpinner)
      }
    }
  })

function success (spinner) {
  spinner.color = 'green'
  spinner.stopAndPersist('✔︎')
}
