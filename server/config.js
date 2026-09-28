import path from 'node:path'

function envInt(env, name, fallback) {
  const raw = env[name]
  if (raw == null || String(raw).trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`${name} debe ser un puerto entre 1 y 65535`)
  }
  return value
}

export function loadConfig(env = process.env) {
  const recordingsPath = (env.RECORDINGS_PATH || '/Volumes/WyzeNVR/wyze-bridge/recordings').trim()
  const hlsPath = (env.HLS_PATH || '/hls/{camera}.m3u8').trim()
  if (!hlsPath.includes('{camera}')) {
    throw new Error('HLS_PATH debe incluir el marcador {camera}')
  }

  return {
    port: envInt(env, 'PORT', 3000),
    recordingsPath: path.resolve(recordingsPath),
    bridgeHost: (env.BRIDGE_HOST || '192.168.88.37').trim(),
    hlsPort: envInt(env, 'HLS_PORT', 8888),
    rtspPort: envInt(env, 'RTSP_PORT', 8554),
    hlsPath,
  }
}
