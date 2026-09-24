/**
 * Host half of dsh-plugin-tokspeed.
 *
 * Subscribes to the process-wide `session/event` feed and folds every durable
 * `assistant/message` into one throughput sample: the compact stream records
 * carry per-delta timestamps (`time0` plus `dt` gap arrays) and `usage` carries
 * the provider-reported token counts, so the decode window and tokens/second
 * are derivable without touching the agent loop.
 *
 * Samples append as JSON lines under the data directory. Retention is bounded
 * two ways, whichever hits first: file size (oldest lines dropped with
 * hysteresis) and sample age (periodic sweep). Optional rate limiting records
 * at most one sample per interval.
 *
 * Settings follow the voice-plugin pattern: a user-editable config.json next
 * to the samples, read and written through same-origin routes. Precedence is
 * schema defaults <- entry `config:` block <- user config.json (the panel
 * writes the file). Changes apply live; `dataDir` still requires a reload.
 */

import z from '@deepseek-ai/schemastery'
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROUTE_SAMPLES = '/dsh-tokspeed/samples.jsonl'
const ROUTE_CSV = '/dsh-tokspeed/samples.csv'
const ROUTE_SUMMARY = '/dsh-tokspeed/summary.json'
const ROUTE_CONFIG = '/dsh-tokspeed/config'

/** Default size cap: 5 MiB of JSONL before the oldest lines rotate out. */
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024
/** After a size rotation, trim to this fraction of the cap so rewrites stay rare. */
const ROTATE_TARGET_FRACTION = 0.75
/** Default sample age cap in days. */
const DEFAULT_MAX_AGE_DAYS = 7

/** Validated settings schema; every field is optional. The Loader applies it to entry `config:` blocks. */
export const Config = z.object({
  /** File size cap in bytes; the oldest lines rotate out. 0 disables the cap. */
  maxFileBytes: z.natural().default(DEFAULT_MAX_FILE_BYTES),
  /** Sample age cap in days; older lines are swept periodically. 0 disables the cap. */
  maxAgeDays: z.number().min(0).default(DEFAULT_MAX_AGE_DAYS),
  /** Minimum milliseconds between recorded samples; 0 records every assistant step. */
  sampleMinIntervalMs: z.natural().default(0),
  /** How often the age sweep runs, in minutes. */
  sweepIntervalMinutes: z.natural().min(1).default(60),
  /** Write sessionId into each sample; disable on shared data directories. */
  includeSessionIds: z.boolean().default(true),
  /** Directory for samples.jsonl; empty uses `<dsh home>/tokspeed`. Changing it requires a reload. */
  dataDir: z.string().default(''),
})

/** Resolve the sample file location: an explicit dataDir is used verbatim; the default is the DSH home. */
function samplesFile(effective) {
  if (effective.dataDir !== '') return join(effective.dataDir, 'samples.jsonl')
  const base = process.env['DSH_PROFILE_DIR'] || join(homedir(), '.dsh')
  return join(base, 'tokspeed', 'samples.jsonl')
}

/** Load the user's config.json, if any; malformed files fall back to defaults with a warning. */
async function readUserConfig(path, logger) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') logger.warn(`tokspeed: config.json unreadable (${String(error?.message ?? error)}); using defaults`)
    return {}
  }
}

/**
 * Fold one compact attempt stream into its first- and last-chunk times.
 * Run records (`text-chunks` and kin) store the first delta's absolute time in
 * `time0` and per-delta gaps in `dt`; raw `chunk` records carry `time` directly.
 * @param stream - the event's embedded `stream` records.
 * @returns the attempt's time window, or null for an empty stream.
 */
function streamWindow(stream) {
  let firstTime
  let lastTime
  for (const record of stream ?? []) {
    if (typeof record !== 'object' || record === null) continue
    const start = record.time0 ?? record.time
    if (typeof start !== 'number' || !Number.isFinite(start)) continue
    let end = start
    if (Array.isArray(record.dt)) {
      for (const gap of record.dt) {
        if (typeof gap === 'number' && Number.isFinite(gap)) end += gap
      }
    }
    firstTime = firstTime === undefined ? start : Math.min(firstTime, start)
    lastTime = lastTime === undefined ? end : Math.max(lastTime, end)
  }
  return firstTime === undefined || lastTime === undefined ? null : { firstTime, lastTime }
}

