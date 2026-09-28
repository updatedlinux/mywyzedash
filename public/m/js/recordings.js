import { formatBytes, formatDuration, getJson, mediaUrl } from '/js/api.js'
import { monthLabel, renderCalendar } from '/js/calendar.js'

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
  const video = document.getElementById('m-video')
  if (video && !video.paused) video.pause()
}

function bind() {
  document.getElementById('m-refresh').addEventListener('click', () => loadCameras({ keep: true }))
  document.getElementById('m-prev').addEventListener('click', () => stepClip(-1))
  document.getElementById('m-next').addEventListener('click', () => stepClip(1))
  document.getElementById('m-daybar').addEventListener('click', onDaybarClick)
  document.getElementById('m-date').addEventListener('click', openCalendar)
  document.getElementById('m-cal-prev').addEventListener('click', () => shiftMonth(-1))
  document.getElementById('m-cal-next').addEventListener('click', () => shiftMonth(1))
  document.querySelectorAll('.speed').forEach((button) => {
    button.addEventListener('click', () => setRate(Number(button.dataset.rate)))
  })

  const sheet = document.getElementById('m-sheet')
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) sheet.close()
  })

  const video = document.getElementById('m-video')
  video.addEventListener('ended', () => {
    if (!document.getElementById('m-continue').checked) return
    const next = clipAfter(state.file, 1)
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
    else showEmpty('No hay carpetas de cámaras.', { clearDates: true })
  } catch (error) {
    showEmpty(error.message)
  }
}

function renderCameras() {
  const row = document.getElementById('m-cameras')
  row.replaceChildren()
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
    renderDateButton()
    renderCalendarView()
    if (state.date) await loadClips({ keep })
    else showEmpty('Esta cámara todavía no tiene días grabados.')
  } catch (error) {
    showError(error.message)
  }
}

function renderDateButton() {
  const button = document.getElementById('m-date')
  if (!state.date) {
    button.textContent = 'Elegir día'
    return
  }
  const [year, month, day] = state.date.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const label = date.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
  button.textContent = label.charAt(0).toUpperCase() + label.slice(1)
}

function renderCalendarView() {
  document.getElementById('m-cal-title').textContent = monthLabel(
    state.cursor.getFullYear(),
    state.cursor.getMonth(),
  )
  renderCalendar(document.getElementById('m-cal-grid'), {
    year: state.cursor.getFullYear(),
    monthIndex: state.cursor.getMonth(),
    enabledDates: state.dates,
    selectedDate: state.date,
    onSelect: (iso) => {
      state.date = iso
      state.file = ''
      renderDateButton()
      renderCalendarView()
      document.getElementById('m-sheet').close()
      loadClips({ keep: false })
    },
  })
}

function shiftMonth(delta) {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1)
  renderCalendarView()
}

function openCalendar() {
  if (!state.camera) return
  renderCalendarView()
  document.getElementById('m-sheet').showModal()
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
  const list = document.getElementById('m-clips')
  const summary = document.getElementById('m-summary')
  list.replaceChildren()
  const bytes = state.clips.reduce((total, clip) => total + clip.sizeBytes, 0)
  summary.textContent = state.clips.length
    ? `${state.clips.length} · ${formatBytes(bytes)}`
    : 'Sin clips'

  if (state.clips.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'muted empty-copy'
    empty.textContent = 'No hay mp4 para esta fecha.'
    list.append(empty)
    document.getElementById('m-now').textContent = 'Sin clip'
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
    time.textContent = `${formatClock(clip.start)} – ${formatClock(clip.end)}`
    const meta = document.createElement('span')
    meta.textContent = `${formatDuration(clip.durationSeconds, clip.durationEstimated)} · ${formatBytes(clip.sizeBytes)}`
    button.append(time, meta)
    button.addEventListener('click', () => playClip(clip, { auto: true }))
    list.append(button)
  }

  if (!scroll) return
  const selected = list.querySelector('.clip.is-selected')
  if (!selected) return
  selected.scrollIntoView({ block: 'nearest' })
}

function renderDaybar() {
  const bar = document.getElementById('m-daybar')
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
    segment.title = `${formatClock(clip.start)} – ${formatClock(clip.end)}`
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
  let chosen = null
  for (const clip of state.clips) {
    const start = clockToSeconds(clip.start)
    if (start <= second && (!chosen || start > clockToSeconds(chosen.start))) chosen = clip
  }
  if (!chosen) {
    chosen = state.clips.reduce((earliest, clip) => (
      clockToSeconds(clip.start) < clockToSeconds(earliest.start) ? clip : earliest
    ))
  }
  playClip(chosen, { auto: true })
}

function playClip(clip, { auto }) {
  state.file = clip.file
  const video = document.getElementById('m-video')
  video.src = mediaUrl(state.camera, clip.diskDate || state.date, clip.file)
  video.playbackRate = state.rate
  document.getElementById('m-now').textContent = `${formatClock(clip.start)} – ${formatClock(clip.end)}`
  renderClips({ scroll: true })
  renderDaybar()
  if (auto) {
    video.play().catch(() => setStage('Pulsa play para iniciar.'))
  }
}

function clearVideo() {
  const video = document.getElementById('m-video')
  video.removeAttribute('src')
  video.load()
  document.getElementById('m-now').textContent = 'Sin clip'
  setStage('No hay clips en el día seleccionado.')
}

function clipAfter(file, delta) {
  const ordered = [...state.clips].sort((a, b) => clockToSeconds(a.start) - clockToSeconds(b.start))
  const index = ordered.findIndex((clip) => clip.file === file)
  return ordered[index + delta]
}

function stepClip(delta) {
  const next = clipAfter(state.file, delta)
  if (next) playClip(next, { auto: true })
}

function setRate(rate) {
  state.rate = rate
  const video = document.getElementById('m-video')
  if (video) video.playbackRate = rate
  document.querySelectorAll('.speed').forEach((button) => {
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
  renderDateButton()
  renderCalendarView()
  renderClips()
  renderDaybar()
  clearVideo()
  showError(message)
}

function showError(message) {
  const banner = document.getElementById('m-error')
  banner.hidden = false
  banner.textContent = message
}

function clearError() {
  const banner = document.getElementById('m-error')
  banner.hidden = true
  banner.textContent = ''
}

function setStage(message) {
  const status = document.getElementById('m-stage-status')
  status.textContent = message
  status.hidden = !message
}

function clockToSeconds(clock) {
  const [hours, minutes, seconds] = clock.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

function formatClock(clock) {
  const [hours, minutes, seconds] = clock.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${pad(minutes)}:${pad(seconds)} ${period}`
}

function pad(value) {
  return String(value).padStart(2, '0')
}
