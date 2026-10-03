/**
 * Client half of the tokspeed bundle: the "Throughput" panel.
 *
 * Layout is a responsive CSS grid (auto-fit/minmax): one column on narrow
 * windows, several on wide ones, with the panel content capped so charts never
 * stretch across an entire wide display. Five views over the same filtered
 * samples: scatter over time, tok/s histogram with a normal-fit overlay,
 * per-model IQR box plot, median by hour of day, and a stats table. Model
 * chips toggle which models the charts include. Data arrives from the
 * read-only route the Host half publishes through `window.__DSH_TOKSPEED__`.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-tokspeed',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'tokspeed'
    const PANEL_ID = 'tokspeed'
    const PALETTE = ['#4e8fd6', '#d68f4e', '#5fbf8f', '#c25fb0', '#bfb35f', '#8f5fd6', '#5fbfc8', '#d65f5f']
    /** Apply-closure translate, the fallback when the slot's locale prop is absent. */
    let boundT = null

    const DICTS = {
      en: {
        panel: 'Throughput',
        title: 'Model throughput (tokens/second)',
        refresh: 'Refresh',
        loading: 'Loading samples…',
        error: 'Failed to load samples',
        reload: 'Data route unavailable — reload this page once after installing the bundle.',
        empty: 'No samples recorded yet. Run a model turn; every assistant step records one point.',
        hint: 'One point per assistant step: tokens/second over the decode window (first→last streamed chunk). Toggle models below to focus the charts.',
        samplesCount: '{n} samples',
        shown: '{shown}/{n} shown',
        overTime: 'Over time (tok/s, colored by model)',
        zoomHint: 'drag a box to zoom (x & y) · double-click to reset',
        resetZoom: 'reset',
        hist: 'Distribution (tok/s, normal fit overlay)',
        box: 'Per-model spread (IQR box plot)',
        hourly: 'By hour of day (median tok/s)',
        table: 'Stats summary',
        all: 'All',
        solo: 'solo',
        colModel: 'model',
        colN: 'n',
        colMean: 'mean',
        colMedian: 'median',
        colQ1: 'Q1',
        colQ3: 'Q3',
        colMin: 'min',
        colMax: 'max',
        footer: 'Retention: ≤{mb} MB · ≤{days} days · ≥{interval}s between samples — {n} samples, oldest {date} · {kb} KB · {excluded} not measurable',
        tpsLabel: 'Credible max (tok/s)',
        settingsSummary: 'Retention settings',
        daysLabel: 'Keep days',
        mbLabel: 'Size cap (MB)',
        intervalLabel: 'Sample interval (s)',
        verbosity: 'Verbosity (per assistant step, medians)',
        verbosityHint: 'think% = reasoning tokens ÷ output tokens (* = estimated from streamed reasoning characters when the provider reports no reasoningTokens); out/in = output ÷ input tokens (input is the whole context, so treat it as a rough reference).',
        colOutTok: 'output tok',
        colThinkShare: 'think %',
        colText: 'text chars',
        colThink: 'think chars',
        colOutIn: 'out/in',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved ✓',
        saveFailed: 'Save failed',
      },
      zh: {
        panel: '吞吐速度',
        title: '模型吞吐速度（tokens/秒）',
        refresh: '刷新',
        loading: '正在加载数据…',
        error: '加载数据失败',
        reload: '数据通道不可用 —— 安装本插件后刷新一次本页面。',
        empty: '还没有数据。跑一轮模型对话即可；每个 assistant step 结束都会记录一个点。',
        hint: '每个 assistant step 一个点：吞吐 = 输出 tokens ÷ 解码时长（首→末流式 chunk）。点下方模型开关可以只看部分模型。',
        samplesCount: '{n} 个采样',
        shown: '显示 {shown}/{n}',
        overTime: '时间分布（tok/s，按模型着色）',
        zoomHint: '拖框缩放（x/y 同时）· 双击还原',
        resetZoom: '重置',
        hist: '分布直方图（tok/s，含正态拟合参考线）',
        box: '每模型离散度（IQR 箱线图）',
        hourly: '一天内时段（中位 tok/s）',
        table: '统计摘要',
        all: '全选',
        solo: '只看',
        colModel: '模型',
        colN: 'n',
        colMean: '均值',
        colMedian: '中位',
        colQ1: 'Q1',
        colQ3: 'Q3',
        colMin: '最小',
        colQ3: 'Q3',
        colMax: '最大',
        footer: '保留策略：≤{mb} MB · ≤{days} 天 · 采样间隔 ≥{interval}s —— 共 {n} 条，最早 {date} · 当前 {kb} KB · {excluded} 条不可测',
        tpsLabel: '可信上限 (tok/s)',
        settingsSummary: '保留设置',
        daysLabel: '保留天数',
        mbLabel: '大小上限 (MB)',
        intervalLabel: '采样间隔 (秒)',
        verbosity: '啰嗦度（每个 assistant step，中位数）',
        verbosityHint: 'think% = 思考 tokens ÷ 输出 tokens（* 表示服务商未上报 reasoningTokens，按流式 reasoning 字符估算）；out/in = 输出 ÷ 输入 tokens（输入是整个会话上下文，仅作粗参考）。',
        colOutTok: '输出 tok',
        colThinkShare: '思考占比',
        colText: '正文字符',
        colThink: '思考字符',
        colOutIn: '输出/输入',
        save: '保存',
        saving: '保存中…',
        saved: '已保存 ✓',
        saveFailed: '保存失败',
      },
    }

    /* ---------- panel-level stylesheet (scoped class names, theme-neutral) ---------- */

    const STYLES = `
.tps-root { max-width: 1180px; margin: 0 auto; padding: 16px 18px 32px; box-sizing: border-box; }
.tps-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.tps-title { margin: 0; font-size: 16px; }
.tps-count { font-size: 12px; opacity: .6; }
.tps-btn { padding: 4px 12px; font-size: 13px; border-radius: 6px; border: 1px solid rgba(128,128,128,.45);
  background: transparent; color: inherit; cursor: pointer; margin-left: auto; }
.tps-btn:hover { border-color: currentColor; }
.tps-hint { font-size: 12px; opacity: .55; margin: 8px 0 0; max-width: 760px; }
.tps-note { font-size: 13px; opacity: .65; }
.tps-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; align-items: center; }
.tps-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 10px;
  border-radius: 999px; border: 1px solid rgba(128,128,128,.4); cursor: pointer; user-select: none;
  background: transparent; color: inherit; }
.tps-chip[data-off="1"] { opacity: .45; }
.tps-chip[data-off="1"] .tps-chip-name { text-decoration: line-through; }
.tps-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.tps-solo { border: 0; background: transparent; color: inherit; opacity: 0; cursor: pointer;
  font-size: 11px; padding: 0 2px; }
.tps-chip:hover .tps-solo { opacity: .7; }
.tps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; margin-top: 12px; }
.tps-card { border: 1px solid rgba(128,128,128,.28); border-radius: 10px; padding: 12px 14px 10px; min-width: 0; }
.tps-card-wide { grid-column: 1 / -1; }
.tps-card-title { font-size: 12.5px; margin: 0 0 8px; opacity: .75; font-weight: 600; }
.tps-chart { width: 100%; display: block; }
.tps-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tps-table th, .tps-table td { text-align: right; padding: 5px 10px; border-bottom: 1px solid rgba(128,128,128,.18); }
.tps-table th:first-child, .tps-table td:first-child { text-align: left; }
.tps-table th { opacity: .6; font-weight: 600; }
.tps-chartbox { position: relative; }
.tps-chartbox svg { cursor: crosshair; }
.tps-tip { position: absolute; pointer-events: none; z-index: 6; white-space: nowrap;
  background: rgba(24,24,27,.94); color: #f4f4f5; border: 1px solid rgba(255,255,255,.14);
  border-radius: 7px; padding: 5px 10px; font-size: 11.5px; line-height: 1.55;
  box-shadow: 0 4px 16px rgba(0,0,0,.4); }
.tps-tip div:first-child { font-weight: 600; }
.tps-zoombar { display: flex; gap: 10px; align-items: center; font-size: 11px; opacity: .55; margin-top: 3px; }
.tps-zoomreset { border: 1px solid rgba(128,128,128,.45); background: transparent; color: inherit;
  border-radius: 5px; font-size: 11px; padding: 1px 10px; cursor: pointer; }
.tps-zoomreset:hover { border-color: currentColor; }
.tps-table td:first-child .tps-model { display: inline-flex; align-items: center; gap: 6px; }
@media (max-width: 720px) { .tps-root { padding: 12px 10px 24px; } }
`

    /* ---------- data helpers ---------- */

    /** Parse the JSONL sample body, skipping malformed lines. */
    /** Decode windows shorter than this measure delivery granularity, not decoding. */
    const MIN_DECODE_MS = 250
    /** Fallback ceiling on a credible decode rate (tok/s) until the Host reports its own. */
    const DEFAULT_MAX_PLAUSIBLE_TPS = 500

    /**
     * Re-derive one row's rate under the measurability rule, so rows recorded
     * before the Host applied it cannot skew the charts: a provider that
     * delivers a buffered completion in one burst yields a window far shorter
     * than the decode time, and the quotient is meaningless.
     */
    function measuredTps(row, maxPlausibleTps) {
      const decodeMs = typeof row.decodeMs === 'number' ? row.decodeMs : 0
      if (typeof row.outputTokens !== 'number' || decodeMs <= 0) return null
      const rate = row.outputTokens / (decodeMs / 1000)
      return decodeMs >= MIN_DECODE_MS && rate <= maxPlausibleTps ? Number(rate.toFixed(2)) : null
    }

    function parseSamples(text, maxPlausibleTps) {
      const samples = []
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        try {
          const row = JSON.parse(line)
          if (typeof row?.time !== 'number') continue
          const tps = measuredTps(row, maxPlausibleTps)
          samples.push({
            ...row,
            tps,
            unmeasurable: tps === null && typeof row.outputTokens === 'number' && (row.decodeMs ?? 0) > 0,
          })
        } catch {
          // A torn final line or foreign content must not break the whole panel.
        }
      }
      return samples.sort((a, b) => a.time - b.time)
    }

    function quantile(sorted, q) {
      if (sorted.length === 0) return null
      const pos = (sorted.length - 1) * q
      const base = Math.floor(pos)
      const rest = pos - base
      return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base]
    }

    function mean(values) {
      return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
    }

    function std(values) {
      if (values.length < 2) return null
      const mu = mean(values)
      return Math.sqrt(values.reduce((acc, value) => acc + (value - mu) * (value - mu), 0) / (values.length - 1))
    }

    function modelName(sample) {
      return sample.model ?? sample.provider ?? 'unknown'
    }

    /** One entry per model over the samples: palette color, non-null tps points, and folded stats. */
    function modelStats(samples) {
      const byModel = new Map()
      for (const sample of samples) {
        const name = modelName(sample)
        let entry = byModel.get(name)
        if (entry === undefined) {
          entry = { name, color: PALETTE[byModel.size % PALETTE.length], points: [] }
          byModel.set(name, entry)
        }
        if (typeof sample.tps === 'number' && sample.tps > 0) entry.points.push(sample.tps)
      }
      return [...byModel.values()].map((entry) => {
        const sorted = [...entry.points].sort((a, b) => a - b)
        return {
          name: entry.name,
          color: entry.color,
          count: entry.points.length,
          mean: mean(entry.points),
          median: quantile(sorted, 0.5),
          q1: quantile(sorted, 0.25),
          q3: quantile(sorted, 0.75),
          min: sorted[0] ?? null,
          max: sorted[sorted.length - 1] ?? null,
        }
      })
    }

    /**
     * Verbosity fold per model. Thinking share prefers provider-reported
     * reasoningTokens/outputTokens; when absent it falls back to the ratio of
     * streamed reasoning characters (`estimated: true`). out/in is output over
     * the full input context — a rough inflation gauge only.
     */
    function verbosityStats(samples) {
      const byModel = new Map()
      for (const sample of samples) {
        const name = modelName(sample)
        let entry = byModel.get(name)
        if (entry === undefined) {
          entry = { name, color: '#888888', outTok: [], text: [], think: [], outIn: [], share: [], estimatedShare: 0 }
          byModel.set(name, entry)
        }
        if (typeof sample.outputTokens === 'number' && sample.outputTokens > 0) entry.outTok.push(sample.outputTokens)
        if (typeof sample.textChars === 'number') entry.text.push(sample.textChars)
        if (typeof sample.reasoningChars === 'number' && sample.reasoningChars > 0) entry.think.push(sample.reasoningChars)
        if (typeof sample.outputTokens === 'number' && typeof sample.inputTokens === 'number' && sample.inputTokens > 0) {
          entry.outIn.push(sample.outputTokens / sample.inputTokens)
        }
        if (typeof sample.reasoningTokens === 'number' && typeof sample.outputTokens === 'number' && sample.outputTokens > 0) {
          entry.share.push(sample.reasoningTokens / sample.outputTokens)
        } else if (typeof sample.reasoningChars === 'number' && ((sample.reasoningChars ?? 0) + (sample.textChars ?? 0)) > 0) {
          const total = (sample.reasoningChars ?? 0) + (sample.textChars ?? 0)
          if (total > 0 && sample.reasoningChars > 0) {
            entry.share.push(sample.reasoningChars / total)
            entry.estimatedShare += 1
          }
        }
      }
      return [...byModel.values()].map((entry) => ({
        name: entry.name,
        n: entry.outTok.length,
        medOutput: quantile([...entry.outTok].sort((a, b) => a - b), 0.5),
        medText: quantile([...entry.text].sort((a, b) => a - b), 0.5),
        medThink: quantile([...entry.think].sort((a, b) => a - b), 0.5),
        medOutIn: quantile([...entry.outIn].sort((a, b) => a - b), 0.5),
        medShare: quantile([...entry.share].sort((a, b) => a - b), 0.5),
        shareEstimated: entry.share.length > 0 && entry.estimatedShare === entry.share.length,
      }))
    }

    function formatTps(value) {
      if (value === null || value === undefined) return '—'
      return value >= 100 ? String(Math.round(value)) : value.toFixed(1)
    }

    function shortTime(time) {
      const date = new Date(time)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    const GRID_STROKE = 'rgba(128,128,128,.16)'
    const TICK_FILL = 'rgba(128,128,128,.75)'

    /* ---------- charts ---------- */

    /** Anchored hover bubble; flips horizontally when the pointer nears the right edge. */
    function Tip({ tip }) {
      if (tip === null || tip.lines.length === 0) return null
      const style = { top: tip.py, left: tip.px, transform: tip.flip ? 'translate(calc(-100% - 10px), -108%)' : 'translate(10px, -108%)' }
      return h('div', { className: 'tps-tip', style }, tip.lines.map((line, index) => h('div', { key: index }, line)))
    }

    /** Chart wrapper pairing the SVG with the tooltip layer. */
    function Chart({ tip, children }) {
      return h('div', { className: 'tps-chartbox' }, [children, h(Tip, { key: 'tip', tip })])
    }

    /** Pointer position → view-box units, css pixels (for the tooltip), and edge flag. */
    function svgPos(event, width, height) {
      const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget
      const rect = svg.getBoundingClientRect()
      const px = event.clientX - rect.left
      return {
        vx: (px / rect.width) * width,
        vy: ((event.clientY - rect.top) / rect.height) * height,
        px,
        py: event.clientY - rect.top,
        sx: rect.width / width,
        sy: rect.height / height,
        flip: px > rect.width * 0.6,
      }
    }

    /**
     * Scatter of every visible sample with a tps reading over wall time.
     * Interactive: hover snaps to the nearest point with a tooltip; dragging a
     * rectangle zooms both axes into that window (outliers included); a
     * double-click or the reset chip restores the full domain.
     */
    function ScatterChart({ samples, models, t }) {
      const [zoom, setZoom] = React.useState(null)
      const [tip, setTip] = React.useState(null)
      const [sel, setSel] = React.useState(null)
      const dragRef = React.useRef(null)
      const all = samples.filter((sample) => typeof sample.tps === 'number' && sample.tps > 0)
      if (all.length === 0) return null
      const colorOf = new Map(models.map((entry) => [entry.name, entry.color]))
      const width = 920
      const height = 260
      const m = { left: 46, right: 14, top: 12, bottom: 26 }
      const innerWidth = width - m.left - m.right
      const innerHeight = height - m.top - m.bottom
      const full = {
        t0: all[0].time,
        t1: Math.max(all[all.length - 1].time, all[0].time + 60_000),
        v0: 0,
        v1: Math.max(...all.map((sample) => sample.tps)) * 1.1,
      }
      const dom = zoom ?? full
      const points = all.filter((sample) =>
        sample.time >= dom.t0 && sample.time <= dom.t1 && sample.tps >= dom.v0 && sample.tps <= dom.v1)
      const x = (time) => m.left + ((time - dom.t0) / (dom.t1 - dom.t0)) * innerWidth
      const y = (value) => m.top + innerHeight * (1 - (value - dom.v0) / (dom.v1 - dom.v0))
      const xToTime = (vx) => dom.t0 + ((vx - m.left) / innerWidth) * (dom.t1 - dom.t0)
      const yToValue = (vy) => dom.v0 + (1 - (vy - m.top) / innerHeight) * (dom.v1 - dom.v0)
      const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))
      const inPlot = (p) => p.vx >= m.left && p.vx <= width - m.right && p.vy >= m.top && p.vy <= m.top + innerHeight
      const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => dom.v0 + fraction * (dom.v1 - dom.v0))
      const xTicks = [0, 1 / 3, 2 / 3, 1].map((fraction) => dom.t0 + fraction * (dom.t1 - dom.t0))
      const onDown = (event) => {
        if (event.button !== 0) return
        const p = svgPos(event, width, height)
        if (!inPlot(p)) return
        dragRef.current = { start: p }
        setTip(null)
        setSel({ x0: p.vx, y0: p.vy, x1: p.vx, y1: p.vy })
      }
      const onMove = (event) => {
        const p = svgPos(event, width, height)
        const drag = dragRef.current
        if (drag !== null) {
          setSel({
            x0: Math.min(drag.start.vx, p.vx), x1: Math.max(drag.start.vx, p.vx),
            y0: Math.min(drag.start.vy, p.vy), y1: Math.max(drag.start.vy, p.vy),
          })
          return
        }
        if (!inPlot(p)) { setTip(null); return }
        let best = null
        let bestD = 30
        for (const sample of points) {
          const dx = (x(sample.time) - p.vx) * p.sx
          const dy = (y(sample.tps) - p.vy) * p.sy
          const d = Math.hypot(dx, dy)
          if (d < bestD) { bestD = d; best = sample }
        }
        setTip(best === null ? null : {
          px: p.px, py: p.py, flip: p.flip, sample: best,
          lines: [
            modelName(best),
            `${formatTps(best.tps)} tok/s · ${shortTime(best.time)}`,
            `${best.outputTokens ?? '—'} tok out · ${Math.round(best.decodeMs)} ms decode`,
          ],
        })
      }
      const onUp = (event) => {
        const drag = dragRef.current
        if (drag === null) return
        dragRef.current = null
        setSel(null)
        const p = svgPos(event, width, height)
        if (Math.abs(p.vx - drag.start.vx) < 12 || Math.abs(p.vy - drag.start.vy) < 12) return
        const tA = clamp(xToTime(drag.start.vx), dom.t0, dom.t1)
        const tB = clamp(xToTime(p.vx), dom.t0, dom.t1)
        const vA = clamp(yToValue(drag.start.vy), dom.v0, dom.v1)
        const vB = clamp(yToValue(p.vy), dom.v0, dom.v1)
        setZoom({ t0: Math.min(tA, tB), t1: Math.max(tA, tB), v0: Math.min(vA, vB), v1: Math.max(vA, vB) })
        setTip(null)
      }
      const onLeave = () => { dragRef.current = null; setSel(null); setTip(null) }
      const reset = () => { setZoom(null); setTip(null) }
      const svg = h('svg', {
        className: 'tps-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('overTime'),
        onMouseDown: onDown, onMouseMove: onMove, onMouseUp: onUp, onMouseLeave: onLeave, onDoubleClick: reset,
      }, [
        h('defs', { key: 'defs' }, h('clipPath', { id: 'tps-scatter-clip' },
          h('rect', { x: m.left, y: m.top, width: innerWidth, height: innerHeight }))),
        yTicks.map((value, index) => h('g', { key: `y${index}` }, [
          h('line', { x1: m.left, x2: width - m.right, y1: y(value), y2: y(value), stroke: GRID_STROKE }),
          h('text', { x: m.left - 6, y: y(value) + 4, 'text-anchor': 'end', 'font-size': 11, fill: TICK_FILL }, formatTps(value)),
        ])),
        xTicks.map((time, index) => h('text', {
          key: `x${index}`, x: x(time), y: height - 8, 'text-anchor': index === 0 ? 'start' : 'middle', 'font-size': 11, fill: TICK_FILL,
        }, shortTime(time))),
        h('g', { key: 'points', 'clip-path': 'url(#tps-scatter-clip)' }, points.map((sample, index) => {
          const hovered = tip !== null && tip.sample === sample
          return h('circle', {
            key: index, cx: x(sample.time), cy: y(sample.tps), r: hovered ? 4.6 : 3.2,
            fill: colorOf.get(modelName(sample)) ?? '#888888', 'fill-opacity': hovered ? 1 : 0.8,
            stroke: hovered ? '#f4f4f5' : 'none', 'stroke-width': 1.4,
          })
        })),
        sel !== null && h('rect', {
          key: 'sel',
          x: Math.min(sel.x0, sel.x1), y: Math.min(sel.y0, sel.y1),
          width: Math.abs(sel.x1 - sel.x0), height: Math.abs(sel.y1 - sel.y0),
          fill: 'currentColor', 'fill-opacity': 0.08,
          stroke: 'currentColor', 'stroke-opacity': 0.7, 'stroke-dasharray': '4 3',
        }),
      ])
      return h(Chart, { tip }, [
        svg,
        h('div', { key: 'zoombar', className: 'tps-zoombar' }, [
          h('span', { key: 'hint' }, t('zoomHint')),
          zoom !== null && h('button', { key: 'reset', className: 'tps-zoomreset', onClick: reset }, t('resetZoom')),
        ]),
      ])
    }

    /**
     * Histogram of visible tok/s readings with a normal-fit reference curve:
     * if decode speeds are roughly normal, the bars peak at the mean and the
     * dashed curve tracks them.
     */
    function HistogramChart({ samples }) {
      const [tip, setTip] = React.useState(null)
      const values = samples.map((sample) => sample.tps).filter((value) => typeof value === 'number' && value > 0).sort((a, b) => a - b)
      if (values.length < 5) return null
      const lo = quantile(values, 0.02)
      const hi = quantile(values, 0.98)
      const span = hi > lo ? hi - lo : (values[values.length - 1] - values[0]) || 1
      const bins = Math.min(24, Math.max(10, Math.round(Math.sqrt(values.length))))
      const binWidth = span / bins
      const counts = new Array(bins).fill(0)
      for (const value of values) {
        const index = Math.min(bins - 1, Math.max(0, Math.floor((value - lo) / binWidth)))
        counts[index] += 1
      }
      const mu = mean(values)
      const sd = std(values)
      const width = 560
      const height = 220
      const m = { left: 40, right: 12, top: 10, bottom: 22 }
      const innerWidth = width - m.left - m.right
      const innerHeight = height - m.top - m.bottom
      const maxCount = Math.max(...counts, 1)
      const barWidth = innerWidth / bins
      const x = (value) => m.left + ((value - lo) / span) * innerWidth
      const y = (count) => m.top + innerHeight * (1 - count / (maxCount * 1.12))
      // Expected bin count under a normal fit: n · binWidth · pdf(x).
      const curve = sd !== null && sd > 0
        ? Array.from({ length: 80 }, (_, index) => {
          const value = lo + (index / 79) * span
          const expected = values.length * binWidth * Math.exp(-((value - mu) ** 2) / (2 * sd * sd)) / (sd * Math.sqrt(2 * Math.PI))
          return { value, expected }
        })
        : []
      const hovered = tip?.bin ?? -1
      return h(Chart, { tip }, h('svg', { className: 'tps-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'histogram' }, [
        [0.5, 1].map((fraction) => h('line', {
          key: String(fraction), x1: m.left, x2: width - m.right, y1: y(maxCount * fraction), y2: y(maxCount * fraction), stroke: GRID_STROKE,
        })),
        h('text', { key: 'yl', x: m.left - 6, y: y(maxCount) + 4, 'text-anchor': 'end', 'font-size': 11, fill: TICK_FILL }, String(maxCount)),
        h('text', { key: 'yl0', x: m.left - 6, y: height - m.bottom + 4, 'text-anchor': 'end', 'font-size': 11, fill: TICK_FILL }, '0'),
        ...counts.map((count, index) => h('rect', {
          key: index,
          x: m.left + index * barWidth + 1, y: y(count), width: Math.max(1, barWidth - 2), height: m.top + innerHeight - y(count),
          rx: 2, fill: 'currentColor', 'fill-opacity': hovered === index ? 0.55 : 0.3,
          onMouseMove: (event) => {
            const p = svgPos(event, width, height)
            setTip({
              px: p.px, py: p.py, flip: p.flip, bin: index,
              lines: [
                `${formatTps(lo + index * binWidth)}–${formatTps(lo + (index + 1) * binWidth)} tok/s`,
                `n = ${count} (${Math.round((count / values.length) * 100)}%)`,
              ],
            })
          },
          onMouseLeave: () => setTip(null),
        })),
        curve.length > 0 && h('path', {
          key: 'curve',
          d: curve.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.value).toFixed(1)},${y(point.expected).toFixed(1)}`).join(''),
          fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.8, 'stroke-width': 1.4, 'stroke-dasharray': '5 4',
        }),
        h('text', { key: 'x0', x: m.left, y: height - 6, 'font-size': 11, fill: TICK_FILL }, formatTps(lo)),
        h('text', { key: 'x1', x: width - m.right, y: height - 6, 'text-anchor': 'end', 'font-size': 11, fill: TICK_FILL }, formatTps(hi)),
      ]))
    }

    /** Horizontal IQR box plot, one row per visible model: whiskers at 1.5·IQR, outliers as dots. */
    function BoxPlotChart({ models, samples }) {
      const [tip, setTip] = React.useState(null)
      const rows = models.filter((entry) => entry.count >= 4)
      if (rows.length === 0) return null
      const pointsByModel = new Map(models.map((entry) => [entry.name, []]))
      for (const sample of samples) {
        if (typeof sample.tps !== 'number' || sample.tps <= 0) continue
        pointsByModel.get(modelName(sample))?.push(sample.tps)
      }
      const width = 560
      const rowHeight = 34
      const height = 30 + rows.length * rowHeight
      const m = { left: 12, right: 14, top: 8 }
      const innerWidth = width - m.left - m.right
      const scaleMax = Math.max(...rows.map((entry) => entry.q3 + 1.5 * (entry.q3 - entry.q1))) * 1.08
      const x = (value) => m.left + (value / scaleMax) * innerWidth
      return h(Chart, { tip }, h('svg', { className: 'tps-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'box plot' }, [
        [0, 0.5, 1].map((fraction) => {
          const value = fraction * scaleMax
          return h('g', { key: String(fraction) }, [
            h('line', { x1: x(value), x2: x(value), y1: m.top, y2: height - 16, stroke: GRID_STROKE }),
            h('text', { x: x(value), y: height - 4, 'text-anchor': 'middle', 'font-size': 10, fill: TICK_FILL }, formatTps(value)),
          ])
        }),
        ...rows.map((entry, index) => {
          const points = [...pointsByModel.get(entry.name)].sort((a, b) => a - b)
          const iqr = entry.q3 - entry.q1
          const loWhisker = Math.max(entry.min, entry.q1 - 1.5 * iqr)
          const hiWhisker = Math.min(entry.max, entry.q3 + 1.5 * iqr)
          const outliers = points.filter((value) => value < loWhisker || value > hiWhisker)
          const cy = m.top + index * rowHeight + 22
          const hovered = tip?.row === entry.name
          return h('g', {
            key: entry.name,
            onMouseMove: (event) => {
              const p = svgPos(event, width, height)
              setTip({
                px: p.px, py: p.py, flip: p.flip, row: entry.name,
                lines: [
                  `${entry.name} (n=${points.length})`,
                  `median ${formatTps(entry.median)} · Q1 ${formatTps(entry.q1)} · Q3 ${formatTps(entry.q3)}`,
                  `whiskers ${formatTps(loWhisker)}–${formatTps(hiWhisker)} (1.5·IQR) · outliers ${outliers.length}`,
                ],
              })
            },
            onMouseLeave: () => setTip(null),
          }, [
            h('text', { x: m.left, y: cy - 11, 'font-size': 11, fill: TICK_FILL }, entry.name),
            h('line', { x1: x(loWhisker), x2: x(hiWhisker), y1: cy, y2: cy, stroke: entry.color, 'stroke-opacity': hovered ? 0.9 : 0.55 }),
            h('line', { x1: x(loWhisker), x2: x(loWhisker), y1: cy - 4, y2: cy + 4, stroke: entry.color, 'stroke-opacity': 0.7 }),
            h('line', { x1: x(hiWhisker), x2: x(hiWhisker), y1: cy - 4, y2: cy + 4, stroke: entry.color, 'stroke-opacity': 0.7 }),
            h('rect', {
              x: x(entry.q1), y: cy - 7, width: Math.max(2, x(entry.q3) - x(entry.q1)), height: 14, rx: 3,
              fill: entry.color, 'fill-opacity': hovered ? 0.55 : 0.35, stroke: entry.color,
            }),
            h('line', { x1: x(entry.median), x2: x(entry.median), y1: cy - 7, y2: cy + 7, stroke: entry.color, 'stroke-width': 2.2 }),
            ...outliers.map((value, outlierIndex) => h('circle', {
              key: outlierIndex, cx: x(value), cy, r: hovered ? 3 : 2.2, fill: entry.color, 'fill-opacity': 0.7,
              onMouseMove: (event) => {
                event.stopPropagation()
                const p = svgPos(event, width, height)
                setTip({ px: p.px, py: p.py, flip: p.flip, row: entry.name, lines: [entry.name, `outlier ${formatTps(value)} tok/s`] })
              },
            })),
            h('rect', { x: m.left, y: cy - 15, width: innerWidth, height: 30, fill: 'transparent', style: { cursor: 'default' } }),
          ])
        }),
      ]))
    }

    /** Median tokens/second per hour of day (local time), across visible models. */
    function HourlyChart({ samples }) {
      const [tip, setTip] = React.useState(null)
      const buckets = Array.from({ length: 24 }, () => [])
      for (const sample of samples) {
        if (typeof sample.tps === 'number' && sample.tps > 0) buckets[new Date(sample.time).getHours()].push(sample.tps)
      }
      const medians = buckets.map((values) => quantile([...values].sort((a, b) => a - b), 0.5))
      const nonNull = medians.filter((value) => value !== null)
      if (nonNull.length === 0) return null
      const max = Math.max(...nonNull) * 1.15
      const width = 560
      const height = 190
      const m = { left: 40, right: 12, top: 10, bottom: 20 }
      const innerWidth = width - m.left - m.right
      const innerHeight = height - m.top - m.bottom
      const slot = innerWidth / 24
      const barWidth = slot * 0.66
      const y = (value) => m.top + innerHeight * (1 - value / max)
      return h(Chart, { tip }, h('svg', { className: 'tps-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'hourly' }, [
        [0.5, 1].map((fraction) => h('line', {
          key: String(fraction), x1: m.left, x2: width - m.right, y1: y(max * fraction / 1.15), y2: y(max * fraction / 1.15), stroke: GRID_STROKE,
        })),
        ...medians.map((value, hour) => {
          if (value === null) return null
          const barHeight = innerHeight - (y(value) - m.top)
          const hovered = tip?.hour === hour
          return h('g', {
            key: hour,
            onMouseMove: (event) => {
              const p = svgPos(event, width, height)
              setTip({
                px: p.px, py: p.py, flip: p.flip, hour,
                lines: [
                  `${String(hour).padStart(2, '0')}:00`,
                  `median ${formatTps(value)} tok/s`,
                  `n = ${buckets[hour].length}`,
                ],
              })
            },
            onMouseLeave: () => setTip(null),
          }, [
            h('rect', {
              x: m.left + hour * slot + (slot - barWidth) / 2, y: y(value), width: barWidth, height: barHeight,
              rx: 2, fill: 'currentColor', 'fill-opacity': hovered ? 0.6 : 0.35,
            }),
            hour % 3 === 0 && h('text', {
              x: m.left + hour * slot + slot / 2, y: height - 5, 'text-anchor': 'middle', 'font-size': 10, fill: TICK_FILL,
            }, String(hour)),
          ])
        }),
      ]))
    }

    /** Compact per-model stats table: n, mean, median, quartiles, extremes. */
    function StatsTable({ models, t }) {
      const labels = [t('colModel'), t('colN'), t('colMean'), t('colMedian'), t('colQ1'), t('colQ3'), t('colMin'), t('colMax')]
      return h('table', { className: 'tps-table' }, [
        h('thead', { key: 'head' }, h('tr', null, labels.map((label, index) => h('th', { key: index }, label)))),
        h('tbody', { key: 'body' }, models.map((entry) => h('tr', { key: entry.name }, [
          h('td', { key: 'name' }, h('span', { className: 'tps-model' }, [
            h('span', { key: 'dot', className: 'tps-dot', style: { background: entry.color } }),
            entry.name,
          ])),
          [entry.count, entry.mean, entry.median, entry.q1, entry.q3, entry.min, entry.max].map((value, index) =>
            h('td', { key: index }, typeof value === 'number' ? formatTps(value) : String(value ?? '—'))),
        ]))),
      ])
    }

    /**
     * Verbosity table: medians of output tokens, thinking share, visible and
     * reasoning characters, and the out/in ratio per model.
     */
    function VerbosityTable({ rows, t }) {
      const labels = [t('colModel'), t('colN'), t('colOutTok'), t('colThinkShare'), t('colText'), t('colThink'), t('colOutIn')]
      const fmtInt = (value) => value === null || value === undefined ? '—' : (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value)))
      const fmtPct = (value, estimated) => value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%${estimated ? '*' : ''}`
      const fmtRatio = (value) => value === null || value === undefined ? '—' : value.toFixed(value < 0.1 ? 3 : 2)
      return h('table', { className: 'tps-table' }, [
        h('thead', { key: 'head' }, h('tr', null, labels.map((label, index) => h('th', { key: index }, label)))),
        h('tbody', { key: 'body' }, rows.map((row) => h('tr', { key: row.name }, [
          h('td', { key: 'name' }, row.name),
          h('td', { key: 'n' }, fmtInt(row.n)),
          h('td', { key: 'out' }, fmtInt(row.medOutput)),
          h('td', { key: 'share' }, fmtPct(row.medShare, row.shareEstimated)),
          h('td', { key: 'text' }, fmtInt(row.medText)),
          h('td', { key: 'think' }, fmtInt(row.medThink)),
          h('td', { key: 'outin' }, fmtRatio(row.medOutIn)),
        ]))),
      ])
    }

    /* ---------- panel ---------- */

    function TokSpeedPanel(props) {
      const translate = props?.t ?? boundT
      const [state, setState] = React.useState({ status: 'loading', samples: [], summary: null, message: null })
      const [hidden, setHidden] = React.useState(() => new Set())
      const [settings, setSettings] = React.useState(null)
      const [ceiling, setCeiling] = React.useState(DEFAULT_MAX_PLAUSIBLE_TPS)
      const [settingsStatus, setSettingsStatus] = React.useState('idle')
      const endpoints = typeof window !== 'undefined' && window.__DSH_TOKSPEED__
      const url = endpoints?.url
      const summaryUrl = endpoints?.summaryUrl
        ?? (typeof url === 'string' ? url.replace('samples.jsonl', 'summary.json') : undefined)
      const configUrl = endpoints?.configUrl
        ?? (typeof url === 'string' ? url.replace('samples.jsonl', 'config') : undefined)
      const load = React.useCallback(() => {
        if (typeof url !== 'string') {
          setState({ status: 'error', samples: [], summary: null, message: 'reload' })
          return
        }
        setState((current) => ({ ...current, status: 'loading' }))
        Promise.all([
          fetch(url, { cache: 'no-store' }).then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.text()
          }),
          typeof summaryUrl === 'string'
            ? fetch(summaryUrl, { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).catch(() => null)
            : Promise.resolve(null),
        ])
          .then(([text, summary]) => setState({ status: 'ready', samples: parseSamples(text, ceiling), summary, message: null }))
          .catch((error) => setState({ status: 'error', samples: [], summary: null, message: String(error) }))
      }, [url, summaryUrl, ceiling])
      const loadSettings = React.useCallback(() => {
        if (typeof configUrl !== 'string') return
        fetch(configUrl, { cache: 'no-store' })
          .then((response) => response.ok ? response.json() : null)
          .then((config) => {
            if (config === null) return
            setCeiling(typeof config.maxPlausibleTps === 'number' ? config.maxPlausibleTps : DEFAULT_MAX_PLAUSIBLE_TPS)
            setSettings({
              mb: String(Math.round(config.maxFileBytes / 1_048_576)),
              days: String(config.maxAgeDays),
              interval: String(Math.round(config.sampleMinIntervalMs / 1000)),
              tps: config.maxPlausibleTps === undefined ? '' : String(config.maxPlausibleTps),
            })
          })
          .catch(() => {})
      }, [configUrl])
      React.useEffect(() => { load(); loadSettings() }, [load, loadSettings])
      const saveSettings = () => {
        if (typeof configUrl !== 'string' || settings === null) return
        setSettingsStatus('saving')
        fetch(configUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            maxFileBytes: Math.max(0, Number(settings.mb) || 0) * 1_048_576,
            maxAgeDays: Math.max(0, Number(settings.days) || 0),
            sampleMinIntervalMs: Math.max(0, Number(settings.interval) || 0) * 1000,
            ...(settings.tps === '' ? {} : { maxPlausibleTps: Math.max(1, Number(settings.tps) || 500) }),
          }),
        })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            setSettingsStatus('saved')
            load()
          })
          .catch(() => setSettingsStatus('error'))
      }

      const allModels = modelStats(state.samples)
      const models = allModels.filter((entry) => !hidden.has(entry.name))
      const visibleSamples = state.samples.filter((sample) => !hidden.has(modelName(sample)))
      const toggle = (name) => setHidden((current) => {
        const next = new Set(current)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
      const solo = (name) => setHidden((current) => {
        const next = new Set()
        for (const entry of allModels) if (entry.name !== name) next.add(entry.name)
        return next.size === current.size ? new Set() : next
      })

      const chartsReady = state.status === 'ready' && visibleSamples.length > 0
      return h('div', { className: 'tps-root' }, [
        h('style', { key: 'styles' }, STYLES),
        h('div', { key: 'head', className: 'tps-head' }, [
          h('h2', { key: 'title', className: 'tps-title' }, translate('title')),
          h('span', { key: 'count', className: 'tps-count' },
            `${translate('samplesCount', { n: state.samples.length })}${hidden.size > 0 ? ` · ${translate('shown', { shown: visibleSamples.length, n: state.samples.length })}` : ''}`),
          h('button', { key: 'refresh', className: 'tps-btn', onClick: load }, translate('refresh')),
        ]),
        h('p', { key: 'hint', className: 'tps-hint' }, translate('hint')),
        state.status === 'loading' && state.samples.length === 0 && h('p', { key: 'loading', className: 'tps-note' }, translate('loading')),
        state.status === 'error' && h('p', { key: 'error', className: 'tps-note' },
          state.message === 'reload' ? translate('reload') : `${translate('error')}: ${state.message ?? ''}`),
        state.status !== 'error' && state.status === 'ready' && state.samples.length === 0 && h('p', { key: 'empty', className: 'tps-note' }, translate('empty')),
        allModels.length > 0 && h('div', { key: 'chips', className: 'tps-chips' }, [
          h('button', {
            key: 'all', className: 'tps-chip', onClick: () => setHidden(new Set()),
            title: translate('all'),
          }, translate('all')),
          ...allModels.map((entry) => h('button', {
            key: entry.name, className: 'tps-chip', 'data-off': hidden.has(entry.name) ? '1' : '0',
            onClick: () => toggle(entry.name),
          }, [
            h('span', { key: 'dot', className: 'tps-dot', style: { background: entry.color, opacity: hidden.has(entry.name) ? 0.3 : 1 } }),
            h('span', { key: 'name', className: 'tps-chip-name' }, `${entry.name} (${entry.count})`),
            h('span', {
              key: 'solo', className: 'tps-solo', title: translate('solo'), onClick: (event) => {
                event.stopPropagation()
                solo(entry.name)
              },
            }, '◎'),
          ])),
        ]),
        chartsReady && h('div', { key: 'grid', className: 'tps-grid' }, [
          h('section', { key: 'scatter', className: 'tps-card tps-card-wide' }, [
            h('h3', { key: 'label', className: 'tps-card-title' }, translate('overTime')),
            h(ScatterChart, { samples: visibleSamples, models, t: translate }),
          ]),
          h('section', { key: 'hist', className: 'tps-card' }, [
            h('h3', { key: 'label', className: 'tps-card-title' }, translate('hist')),
            h(HistogramChart, { samples: visibleSamples }),
          ]),
          h('section', { key: 'box', className: 'tps-card' }, [
            h('h3', { key: 'label', className: 'tps-card-title' }, translate('box')),
            h(BoxPlotChart, { models, samples: visibleSamples }),
          ]),
          h('section', { key: 'hourly', className: 'tps-card' }, [
            h('h3', { key: 'label', className: 'tps-card-title' }, translate('hourly')),
            h(HourlyChart, { samples: visibleSamples }),
          ]),
          h('section', { key: 'verbosity', className: 'tps-card tps-card-wide' }, [
            h('h3', { key: 'label', className: 'tps-card-title' }, translate('verbosity')),
            h(VerbosityTable, { rows: verbosityStats(visibleSamples), t: translate }),
            h('p', { key: 'vhint', className: 'tps-hint', style: { margin: '6px 0 2px' } }, translate('verbosityHint')),
          ]),
          h('section', { key: 'table', className: 'tps-card tps-card-wide' }, [
            h('h3', { key: 'label', className: 'tps-card-title' }, translate('table')),
            h(StatsTable, { models, t: translate }),
          ]),
        ]),
        state.summary !== null && h('p', {
          key: 'footer', className: 'tps-hint',
          style: { marginTop: 14, borderTop: '1px solid rgba(128,128,128,.2)', paddingTop: 10 },
        }, translate('footer', {
          mb: (state.summary.retention.maxFileBytes / 1_048_576).toFixed(0),
          days: String(state.summary.retention.maxAgeDays),
          interval: String(Math.round(state.summary.retention.sampleMinIntervalMs / 1000)),
          n: state.summary.samples,
          date: state.summary.oldest !== null ? shortTime(state.summary.oldest) : '—',
          kb: String(Math.round(state.summary.fileBytes / 1024)),
          excluded: String(state.samples.filter((sample) => sample.unmeasurable).length),
        })),
        settings !== null && h('details', { key: 'settings', className: 'tps-card', style: { marginTop: 12 } }, [
          h('summary', { key: 'summary', className: 'tps-card-title', style: { cursor: 'pointer' } }, translate('settingsSummary')),
          h('div', { key: 'form', style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 } }, [
            [translate('daysLabel'), 'days'],
            [translate('mbLabel'), 'mb'],
            [translate('intervalLabel'), 'interval'],
            [translate('tpsLabel'), 'tps'],
          ].map(([label, key]) => h('label', { key, style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, opacity: .85 } }, [
            label,
            h('input', {
              type: 'number', min: 0, value: settings[key],
              onChange: (event) => setSettings((current) => ({ ...current, [key]: event.target.value })),
              style: { width: 110, padding: '4px 8px', fontSize: 13, borderRadius: 6, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit' },
            }),
          ]))),
          h('button', { className: 'tps-btn', style: { marginLeft: 0 }, onClick: saveSettings },
            settingsStatus === 'saving' ? translate('saving') : translate('save')),
          settingsStatus === 'saved' && h('span', { style: { fontSize: 12, opacity: .6 } }, translate('saved')),
          settingsStatus === 'error' && h('span', { style: { fontSize: 12, opacity: .7 } }, translate('saveFailed')),
        ]),
      ])
    }

    function TokSpeedIcon({ size, active: _active }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size ?? 18, height: size ?? 18, 'aria-hidden': true,
        style: { display: 'block' }, fill: 'none', stroke: 'currentColor',
      }, [
        h('path', { d: 'M4.5 17.5a7.5 7.5 0 1 1 15 0', 'stroke-width': 2, 'stroke-linecap': 'round' }),
        h('line', { x1: 12, y1: 17.5, x2: 16.2, y2: 10.5, 'stroke-width': 2, 'stroke-linecap': 'round' }),
        h('circle', { cx: 12, cy: 17.5, r: 1.6, fill: 'currentColor', stroke: 'none' }),
      ])
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTS), 'tokspeed: dictionaries')
        const t = ctx.locale.bind(NS)
        boundT = t
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, TokSpeedPanel))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: () => t('panel'), locale: NS,
        }, TokSpeedIcon))
      },
    }
  },
})
