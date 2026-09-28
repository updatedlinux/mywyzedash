import { formatBytes, formatDuration, getJson, mediaUrl } from './api.js'
import { monthLabel, renderCalendar } from './calendar.js'

const state = {
  booted: false,
  cameras: [],
  camera: '',
  dates: new Set(),
  cursor: new Date(),
  date: '',
  clips: [],
  file: '',
  rate: 1,
  timer: 0,
  cameraToken: 0,
  dayToken: 0,
  clipToken: 0,
}

export function mountRecordings() {
  if (!state.booted) {
    state.booted = true
    bind()
    loadCameras()
    state.timer = window.setInterval(refreshToday, 60000)
  }
}

export function pauseRecordings() {
  const video = document.getElementById('rec-video')
  if (video && !video.paused) video.pause()
}

function bind() {
  document.getElementById('rec-refresh').addEventListener('click', () => loadCameras({ keep: true }))
  document.getElementById('cal-prev').addEventListener('click', () => shiftMonth(-1))
  document.getElementById('cal-next').addEventListener('click', () => shiftMonth(1))
  document.getElementById('rec-prev').addEventListener('click', () => stepClip(-1))
  document.getElementById('rec-next').addEventListener('click', () => stepClip(1))
  document.getElementById('rec-daybar').addEventListener('click', onDaybarClick)
  document.querySelectorAll('.speed-btn').forEach((button) => {
    button.addEventListener('click', () => setRate(Number(button.dataset.rate)))
  })

  const video = document.getElementById('rec-video')
  video.addEventListener('ended', () => {
    if (!document.getElementById('rec-continue').checked) return
    const index = state.clips.findIndex((clip) => clip.file === state.file)
    const next = state.clips[index + 1]
    if (next) playClip(next, { auto: true })
    else setStage('Fin de las grabaciones de este día.')
  })
  video.addEventListener('error', () => {
    if (!video.getAttribute('src')) return
    setStage('No se pudo reproducir este clip.')
  })
  video.addEventListener('loadeddata', () => setStage(''))
  setRate(1)
}

async function loadCameras({ keep = false } = {}) {
  const token = ++state.cameraToken
  clearError()
  try {
    const data = await getJson('/api/cameras')
    if (token !== state.cameraToken) return
    state.cameras = data.cameras
    if (!keep || !state.cameras.includes(state.camera)) {
      state.camera = state.cameras[0] || ''
    }
    renderCameras()
    if (state.camera) await loadDates({ keep })
    else showEmpty('No hay carpetas de cámaras en la ruta de grabaciones.', { clearDates: true })
  } catch (error) {
    showEmpty(error.message)
  }
}

function renderCameras() {
  const row = document.getElementById('rec-cameras')
  row.replaceChildren()
  if (state.cameras.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'muted'
    empty.textContent = 'Sin cámaras.'
    row.append(empty)
    return
  }
  for (const name of state.cameras) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'chip'
    button.role = 'option'
    button.textContent = name
    button.setAttribute('aria-selected', String(name === state.camera))
    if (name === state.camera) button.classList.add('is-selected')
    button.addEventListener('click', () => {
      if (state.camera === name) return
      state.camera = name
      state.file = ''
      renderCameras()
      loadDates({ keep: false })
    })
    row.append(button)
  }
}

async function loadDates({ keep = false } = {}) {
  const token = ++state.dayToken
  clearError()
  try {
    const data = await getJson(`/api/cameras/${encodeURIComponent(state.camera)}/dates`)
    if (token !== state.dayToken) return
    state.dates = new Set(data.dates)
    if (!keep || !state.dates.has(state.date)) {
      const latest = data.dates[data.dates.length - 1]
      state.date = latest || ''
      if (latest) {
        const [year, month] = latest.split('-').map(Number)
        state.cursor = new Date(year, month - 1, 1)
      }
    }
    renderCalendarView()
    if (state.date) await loadClips({ keep })
    else showEmpty('Esta cámara todavía no tiene días grabados.')
  } catch (error) {
    showError(error.message)
  }
}

function renderCalendarView() {
  document.getElementById('cal-title').textContent = monthLabel(
    state.cursor.getFullYear(),
    state.cursor.getMonth(),
  )
  renderCalendar(document.getElementById('cal-grid'), {
    year: state.cursor.getFullYear(),
    monthIndex: state.cursor.getMonth(),
    enabledDates: state.dates,
    selectedDate: state.date,
    onSelect: (iso) => {
      state.date = iso
      state.file = ''
      renderCalendarView()
      loadClips({ keep: false })
    },
  })
}

function shiftMonth(delta) {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1)
  renderCalendarView()
}

async function loadClips({ keep = false } = {}) {
  const token = ++state.clipToken
  clearError()
  try {
    const data = await getJson(
      `/api/cameras/${encodeURIComponent(state.camera)}/clips?date=${encodeURIComponent(state.date)}`,
    )
    if (token !== state.clipToken) return
    state.clips = data.clips
    const stillThere = state.clips.some((clip) => clip.file === state.file)
    if (!keep || !stillThere) {
      state.file = state.clips[0]?.file || ''
      if (state.file) playClip(state.clips[0], { auto: false })
      else clearVideo()
    }
    renderClips()
    renderDaybar()
  } catch (error) {
    showError(error.message)
  }
}