/**
 * Derive one throughput sample from an `assistant/message` event.
 * Only model-sourced messages sample; steps without usage still record their
 * timing with a null `tps` so the data distinguishes "no usage" from
 * "never streamed".
 */
function sampleOf(sessionId, event, stepStartTime, effective) {
  const source = event.data?.message?.source
  if (source?.kind !== 'model') return null
  const window = streamWindow(event.data.stream)
  if (window === null) return null
  const usage = event.data.usage
  const outputTokens = typeof usage?.outputTokens === 'number' ? usage.outputTokens : null
  const decodeMs = Math.max(0, window.lastTime - window.firstTime)
  const tps = outputTokens !== null && decodeMs > 0 ? outputTokens / (decodeMs / 1000) : null
  const sample = {
    time: event.time,
    provider: source.provider ?? null,
    model: source.model ?? null,
    turn: event.data.turn ?? null,
    step: event.data.step ?? null,
    ttftMs: stepStartTime === undefined ? null : Math.max(0, window.firstTime - stepStartTime),
    decodeMs,
    outputTokens,
    inputTokens: typeof usage?.inputTokens === 'number' ? usage.inputTokens : null,
    tps,
    interrupted: event.data.interrupted === true,
  }
  if (effective.includeSessionIds) sample.sessionId = sessionId
  return sample
}

/**
 * Serialized file-mutation queue: appends, rotations, and sweeps are chained
 * so concurrent async batches cannot interleave reads and writes.
 */
function createFileStore(file) {
  let tail = Promise.resolve()
  let currentBytes = 0

  const enqueue = (operation) => {
    tail = tail.then(operation, operation)
    return tail
  }

  const parseLines = (body) => body.split('\n').filter((line) => line.trim() !== '')

  /** Rewrite the file keeping only `lines`, atomically, and refresh the byte counter. */
  const rewrite = async (lines) => {
    const body = lines.length > 0 ? `${lines.join('\n')}\n` : ''
    const temp = `${file}.tmp`
    await writeFile(temp, body, 'utf8')
    await rename(temp, file)
    currentBytes = Buffer.byteLength(body)
  }

  /** Load the file (if any) and drop samples older than the age cap. */
  const initialize = async (maxAgeDays) => {
    let body = ''
    try {
      body = await readFile(file, 'utf8')
    } catch {
      currentBytes = 0
      return
    }
    const lines = parseLines(body)
    if (maxAgeDays <= 0) {
      currentBytes = Buffer.byteLength(body)
      return
    }
    const cutoff = Date.now() - maxAgeDays * 86_400_000
    const kept = lines.filter((line) => {
      try {
        return JSON.parse(line).time >= cutoff
      } catch {
        return true
      }
    })
    if (kept.length === lines.length) {
      currentBytes = Buffer.byteLength(body)
      return
    }
    await rewrite(kept)
  }

  /** Append one serialized sample, rotating first when the size cap demands it. */
  const append = async (line, maxFileBytes) => {
    const lineBytes = Buffer.byteLength(line)
    if (maxFileBytes > 0 && currentBytes + lineBytes > maxFileBytes) {
      const body = await readFile(file, 'utf8').catch(() => '')
      const target = Math.max(0, Math.floor(maxFileBytes * ROTATE_TARGET_FRACTION))
      const lines = parseLines(body)
      const kept = []
      let keptBytes = 0
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const size = Buffer.byteLength(lines[index]) + 1
        if (keptBytes + size > target) break
        kept.unshift(lines[index])
        keptBytes += size
      }
      await rewrite([...kept, line])
      return
    }
    await appendFile(file, line, 'utf8').catch(async (error) => {
      // The data directory may have been removed at runtime; recreate it once and retry.
      if (error?.code !== 'ENOENT') throw error
      await mkdir(join(file, '..'), { recursive: true })
      await appendFile(file, line, 'utf8')
    })
    currentBytes += lineBytes
  }

  /** Sweep samples older than the age cap, then enforce the size cap. */
  const sweep = async (effective) => {
    let body = ''
    try {
      body = await readFile(file, 'utf8')
    } catch {
      return
    }
    let lines = parseLines(body)
    const before = lines.length
    if (effective.maxAgeDays > 0) {
      const cutoff = Date.now() - effective.maxAgeDays * 86_400_000
      lines = lines.filter((line) => {
        try {
          return JSON.parse(line).time >= cutoff
        } catch {
          return true
        }
      })
    }
    if (effective.maxFileBytes > 0) {
      let total = lines.reduce((acc, line) => acc + Buffer.byteLength(line) + 1, 0)
      const target = Math.floor(effective.maxFileBytes * ROTATE_TARGET_FRACTION)
      while (total > target && lines.length > 0) {
        total -= Buffer.byteLength(lines[0]) + 1
        lines.shift()
      }
    }
    if (lines.length !== before || Buffer.byteLength(body) !== lines.reduce((acc, line) => acc + Buffer.byteLength(line) + 1, 0)) {
      await rewrite(lines)
    }
  }

  const readAll = async () => readFile(file, 'utf8').catch(() => '')

  const fileSize = async () => {
    try {
      return (await stat(file)).size
    } catch {
      return 0
    }
  }

  return { enqueue, initialize, append, sweep, readAll, fileSize }
}

