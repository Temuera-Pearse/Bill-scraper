function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms))
}

function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function snippet(text, max = 400) {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

module.exports = { sleep, sanitizeFilename, snippet }
