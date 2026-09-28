import { mountLive, unmountLive } from './live.js'
import { mountRecordings, pauseRecordings } from './recordings.js'

const recordingsView = document.getElementById('view-recordings')
const liveView = document.getElementById('view-live')
const tabs = [...document.querySelectorAll('.mode-tab')]

function applyRoute() {
  const live = window.location.hash === '#/en-vivo'
  recordingsView.hidden = live
  liveView.hidden = !live
  for (const tab of tabs) {
    const selected = (tab.dataset.tab === 'live') === live
    tab.setAttribute('aria-selected', String(selected))
    tab.classList.toggle('is-selected', selected)
  }
  if (live) {
    pauseRecordings()
    mountLive()
  } else {
    unmountLive()
    mountRecordings()
  }
}

window.addEventListener('hashchange', applyRoute)
if (!window.location.hash) {
  history.replaceState(null, '', '#/grabaciones')
}
applyRoute()