const CSV_HEADER = 'time_iso,model,provider,turn,step,ttft_ms,decode_ms,output_tokens,input_tokens,tps,interrupted,session_id'

function toCsvRow(sample) {
  const cells = [
    new Date(sample.time).toISOString(),
    sample.model ?? '',
    sample.provider ?? '',
    sample.turn ?? '',
    sample.step ?? '',
    sample.ttftMs ?? '',
    sample.decodeMs ?? '',
    sample.outputTokens ?? '',
    sample.inputTokens ?? '',
    sample.tps === null || sample.tps === undefined ? '' : sample.tps.toFixed(2),
    sample.interrupted === true ? 'true' : 'false',
    sample.sessionId ?? '',
  ]
  return cells.join(',')
}

/** Fold parsed samples into per-model summary rows. */
function summarize(samples) {
  const byModel = new Map()
  for (const sample of samples) {
    const name = sample.model ?? sample.provider ?? 'unknown'
    let entry = byModel.get(name)
    if (entry === undefined) {
      entry = { model: name, points: [] }
      byModel.set(name, entry)
    }
    if (typeof sample.tps === 'number' && sample.tps > 0) entry.points.push(sample.tps)
  }
  return [...byModel.values()].map((entry) => {
    const sorted = [...entry.points].sort((a, b) => a - b)
    const at = (q) => sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    const mu = sorted.length === 0 ? null : sorted.reduce((a, b) => a + b, 0) / sorted.length
    return {
      model: entry.model,
      n: entry.points.length,
      mean: mu === null ? null : Number(mu.toFixed(2)),
      median: at(0.5) === null ? null : Number(at(0.5).toFixed(2)),
      p10: at(0.1) === null ? null : Number(at(0.1).toFixed(2)),
      p90: at(0.9) === null ? null : Number(at(0.9).toFixed(2)),
      min: sorted[0] ?? null,
      max: sorted[sorted.length - 1] ?? null,
    }
  })
}

/**
 * Bundle entry: start the recorder, retention, the read-only data routes, the
 * settings routes, and the index injection. Registrations ride the plugin
 * fiber and unwind with it.
 */
