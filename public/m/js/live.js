import { getJson, hlsUrl } from '/js/api.js'

const state = {
  booted: false,
  config: null,
  cameras: [],
  camera: '',
  hls: null,
}

export function mountLive() {
  if (!state.booted) {
    state.booted = true
    document.getElementById('m-live-reconnect').addEventListener('click', connect)
    boot()
    return
  }
  connect()
}

export function unmountLive() {
  destroyPlayer()
  const video = document.getElementById('m-live-video')
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
}

async function boot() {
  clearError()
  try {
    const [config, cameras] = await Promise.all([
      getJson('/api/config'),
      getJson('/api/cameras'),
    ])
    state.config = config
    state.cameras = cameras.cameras
    state.camera = state.cameras[0] || ''
    renderCameras()
    if (state.camera) connect()
    else setStage('No hay cámaras para el directo.')
  } catch (error) {
    showError(error.message)
  }
}

function renderCameras() {
  const row = document.getElementById('m-live-cameras')
  row.replaceChildren()
  for (const name of state.cameras) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'chip chip--live'
    button.role = 'option'
    button.textContent = name
    button.setAttribute('aria-selected', String(name === state.camera))
    if (name === state.camera) button.classList.add('is-selected')
    button.addEventListener('click', () => {
      if (state.camera === name) return
      state.camera = name
      renderCameras()
      connect()
    })
    row.append(button)
  }
}

function connect() {
  if (!state.config || !state.camera) return
  if (document.getElementById('view-live').hidden) return
  clearError()
  destroyPlayer()

  const video = document.getElementById('m-live-video')
  let url
  try {
    url = hlsUrl(state.config, state.camera)
  } catch (error) {
    showError(error.message)
    setStage('Sin señal en vivo.')
    return
  }
  document.getElementById('m-live-url').textContent = url
  setStage('Conectando…')

  if (window.Hls && window.Hls.isSupported()) {
    attachHls(video, url)
    return
  }

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url
    video.play().catch(() => {})
    setStage('')
    return
  }

  showError('Este navegador no puede reproducir HLS.')
  setStage('HLS no disponible en este navegador.')
}

function attachHls(video, url) {
  const player = new window.Hls()
  state.hls = player
  player.loadSource(url)
  player.attachMedia(video)
  player.on(window.Hls.Events.MANIFEST_PARSED, () => {
    setStage('')
    video.play().catch(() => {})
  })
  player.on(window.Hls.Events.ERROR, (_event, data) => {
    if (String(data?.reason || '').includes('Found no media')) {
      data.fatal = false
      player.startLoad()
      return
    }
    if (!data?.fatal) return
    const detail = data.reason || data.error?.message || data.details || 'error de red'
    showError(`No se pudo abrir el directo (${detail}).`)
    setStage('Sin señal en vivo.')
    destroyPlayer()
  })
}

function destroyPlayer() {
  if (state.hls) {
    state.hls.destroy()
    state.hls = null
  }
}

function showError(message) {
  const banner = document.getElementById('m-live-error')
  banner.hidden = false
  banner.textContent = message
}

function clearError() {
  const banner = document.getElementById('m-live-error')
  banner.hidden = true
  banner.textContent = ''
}

function setStage(message) {
  const status = document.getElementById('m-live-status')
  status.textContent = message
  status.hidden = !message
}