function renderClips({ scroll = false } = {}) {
  const list = document.getElementById('rec-clips')
  const summary = document.getElementById('rec-summary')
  list.replaceChildren()
  const bytes = state.clips.reduce((total, clip) => total + clip.sizeBytes, 0)
  summary.textContent = state.clips.length
    ? `${state.clips.length} clips · ${formatBytes(bytes)}`
    : 'Sin clips'

  if (state.clips.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'muted empty-copy'
    empty.textContent = 'No hay mp4 para esta fecha.'
    list.append(empty)
    document.getElementById('rec-now-playing').textContent = 'Sin clip'
    return
  }

  for (const clip of state.clips) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'clip'
    button.role = 'option'
    button.setAttribute('aria-selected', String(clip.file === state.file))
    if (clip.file === state.file) button.classList.add('is-selected')

    const time = document.createElement('strong')
    time.textContent = `${clip.start} – ${clip.end}`
    const meta = document.createElement('span')
    meta.textContent = `${formatDuration(clip.durationSeconds, clip.durationEstimated)} · ${formatBytes(clip.sizeBytes)}`
    button.append(time, meta)
    button.addEventListener('click', () => playClip(clip, { auto: true }))
    list.append(button)
  }

  if (!scroll) return
  const selected = list.querySelector('.clip.is-selected')
  if (!selected) return
  const top = selected.offsetTop - (list.clientHeight - selected.offsetHeight) / 2
  list.scrollTo({ top: Math.max(0, top) })
}

function renderDaybar() {
  const bar = document.getElementById('rec-daybar')
  bar.replaceChildren()
  for (const clip of state.clips) {
    const start = clockToSeconds(clip.start)
    const duration = clip.durationSeconds ?? 300
    const segment = document.createElement('button')
    segment.type = 'button'
    segment.className = 'daybar-seg'
    if (clip.file === state.file) segment.classList.add('is-selected')
    if (clip.durationEstimated) segment.classList.add('is-estimated')
    segment.style.left = `${(start / 86400) * 100}%`
    segment.style.width = `${Math.max((duration / 86400) * 100, 0.45)}%`
    segment.title = `${clip.start} – ${clip.end}`
    segment.addEventListener('click', (event) => {
      event.stopPropagation()
      playClip(clip, { auto: true })
    })
    bar.append(segment)
  }
}

function onDaybarClick(event) {
  if (state.clips.length === 0) return
  const rect = event.currentTarget.getBoundingClientRect()
  const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
  const second = ratio * 86400
  let chosen = state.clips[0]
  for (const clip of state.clips) {
    if (clockToSeconds(clip.start) <= second) chosen = clip
  }
  playClip(chosen, { auto: true })
}

function playClip(clip, { auto }) {
  state.file = clip.file
  const video = document.getElementById('rec-video')
  video.src = mediaUrl(state.camera, clip.diskDate || state.date, clip.file)
  video.playbackRate = state.rate
  document.getElementById('rec-now-playing').textContent = `${state.camera} · ${state.date} · ${clip.start} – ${clip.end}`
  renderClips({ scroll: true })
  renderDaybar()
  if (auto) {
    video.play().catch(() => setStage('Pulsa play para iniciar la reproducción.'))
  }
}

function clearVideo() {
  const video = document.getElementById('rec-video')
  video.removeAttribute('src')
  video.load()
  document.getElementById('rec-now-playing').textContent = 'Sin clip'
  setStage('No hay clips en el día seleccionado.')
}

function stepClip(delta) {
  const index = state.clips.findIndex((clip) => clip.file === state.file)
  const next = state.clips[index + delta]
  if (next) playClip(next, { auto: true })
}

function setRate(rate) {
  state.rate = rate
  const video = document.getElementById('rec-video')
  if (video) video.playbackRate = rate
  document.querySelectorAll('.speed-btn').forEach((button) => {
    button.classList.toggle('is-selected', Number(button.dataset.rate) === rate)
  })
}

function refreshToday() {
  if (!state.camera || !state.date || document.hidden) return
  if (document.getElementById('view-recordings').hidden) return
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  if (state.date !== today) return
  loadDates({ keep: true })
}

function showEmpty(message, { clearDates = false } = {}) {
  state.clips = []
  state.file = ''
  if (clearDates) state.dates = new Set()
  renderCameras()
  renderCalendarView()
  renderClips()
  renderDaybar()
  clearVideo()
  showError(message)
}

function showError(message) {
  const banner = document.getElementById('rec-error')
  banner.hidden = false
  banner.textContent = message
}

function clearError() {
  const banner = document.getElementById('rec-error')
  banner.hidden = true
  banner.textContent = ''
}

function setStage(message) {
  const status = document.getElementById('rec-stage-status')
  status.textContent = message
  status.hidden = !message
}

function clockToSeconds(clock) {
  const [hours, minutes, seconds] = clock.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

function pad(value) {
  return String(value).padStart(2, '0')
}