export function apply(ctx, entryConfig) {
  // Precedence: schema defaults <- deployment entry config <- user config.json.
  const effective = Config(entryConfig ?? {})
  const dataDir = effective.dataDir !== '' ? effective.dataDir : join(process.env['DSH_PROFILE_DIR'] || join(homedir(), '.dsh'), 'tokspeed')
  const file = join(dataDir, 'samples.jsonl')
  const configPath = join(dataDir, 'config.json')
  const store = createFileStore(file)
  const stepStarts = new Map()
  let lastRecordedAt = 0
  let sweepTimer
  let rearmSweep = () => {}

  ctx.effect(async () => {
    try {
      await mkdir(dataDir, { recursive: true })
      const user = await readUserConfig(configPath, ctx.logger)
      // dataDir cannot come from the file: the file lives inside it.
      Object.assign(effective, Config({ ...effective, ...user }), { dataDir: effective.dataDir })
      await store.initialize(effective.maxAgeDays)
    } catch (error) {
      ctx.logger.error('tokspeed: initialize failed', error)
    }
    return () => {}
  }, 'tokspeed: data directory')

  ctx.on('session/event', (session, event) => {
    if (event.type === 'step/start') {
      if (typeof event.time === 'number') stepStarts.set(session.id, event.time)
      return
    }
    if (event.type !== 'assistant/message') return
    if (typeof event.time !== 'number' || event.time - lastRecordedAt < effective.sampleMinIntervalMs) return
    const sample = sampleOf(session.id, event, stepStarts.get(session.id), effective)
    if (sample === null) return
    lastRecordedAt = event.time
    const line = `${JSON.stringify(sample)}\n`
    void store.enqueue(() => store.append(line, effective.maxFileBytes))
      .catch((error) => { ctx.logger.error('tokspeed: sample append failed', error) })
  })
  ctx.on('session/disposed', (session) => { stepStarts.delete(session.id) })

  ctx.effect(() => {
    const arm = () => {
      if (sweepTimer !== undefined) clearInterval(sweepTimer)
      sweepTimer = setInterval(() => {
        void store.enqueue(() => store.sweep(effective))
          .catch((error) => { ctx.logger.error('tokspeed: sweep failed', error) })
      }, effective.sweepIntervalMinutes * 60_000)
    }
    arm()
    rearmSweep = arm
    return () => { clearInterval(sweepTimer) }
  }, 'tokspeed: retention sweep')

  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: '__DSH_TOKSPEED__',
      value: { url: ROUTE_SAMPLES, summaryUrl: ROUTE_SUMMARY, configUrl: ROUTE_CONFIG },
    })
  })

  const webServer = ctx.get('webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') {
    ctx.logger.warn('tokspeed: no webServer service; recording continues but the Web panel has no data route')
    return
  }
  ctx.effect(() => {
    const json = (res, code, payload, type = 'application/json') => {
      res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' })
      res.end(payload)
    }
    const notAllowed = (res) => {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
    }
    const disposers = [
      webServer.register({
        kind: 'exact',
        path: ROUTE_SAMPLES,
        async handler(req, res) {
          if (req.method !== 'GET') return notAllowed(res)
          const body = await store.readAll()
          json(res, 200, body, 'text/plain')
        },
      }),
      webServer.register({
        kind: 'exact',
        path: ROUTE_CSV,
        async handler(req, res) {
          if (req.method !== 'GET') return notAllowed(res)
          const body = await store.readAll()
          const rows = body.split('\n').filter((line) => line.trim() !== '')
          const csv = [CSV_HEADER, ...rows.map((line) => {
            try {
              return toCsvRow(JSON.parse(line))
            } catch {
              return null
            }
          }).filter((row) => row !== null)].join('\n')
          json(res, 200, `${csv}\n`, 'text/csv')
        },
      }),
      webServer.register({
        kind: 'exact',
        path: ROUTE_SUMMARY,
        async handler(req, res) {
          if (req.method !== 'GET') return notAllowed(res)
          const body = await store.readAll()
          const samples = body.split('\n').filter((line) => line.trim() !== '').map((line) => {
            try {
              return JSON.parse(line)
            } catch {
              return null
            }
          }).filter((sample) => sample !== null)
          json(res, 200, JSON.stringify({
            samples: samples.length,
            oldest: samples[0]?.time ?? null,
            newest: samples[samples.length - 1]?.time ?? null,
            fileBytes: await store.fileSize(),
            retention: {
              maxFileBytes: effective.maxFileBytes,
              maxAgeDays: effective.maxAgeDays,
              sampleMinIntervalMs: effective.sampleMinIntervalMs,
            },
            models: summarize(samples),
          }))
        },
      }),
      webServer.register({
        kind: 'exact',
        path: ROUTE_CONFIG,
        async handler(req, res) {
          if (req.method === 'GET') {
            json(res, 200, JSON.stringify(effective))
            return
          }
          if (req.method !== 'POST') return notAllowed(res)
          let chunks = ''
          for await (const chunk of req) chunks += chunk
          let patch
          try {
            patch = JSON.parse(chunks || '{}')
          } catch {
            json(res, 400, JSON.stringify({ error: 'body must be JSON' }))
            return
          }
          // Moving the data location live would strand the store; reload to change it.
          delete patch.dataDir
          let next
          try {
            next = Config({ ...effective, ...patch })
          } catch (error) {
            json(res, 400, JSON.stringify({ error: String(error?.message ?? error) }))
            return
          }
          Object.assign(effective, next)
          try {
            const user = await readUserConfig(configPath, ctx.logger)
            await writeFile(configPath, `${JSON.stringify({ ...user, ...patch }, null, 2)}\n`, 'utf8')
          } catch (error) {
            ctx.logger.error('tokspeed: config write failed', error)
            json(res, 500, JSON.stringify({ error: 'failed to persist config' }))
            return
          }
          rearmSweep()
          json(res, 200, JSON.stringify(effective))
        },
      }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'tokspeed: data routes')
}
