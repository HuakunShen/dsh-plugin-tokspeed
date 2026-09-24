#!/usr/bin/env node
/**
 * Recompute `tps` in an existing samples file under the current measurability
 * rule, so data recorded before the guard stops skewing aggregates.
 *
 * A sample is measurable when its decode window is at least `--floor` ms and
 * the implied rate stays under `--cap` tok/s. Everything else keeps its
 * `decodeMs`/`outputTokens`, gets `tps: null`, and is marked `unmeasurable`.
 *
 * Usage:
 *   node scripts/recompute-tps.mjs [file] [--floor 250] [--cap 500] [--dry-run]
 *
 * The file defaults to `$DSH_HOME/tokspeed/samples.jsonl` (~/.dsh when
 * DSH_HOME is unset). A timestamped backup is written next to it unless
 * `--dry-run` is passed. Stop the plugin (or the Host) first: it appends to
 * the same file.
 */

import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : Number(args[index + 1])
}
const dryRun = args.includes('--dry-run')
const floor = flag('--floor', 250)
const cap = flag('--cap', 500)
const positional = args.filter((value, index) => !value.startsWith('--') && !args[index - 1]?.startsWith('--'))
const file = positional[0] ?? join(process.env['DSH_HOME'] ?? join(homedir(), '.dsh'), 'tokspeed', 'samples.jsonl')

const text = await readFile(file, 'utf8').catch(() => null)
if (text === null) {
  console.error(`recompute-tps: no such file: ${file}`)
  process.exit(1)
}

const lines = text.split('\n').filter((line) => line.trim() !== '')
const out = []
let measurable = 0
let unmeasurable = 0
let noUsage = 0
for (const line of lines) {
  let sample
  try {
    sample = JSON.parse(line)
  } catch {
    out.push(line)
    continue
  }
  const decodeMs = typeof sample.decodeMs === 'number' ? sample.decodeMs : 0
  const outputTokens = sample.outputTokens
  const rate = typeof outputTokens === 'number' && decodeMs > 0 ? outputTokens / (decodeMs / 1000) : null
  if (rate !== null && decodeMs >= floor && rate <= cap) {
    sample.tps = Number(rate.toFixed(2))
    delete sample.unmeasurable
    measurable += 1
  } else {
    sample.tps = null
    if (rate !== null) {
      sample.unmeasurable = true
      unmeasurable += 1
    } else {
      delete sample.unmeasurable
      noUsage += 1
    }
  }
  out.push(JSON.stringify(sample))
}

console.log(`recompute-tps: ${file}`)
console.log(`  rows ${lines.length} · measurable ${measurable} · marked unmeasurable ${unmeasurable} · no usage ${noUsage}`)
console.log(`  rule: decodeMs >= ${floor} and rate <= ${cap} tok/s`)
if (dryRun) {
  console.log('  dry run: nothing written')
} else {
  const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  await copyFile(file, backup)
  const temp = `${file}.tmp`
  await writeFile(temp, `${out.join('\n')}\n`, 'utf8')
  await rename(temp, file)
  console.log(`  backup ${backup}`)
}
