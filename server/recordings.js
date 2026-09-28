import fs from 'node:fs/promises'
import path from 'node:path'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLIP_RE = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/
const ASSUMED_CLIP_SECONDS = 300
const DURATION_CACHE_LIMIT = 2000

const durationCache = new Map()

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function assertSegment(segment) {
  if (
    typeof segment !== 'string' ||
    segment.length === 0 ||
    segment.length > 180 ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')
  ) {
    throw new HttpError(400, 'Parámetro no válido')
  }
}

export function resolveInside(root, ...segments) {
  for (const segment of segments) assertSegment(segment)
  const target = path.resolve(root, ...segments)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new HttpError(400, 'Ruta fuera de las grabaciones')
  }
  return target
}

async function ensureRoot(root) {
  let stat
  try {
    stat = await fs.stat(root)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new HttpError(503, 'La carpeta de grabaciones no existe o no está montada')
    }
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw new HttpError(503, 'No hay permiso de lectura sobre la carpeta de grabaciones')
    }
    throw new HttpError(503, 'No se pudo leer la carpeta de grabaciones')
  }
  if (!stat.isDirectory()) {
    throw new HttpError(503, 'RECORDINGS_PATH no es una carpeta')
  }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

export function clockFromSeconds(totalSeconds) {
  const normalized = ((totalSeconds % 86400) + 86400) % 86400
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  const seconds = normalized % 60
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

export function parseMvhd(buffer) {
  const marker = Buffer.from('mvhd')
  let index = buffer.indexOf(marker)
  while (index !== -1) {
    const version = buffer[index + 4]
    if (version === 0 && index + 24 <= buffer.length) {
      const timescale = buffer.readUInt32BE(index + 16)
      const duration = buffer.readUInt32BE(index + 20)
      const seconds = durationFromScale(timescale, duration)
      if (seconds != null) return seconds
    }
    if (version === 1 && index + 36 <= buffer.length) {
      const timescale = buffer.readUInt32BE(index + 24)
      const high = buffer.readUInt32BE(index + 28)
      const low = buffer.readUInt32BE(index + 32)
      const duration = high * 2 ** 32 + low
      const seconds = durationFromScale(timescale, duration)
      if (seconds != null) return seconds
    }
    index = buffer.indexOf(marker, index + 4)
  }
  return null
}

function durationFromScale(timescale, duration) {
  if (!timescale || timescale > 1_000_000 || !Number.isFinite(duration) || duration <= 0) return null
  const seconds = Math.round(duration / timescale)
  if (seconds <= 0 || seconds > 6 * 60 * 60) return null
  return seconds
}

export async function readMp4DurationSeconds(filePath, stat) {
  const key = `${filePath}:${stat.size}:${stat.mtimeMs}`
  if (durationCache.has(key)) return durationCache.get(key)
  if (stat.size < 32) {
    rememberDuration(key, null)
    return null
  }

  const handle = await fs.open(filePath, 'r')
  try {
    const headLength = Math.min(stat.size, 512 * 1024)
    const head = Buffer.alloc(headLength)
    await handle.read(head, 0, headLength, 0)
    let seconds = parseMvhd(head)
    if (seconds == null && stat.size > headLength) {
      const tailLength = Math.min(stat.size, 2 * 1024 * 1024)
      const tail = Buffer.alloc(tailLength)
      await handle.read(tail, 0, tailLength, stat.size - tailLength)
      seconds = parseMvhd(tail)
    }
    rememberDuration(key, seconds)
    return seconds
  } catch {
    rememberDuration(key, null)
    return null
  } finally {
    await handle.close()
  }
}

function rememberDuration(key, seconds) {
  if (durationCache.size >= DURATION_CACHE_LIMIT) {
    const oldest = durationCache.keys().next().value
    durationCache.delete(oldest)
  }
  durationCache.set(key, seconds)
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  }
  const workers = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

export async function listCameras(root) {
  await ensureRoot(root)
  const entries = await fs.readdir(root, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'es'))
}

export async function listDates(root, camera) {
  await ensureRoot(root)
  const cameraPath = resolveInside(root, camera)
  let entries
  try {
    entries = await fs.readdir(cameraPath, { withFileTypes: true })
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error && error.code === 'ENOENT') throw new HttpError(404, 'Cámara no encontrada')
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw new HttpError(503, 'No hay permiso de lectura sobre esa cámara')
    }
    throw new HttpError(500, 'No se pudieron leer las fechas')
  }
  return entries
    .filter((entry) => entry.isDirectory() && DATE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

export async function listClips(root, camera, date) {
  if (!DATE_RE.test(date)) throw new HttpError(400, 'La fecha debe tener formato YYYY-MM-DD')
  await ensureRoot(root)
  const dayPath = resolveInside(root, camera, date)
  let names
  try {
    names = await fs.readdir(dayPath)
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error && error.code === 'ENOENT') {
      try {
        await fs.stat(resolveInside(root, camera))
      } catch {
        throw new HttpError(404, 'Cámara no encontrada')
      }
      return []
    }
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw new HttpError(503, 'No hay permiso de lectura sobre ese día')
    }
    throw new HttpError(500, 'No se pudieron leer los clips')
  }

  const files = names.filter((name) => CLIP_RE.test(name)).sort()
  return mapPool(files, 8, async (file) => {
    const match = CLIP_RE.exec(file)
    const filePath = resolveInside(root, camera, date, file)
    const stat = await fs.stat(filePath)
    const start = `${match[2]}:${match[3]}:${match[4]}`
    const [hours, minutes, seconds] = start.split(':').map(Number)
    const startSeconds = hours * 3600 + minutes * 60 + seconds
    let durationSeconds = null
    if (stat.isFile() && stat.size > 0) {
      durationSeconds = await readMp4DurationSeconds(filePath, stat)
    }
    const durationEstimated = durationSeconds == null
    const usedDuration = durationSeconds ?? ASSUMED_CLIP_SECONDS
    return {
      file,
      start,
      end: clockFromSeconds(startSeconds + usedDuration),
      durationSeconds,
      durationEstimated,
      sizeBytes: stat.size,
    }
  })
}

export async function resolveClip(root, camera, date, file) {
  if (!DATE_RE.test(date) || !CLIP_RE.test(file)) {
    throw new HttpError(400, 'Clip no válido')
  }
  await ensureRoot(root)
  const filePath = resolveInside(root, camera, date, file)
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new HttpError(404, 'Clip no encontrado')
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw new HttpError(503, 'No hay permiso de lectura sobre el clip')
    }
    throw new HttpError(500, 'No se pudo abrir el clip')
  }
  if (!stat.isFile()) throw new HttpError(404, 'Clip no encontrado')
  return { filePath, stat }
}

export function parseByteRange(header, size) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return { invalid: true }

  let start
  let end
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isInteger(suffix) || suffix <= 0) return { invalid: true }
    if (size === 0) return { unsatisfiable: true }
    start = Math.max(size - suffix, 0)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Number(match[2])
    if (!Number.isInteger(start) || !Number.isInteger(end)) return { invalid: true }
  }

  if (size === 0 || start < 0 || end < start || start >= size) return { unsatisfiable: true }
  return { start, end: Math.min(end, size - 1) }
}
