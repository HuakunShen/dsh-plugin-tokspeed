/** Behavioral test harness for the dsh-plugin-tokspeed Host half (no Harness needed). */
const mod = await import(new URL('../index.js', import.meta.url))

const listeners = new Map()
const routes = new Map()
const effects = []
const errors = []
const warnings = []
const fakeRes = () => {
  const res = { code: 0, headers: {}, body: '' }
  res.writeHead = (code, headers) => { res.code = code; res.headers = headers }
  res.end = (body) => { res.body = body }
  return res
}
const ctx = {
  on: (event, fn) => {
    if (!listeners.has(event)) listeners.set(event, [])
    listeners.get(event).push(fn)
    return () => {}
  },
  get: () => ({
    register: (route) => { routes.set(route.path, route.handler); return () => routes.delete(route.path) },
  }),
  effect: (fn) => { effects.push(fn) },
  logger: {
    error: (message, error) => errors.push(`${message}: ${error?.message ?? error}`),
    warn: (message) => warnings.push(message),
  },
}
const call = async (path) => {
  const res = fakeRes()
  await routes.get(path)({ method: 'GET' }, res)
  return res
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const config = mod.Config({
  maxFileBytes: 900,
  maxAgeDays: 1,
  sampleMinIntervalMs: 100,
  sweepIntervalMinutes: 1,
  includeSessionIds: true,
  dataDir: '/tmp/tokspeed-test',
})

mod.apply(ctx, config)
for (const effect of effects) await effect(ctx)
console.log('routes registered:', [...routes.keys()].join(', '))

const emit = (time, model, outputTokens, sessionId) => {
  for (const fn of listeners.get('session/event') ?? []) {
    fn(
      { id: sessionId },
      {
        type: 'assistant/message',
        time,
        data: {
          turn: 1,
          step: 1,
          stream: [
            { type: 'text-chunks', time0: time, dt: [10, 10, 10], texts: ['a', 'b', 'c'] },
            { type: 'chunk', time: time + 1000, chunk: { type: 'finish', reason: { kind: 'completed' } } },
          ],
          usage: { inputTokens: 10, outputTokens },
          message: { source: { kind: 'model', provider: 'test-provider', model } },
        },
      },
    )
  }
}

// 1. rate limiting: samples 50ms apart are dropped; a 200ms gap records.
emit(1_000_000, 'model-a', 50, 's1')
emit(1_000_050, 'model-a', 60, 's1')
emit(1_000_200, 'model-b', 70, 's2')
await sleep(120)
let lines = (await call('/dsh-tokspeed/samples.jsonl')).body.trim().split('\n')
console.log('1. rate-limit: recorded', lines.length, '(expect 2)')

// 2. sample math: decode 1000ms with 50 tokens -> 50 tok/s; sessionId kept.
const first = JSON.parse(lines[0])
console.log('2. math: tps', first.tps, 'decodeMs', first.decodeMs, 'sessionId', first.sessionId, '(expect 50 / 1000 / s1)')

// 3. rotation: push total far past 900 bytes -> file stays under the cap.
for (let index = 0; index < 30; index += 1) emit(1_100_000 + index * 500, 'model-a', 40, 's1')
await sleep(400)
const { stat } = await import('node:fs/promises')
const size = (await stat('/tmp/tokspeed-test/samples.jsonl')).size
console.log('3. rotation: file bytes', size, '(expect ≤ 900)')

// 4. CSV route.
const csv = await call('/dsh-tokspeed/samples.csv')
console.log('4. csv: header ok —', csv.body.startsWith('time_iso,model,provider,'), '| rows:', csv.body.trim().split('\n').length - 1)

// 5. summary route.
const summary = JSON.parse((await call('/dsh-tokspeed/summary.json')).body)
console.log('5. summary: samples', summary.samples, '| models', summary.models.map(m => `${m.model}:${m.n}`).join(','), '| retention', JSON.stringify(summary.retention))

// 6. sweep: an ancient sample is dropped, a genuinely fresh one stays.
const { writeFile } = await import('node:fs/promises')
const ancient = JSON.stringify({ time: Date.now() - 5 * 86_400_000, model: 'old', tps: 1 })
const fresh = JSON.stringify({ time: Date.now(), model: 'fresh-model', tps: 99 })
await writeFile('/tmp/tokspeed-test/samples.jsonl', `${ancient}\n${fresh}\n`)
for (const effect of effects) await effect(ctx)
await sleep(150)
const swept = (await call('/dsh-tokspeed/samples.jsonl')).body
console.log('6. sweep: ancient dropped —', !swept.includes('"old"'), '| fresh kept —', swept.includes('fresh-model'))

// 7. includeSessionIds=false -> no sessionId field; defaults fill the rest.
const config2 = mod.Config({ includeSessionIds: false, dataDir: '/tmp/tokspeed-test-2', maxFileBytes: 0, maxAgeDays: 0 })
const listeners2 = new Map()
const effects2 = []
const ctx2 = {
  on: (event, fn) => { listeners2.set(event, fn); return () => {} },
  get: () => ({ register: () => () => {} }),
  effect: (fn) => { effects2.push(fn) },
  logger: { error: () => {}, warn: () => {} },
}
mod.apply(ctx2, config2)
for (const effect of effects2) await effect(ctx2)
listeners2.get('session/event')({ id: 'secret' }, {
  type: 'assistant/message', time: 5_000_000,
  data: {
    turn: 1, step: 1,
    stream: [{ type: 'text-chunks', time0: 5_000_000, dt: [5], texts: ['x'] }],
    usage: { inputTokens: 1, outputTokens: 10 },
    message: { source: { kind: 'model', provider: 'p', model: 'm' } },
  },
})
await sleep(100)
const body2 = await import('node:fs/promises').then(fs => fs.readFile('/tmp/tokspeed-test-2/samples.jsonl', 'utf8'))
console.log('7. privacy: sessionId omitted —', !body2.includes('secret'), '| tps ok (10 tokens / 5ms):', JSON.parse(body2.trim()).tps === 2000)

console.log('errors during run:', errors.length, errors.join(' | ') || '(none)')

// 8. settings routes: GET current, POST patch applies live and persists, bad body rejected.
const configGet = fakeRes()
await routes.get('/dsh-tokspeed/config')({ method: 'GET' }, configGet)
console.log('8a. config GET:', JSON.parse(configGet.body).maxAgeDays === 1 ? 'ok' : 'FAIL')
const postEmpty = fakeRes()
await routes.get('/dsh-tokspeed/config')({ method: 'POST', async *[Symbol.asyncIterator]() {} }, postEmpty)
console.log('8b. config POST empty: ok —', postEmpty.code === 200)
const badRes = fakeRes()
await routes.get('/dsh-tokspeed/config')({
  method: 'POST',
  async *[Symbol.asyncIterator]() { yield 'not json' },
}, badRes)
console.log('8c. config POST bad body: 400 —', badRes.code === 400)
const postFile = fakeRes()
await routes.get('/dsh-tokspeed/config')({
  method: 'POST',
  async *[Symbol.asyncIterator]() { yield JSON.stringify({ maxAgeDays: 3 }) },
}, postFile)
const persisted = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile('/tmp/tokspeed-test/config.json', 'utf8')))
console.log('8d. config persisted:', persisted.maxAgeDays === 3, '| effective live:', JSON.parse((await call('/dsh-tokspeed/config')).body).maxAgeDays === 3)
const dataDirRes = fakeRes()
await routes.get('/dsh-tokspeed/config')({
  method: 'POST',
  async *[Symbol.asyncIterator]() { yield JSON.stringify({ dataDir: '/somewhere-else' }) },
}, dataDirRes)
console.log('8e. dataDir change rejected in live patch:', JSON.parse(dataDirRes.body).dataDir === '/tmp/tokspeed-test')

process.exit(0)
