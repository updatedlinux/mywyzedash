import { createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import express from 'express'
import { loadConfig } from './config.js'
import { HttpError, listCameras, listClips, listDates, parseByteRange, resolveClip } from './recordings.js'

const require = createRequire(import.meta.url)
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

export function createApp(config) {
  const app = express()
  app.disable('x-powered-by')

  app.get('/api/health', asyncRoute(async (_req, res) => {
    let recordingsReadable = false
    try {
      await listCameras(config.recordingsPath)
      recordingsReadable = true
    } catch {
      recordingsReadable = false
    }
    res.json({
      ok: true,
      recordingsReadable,
      recordingsPath: config.recordingsPath,
    })
  }))

  app.get('/api/config', (_req, res) => {
    res.json({
      bridgeHost: config.bridgeHost,
      hlsPort: config.hlsPort,
      rtspPort: config.rtspPort,
      hlsPath: config.hlsPath,
    })
  })

  app.get('/api/cameras', asyncRoute(async (_req, res) => {
    const cameras = await listCameras(config.recordingsPath)
    res.json({ cameras })
  }))

  app.get('/api/cameras/:camera/dates', asyncRoute(async (req, res) => {
    const dates = await listDates(config.recordingsPath, req.params.camera, config.recordingTzOffsetHours)
    res.json({ camera: req.params.camera, dates })
  }))

  app.get('/api/cameras/:camera/clips', asyncRoute(async (req, res) => {
    const date = String(req.query.date || '')
    const clips = await listClips(config.recordingsPath, req.params.camera, date, config.recordingTzOffsetHours)
    res.json({ camera: req.params.camera, date, clips })
  }))

  app.get('/api/media/:camera/:date/:file', asyncRoute(async (req, res) => {
    const { filePath, stat } = await resolveClip(
      config.recordingsPath,
      req.params.camera,
      req.params.date,
      req.params.file,
    )
    const size = stat.size
    const range = parseByteRange(req.headers.range, size)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Cache-Control', 'private, no-cache')

    if (range?.invalid) {
      res.status(400).json({ error: 'Rango HTTP no válido' })
      return
    }
    if (range?.unsatisfiable) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end()
      return
    }

    if (!range) {
      res.status(200).setHeader('Content-Length', size)
      if (req.method === 'HEAD' || size === 0) {
        res.end()
        return
      }
      await sendStream(req, res, filePath, 0, size - 1)
      return
    }

    const length = range.end - range.start + 1
    res.status(206)
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    res.setHeader('Content-Length', length)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    await sendStream(req, res, filePath, range.start, range.end)
  }))

  app.get('/vendor/hls.min.js', (_req, res) => {
    res.sendFile(require.resolve('hls.js/dist/hls.min.js'))
  })

  app.use(express.static(publicDir, { index: 'index.html', fallthrough: true }))

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Recurso no encontrado' })
  })

  app.use((error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.status : 500
    if (status >= 500 && !(error instanceof HttpError)) {
      console.error(error)
    }
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.status(status).json({
      error: error instanceof HttpError ? error.message : 'Error interno',
    })
  })

  return app
}

async function sendStream(_req, res, filePath, start, end) {
  const stream = createReadStream(filePath, { start, end })
  const abort = () => {
    if (!stream.destroyed) stream.destroy()
  }
  res.on('close', abort)
  try {
    await pipeline(stream, res)
  } catch (error) {
    if (error && (error.code === 'ERR_STREAM_PREMATURE_CLOSE' || error.code === 'ECONNRESET' || error.code === 'ERR_STREAM_DESTROYED')) {
      return
    }
    if (!res.headersSent) {
      res.status(500).json({ error: 'No se pudo leer el video' })
      return
    }
    res.destroy()
  } finally {
    res.off('close', abort)
  }
}

function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  return path.resolve(entry) === fileURLToPath(import.meta.url)
}

if (isDirectRun()) {
  const config = loadConfig()
  const app = createApp(config)
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Wyze DVR escuchando en http://0.0.0.0:${config.port}`)
    console.log(`Grabaciones (solo lectura): ${config.recordingsPath}`)
  })
}
