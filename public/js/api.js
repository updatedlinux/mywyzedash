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

export function hlsUrl(config, camera) {
  const host = config.bridgeHost || window.location.hostname
  const cameraPath = config.hlsPath.replaceAll('{camera}', encodeURIComponent(camera))
  const path = cameraPath.startsWith('/') ? cameraPath : `/${cameraPath}`
  return `http://${host}:${config.hlsPort}${path}`
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
