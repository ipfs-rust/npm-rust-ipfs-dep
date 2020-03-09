'use strict'
/*
  Download rust-ipfs distribution package for desired version, platform and architecture,
  and unpack it to a desired output directory.

  API:
    download([<version>, <platform>, <arch>, <outputPath>])

  Defaults:
    rust-ipfs version: value in package.json/rust-ipfs/version
    rust-ipfs platform: the platform this program is run from
    rust-ipfs architecture: the architecture of the hardware this program is run from
    rust-ipfs install path: './rust-ipfs'

  Example:
    const download = require('rust-ipfs-dep')

    download("v0.4.5", "linux", "amd64", "/tmp/rust-ipfs"])
      .then((res) => console.log('filename:', res.file, "output:", res.dir))
      .catch((e) => console.error(e))
*/
const goenv = require('go-platform')
const gunzip = require('gunzip-maybe')
const path = require('path')
const tarFS = require('tar-fs')
const unzip = require('unzip-stream')
const fetch = require('node-fetch')
const pkgConf = require('pkg-conf')
const pkg = require('./../package.json')
const fs = require('fs')

function unpack ({ url, installPath, stream }) {
  return new Promise((resolve, reject) => {
    if (url.endsWith('.zip')) {
      return stream.pipe(
        unzip
          .Extract({ path: installPath })
          .on('close', resolve)
          .on('error', reject)
      )
    }

    return stream
      .pipe(gunzip())
      .pipe(
        tarFS
          .extract(installPath)
          .on('finish', resolve)
          .on('error', reject)
      )
  })
}

async function download ({ installPath, url }) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Unexpected status: ${res.status}`)
  return unpack({ url, installPath, stream: res.body })
}

function cleanArguments (version, platform, arch, installPath) {
  const conf = pkgConf.sync('rust-ipfs', {
    cwd: path.join(process.cwd(), '..'),
    defaults: {
      version: 'v' + pkg.version.replace(/-[0-9]+/, ''),
      distUrl: 'https://dist.ipfs.io'
    }
  })
  return {
    version: process.env.TARGET_VERSION || version || conf.version,
    platform: process.env.TARGET_OS || platform || goenv.GOOS,
    arch: process.env.TARGET_ARCH || arch || goenv.GOARCH,
    distUrl: process.env.GO_IPFS_DIST_URL || conf.distUrl,
    installPath: installPath ? path.resolve(installPath) : process.cwd()
  }
}

async function ensureVersion ({ version, distUrl }) {
  const res = await fetch(`${distUrl}/rust-ipfs/versions`)
  if (!res.ok) throw new Error(`Unexpected status: ${res.status}`)
  const versions = (await res.text()).trim().split('\n')

  if (versions.indexOf(version) === -1) {
    throw new Error(`Version '${version}' not available`)
  }
}

async function getDownloadURL ({ version, platform, arch, distUrl }) {
  await ensureVersion({ version, distUrl })

  const res = await fetch(`${distUrl}/rust-ipfs/${version}/dist.json`)
  if (!res.ok) throw new Error(`Unexpected status: ${res.status}`)
  const data = await res.json()

  if (!data.platforms[platform]) {
    throw new Error(`No binary available for platform '${platform}'`)
  }

  if (!data.platforms[platform].archs[arch]) {
    throw new Error(`No binary available for arch '${arch}'`)
  }

  const link = data.platforms[platform].archs[arch].link
  return `${distUrl}/rust-ipfs/${version}${link}`
}

module.exports = async function () {
  const args = await cleanArguments(...arguments)
  const url = await getDownloadURL(args)

  process.stdout.write(`Downloading ${url}\n`)

  await download({ ...args, url })

  return {
    fileName: url.split('/').pop(),
    installPath: path.join(args.installPath, 'rust-ipfs') + path.sep
  }
}

module.exports.path = function () {
  const paths = [
    path.resolve(path.join(__dirname, '..', 'rust-ipfs', 'ipfs')),
    path.resolve(path.join(__dirname, '..', 'rust-ipfs', 'ipfs.exe'))
  ]

  for (const bin of paths) {
    if (fs.existsSync(bin)) {
      return bin
    }
  }

  throw new Error('rust-ipfs binary not found, it may not be installed or an error may have occured during installation')
}

module.exports.path.silent = function () {
  try {
    return module.exports.path()
  } catch (err) {
    // ignore
  }
}
