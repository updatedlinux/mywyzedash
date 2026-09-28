import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from './index.js'
import { listCameras, listClips, listDates, parseByteRange, parseMvhd, resolveClip } from './recordings.js'

function mvhdV0(timescale, duration) {
  const buffer = Buffer.alloc(32)
  Buffer.from('mvhd').copy(buffer, 0)
  buffer[4] = 0
  buffer.writeUInt32BE(timescale, 16)
  buffer.writeUInt32BE(duration, 20)
  return buffer
}

test('parseMvhd lee duración versión 0', () => {
  assert.equal(parseMvhd(mvhdV0(1000, 300000)), 300)
  assert.equal(parseMvhd(Buffer.from('no-video')), null)
})

test('parseByteRange cubre inicio, sufijo y fuera de rango', () => {
  assert.deepEqual(parseByteRange('bytes=0-99', 1000), { start: 0, end: 99 })
  assert.deepEqual(parseByteRange('bytes=500-', 1000), { start: 500, end: 999 })
  assert.deepEqual(parseByteRange('bytes=-20', 1000), { start: 980, end: 999 })
  assert.equal(parseByteRange('bytes=1000-1001', 1000).unsatisfiable, true)
  assert.equal(parseByteRange(undefined, 1000), null)
})

test('el listado descubre cámaras, fechas y clips sin escribir', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wyze-dvr-'))
  try {
    await mkdir(path.join(root, 'oficina', '2026-09-28'), { recursive: true })
    await mkdir(path.join(root, 'estacionamiento', '2026-09-27'), { recursive: true })
    await writeFile(path.join(root, 'oficina', '2026-09-28', '2026-09-28_01-50-53.mp4'), mvhdV0(1000, 300000))
    await writeFile(path.join(root, 'oficina', 'notas.txt'), 'ignorar')

    assert.deepEqual(await listCameras(root), ['estacionamiento', 'oficina'])
    assert.deepEqual(await listDates(root, 'oficina'), ['2026-09-28'])

    const clips = await listClips(root, 'oficina', '2026-09-28')
    assert.equal(clips.length, 1)
    assert.equal(clips[0].file, '2026-09-28_01-50-53.mp4')
    assert.equal(clips[0].start, '01:50:53')
    assert.equal(clips[0].durationSeconds, 300)
    assert.equal(clips[0].end, '01:55:53')
    assert.equal(clips[0].durationEstimated, false)

    await assert.rejects(
      () => resolveClip(root, '..', '2026-09-28', '2026-09-28_01-50-53.mp4'),
      (error) => error.status === 400,
    )
    await assert.rejects(
      () => resolveClip(root, 'oficina', '2026-09-28', '../secreto.mp4'),
      (error) => error.status === 400,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('el video responde 206 con Content-Range', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wyze-dvr-http-'))
  const payload = Buffer.alloc(1000, 7)
  try {
    await mkdir(path.join(root, 'oficina', '2026-09-28'), { recursive: true })
    await writeFile(path.join(root, 'oficina', '2026-09-28', '2026-09-28_01-50-53.mp4'), payload)
    const app = createApp({
      recordingsPath: root,
      bridgeHost: '',
      hlsPort: 8888,
      rtspPort: 8554,
      hlsPath: '/{camera}/index.m3u8',
    })
    const server = createServer(app)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/media/oficina/2026-09-28/2026-09-28_01-50-53.mp4`,
        { headers: { Range: 'bytes=0-99' } },
      )
      const body = Buffer.from(await response.arrayBuffer())
      assert.equal(response.status, 206)
      assert.equal(response.headers.get('content-range'), 'bytes 0-99/1000')
      assert.equal(response.headers.get('accept-ranges'), 'bytes')
      assert.equal(body.length, 100)

      const cameras = await fetch(`http://127.0.0.1:${port}/api/cameras`)
      assert.deepEqual(await cameras.json(), { cameras: ['oficina'] })
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
