const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function monthLabel(year, monthIndex) {
  const name = MONTHS[monthIndex]
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`
}

export function renderCalendar(grid, { year, monthIndex, enabledDates, selectedDate, onSelect }) {
  grid.replaceChildren()
  const first = new Date(year, monthIndex, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const today = localIso(new Date())

  for (let i = 0; i < startOffset; i += 1) {
    const blank = document.createElement('span')
    blank.className = 'cal-day cal-day--blank'
    grid.append(blank)
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${pad(monthIndex + 1)}-${pad(day)}`
    const enabled = enabledDates.has(iso)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cal-day'
    button.textContent = String(day)
    button.dataset.date = iso
    if (!enabled) button.disabled = true
    if (iso === selectedDate) button.classList.add('is-selected')
    if (iso === today) button.classList.add('is-today')
    if (enabled) {
      button.classList.add('has-recordings')
      button.addEventListener('click', () => onSelect(iso))
    }
    grid.append(button)
  }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function localIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
