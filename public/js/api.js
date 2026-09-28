export async function getJson(url) {
  const response = await fetch(url)
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  if (!response.ok) {
    throw new Error(data.error || `Error ${response.status}`)
  }
  return data
}

export function mediaUrl(camera, date, file) {
  return `/api/media/${encodeURIComponent(camera)}/${encodeURIComponent(date)}/${encodeURIComponent(file)}`
}

export function collapseBridgeHlsUrl(url) {
  let next = String(url)
  while (next.includes('/hls/hls/')) {
    next = next.replaceAll('/hls/hls/', '/hls/')
  }
  return next
}

export function hlsUrl(config, camera) {
  const name = encodeURIComponent(camera)
  const template = (config.hlsPath || '/hls/{camera}.m3u8').replaceAll('{camera}', name)
  if (/^https?:\/\//i.test(template)) return template

  const page = globalThis.window?.location
  const host = config.bridgeHost || page?.hostname || ''
  const port = config.hlsPort
  const path = template.startsWith('/') ? template : `/${template}`
  const url = `http://${host}:${port}${path}`
  if (page) {
    const pagePort = page.port || (page.protocol === 'https:' ? '443' : '80')
    if (host === page.hostname && String(port) === String(pagePort)) {
      throw new Error('La URL HLS apunta a esta app. Tiene que ser la del bridge.')
    }
  }
  return url
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatDuration(seconds, estimated) {
  const value = seconds ?? 300
  const minutes = Math.floor(value / 60)
  const rest = value % 60
  const label = rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
  return estimated ? `~${label}` : label
}
