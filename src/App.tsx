import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Simulation, TICK_MS } from './engine/simulation'
import { loadFromGitHub, saveToGitHub } from './engine/githubSync'
import type { Entity, WorldObject } from './engine/types'

// ── Color helpers ─────────────────────────────────────────────────────────────
function emotionColor(emotion: string): string {
  switch (emotion) {
    case 'joy': case 'elation':            return '#f59e0b'
    case 'wonder': case 'curiosity':       return '#22d3ee'
    case 'hope': case 'love':              return '#f472b6'
    case 'content': case 'calm':           return '#4ade80'
    case 'sadness': case 'grief':          return '#60a5fa'
    case 'loneliness':                     return '#818cf8'
    case 'fear': case 'existential_dread': return '#a78bfa'
    case 'anger': case 'frustration':      return '#f87171'
    case 'contemplation': case 'acceptance': return '#94a3b8'
    default:                               return '#64748b'
  }
}

function energyColor(e: number): string {
  if (e > 60) return '#4ade80'
  if (e > 30) return '#fbbf24'
  return '#f87171'
}

// ── Face SVG helpers ──────────────────────────────────────────────────────────
function mouthPath(emotion: string, cx: number, cy: number): string {
  const y = cy + 5
  switch (emotion) {
    case 'joy': case 'elation': case 'hope': case 'love':
      return `M ${cx-6},${y-1} Q ${cx},${y+6} ${cx+6},${y-1}`
    case 'wonder': case 'curiosity':
      return `M ${cx-5},${y+1} Q ${cx},${y+5} ${cx+5},${y+1}`
    case 'sadness': case 'grief': case 'loneliness':
      return `M ${cx-6},${y+5} Q ${cx},${y-1} ${cx+6},${y+5}`
    case 'fear': case 'existential_dread':
      return `M ${cx-4},${y+2} Q ${cx},${y+7} ${cx+4},${y+2}`
    case 'anger': case 'frustration':
      return `M ${cx-6},${y+4} L ${cx-2},${y+2} L ${cx+2},${y+2} L ${cx+6},${y+4}`
    case 'content': case 'calm':
      return `M ${cx-5},${y+2} Q ${cx},${y+4} ${cx+5},${y+2}`
    default:
      return `M ${cx-5},${y+2} L ${cx+5},${y+2}`
  }
}

function eyebrowPath(emotion: string, side: 'L'|'R', cx: number, cy: number): string {
  const bx = side === 'L' ? cx - 5 : cx + 5
  const by = cy - 9
  const hw = 3.5
  switch (emotion) {
    case 'anger': case 'frustration':
      return side === 'L'
        ? `M ${bx-hw},${by+2} L ${bx+hw},${by-1}`
        : `M ${bx-hw},${by-1} L ${bx+hw},${by+2}`
    case 'fear': case 'existential_dread':
      return `M ${bx-hw},${by-1} L ${bx+hw},${by-1}`
    case 'wonder': case 'joy': case 'elation':
      return `M ${bx-hw},${by-1} Q ${bx},${by-3} ${bx+hw},${by-1}`
    default:
      return `M ${bx-hw},${by} L ${bx+hw},${by}`
  }
}

// ── Zone layout ────────────────────────────────────────────────────────────────
const ZONE_NAMES  = ['Garden', 'Archive', 'Void', 'Storm'] as const
const ZONE_ES     = { Garden: 'Jardín', Archive: 'Archivo', Void: 'Vacío', Storm: 'Tormenta' }
const ZONE_TINT: Record<string, string> = {
  Garden:  'rgba(134,239,172,0.08)',
  Archive: 'rgba(147,197,253,0.07)',
  Void:    'rgba(167,139,250,0.11)',
  Storm:   'rgba(251,146,60,0.08)',
}
const ZONE_LABEL_CLR: Record<string, string> = {
  Garden: '#4ade80', Archive: '#93c5fd', Void: '#c4b5fd', Storm: '#fb923c',
}
const GND_FRAC   = 0.62
const WANDER_ABOVE = 90
const WANDER_BELOW = 25

const STATIC_STARS = [
  {x:0.05,y:0.04,r:1.5},{x:0.13,y:0.08,r:1},{x:0.22,y:0.03,r:2},
  {x:0.31,y:0.11,r:1},{x:0.40,y:0.05,r:1.5},{x:0.48,y:0.09,r:1},
  {x:0.57,y:0.03,r:2},{x:0.65,y:0.07,r:1.5},{x:0.73,y:0.04,r:1},
  {x:0.82,y:0.10,r:1.5},{x:0.90,y:0.03,r:1},{x:0.96,y:0.07,r:2},
  {x:0.08,y:0.18,r:1},{x:0.19,y:0.22,r:1.5},{x:0.34,y:0.16,r:1},
  {x:0.47,y:0.21,r:1.5},{x:0.60,y:0.15,r:1},{x:0.74,y:0.20,r:2},
  {x:0.88,y:0.17,r:1},{x:0.25,y:0.30,r:1.5},{x:0.55,y:0.28,r:1},
  {x:0.79,y:0.32,r:1.5},{x:0.92,y:0.27,r:1},
]

function makePeaks(w: number, gndY: number): string {
  const pts: string[] = []
  const steps = 22
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * w
    const h = ((i * 2654435761 * 13) >>> 0) / 0xffffffff
    const y = gndY - 55 - h * 110
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  pts.push(`${w},${gndY}`, `0,${gndY}`)
  return pts.join(' ')
}

// ── Static background (memoized) ──────────────────────────────────────────────
interface BgProps { w: number; h: number; gndY: number }
const BackgroundSvg = memo(({ w, h, gndY }: BgProps) => {
  const peaks = useMemo(() => makePeaks(w, gndY), [w, gndY])
  const ZW = w / 4
  return (
    <svg width={w} height={h} style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0"    stopColor="#020617" />
          <stop offset="0.35" stopColor="#0f172a" />
          <stop offset="0.65" stopColor="#1a2a3a" />
          <stop offset="1"    stopColor="#243447" />
        </linearGradient>
        <linearGradient id="gnd" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0"   stopColor="#1e2d3d" />
          <stop offset="0.5" stopColor="#162030" />
          <stop offset="1"   stopColor="#0d1520" />
        </linearGradient>
        <linearGradient id="mtn" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0"   stopColor="#1a2535" />
          <stop offset="1"   stopColor="#0f1a28" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill="url(#sky)" />
      {ZONE_NAMES.map((z, i) => (
        <rect key={z} x={i*ZW} y={0} width={ZW} height={gndY} fill={ZONE_TINT[z]} />
      ))}
      {STATIC_STARS.map((s, i) => (
        <circle key={i} cx={s.x*w} cy={s.y*gndY} r={s.r} fill="rgba(255,255,255,0.75)" />
      ))}
      <circle cx={w*0.85} cy={gndY*0.12} r={18} fill="#f1f5f9" fillOpacity={0.9} />
      <circle cx={w*0.85+8} cy={gndY*0.12-6} r={14} fill="#0f172a" />
      <polygon points={peaks} fill="url(#mtn)" />
      <rect x={0} y={gndY} width={w} height={h-gndY} fill="url(#gnd)" />
      <rect x={0} y={gndY} width={w} height={2} fill="rgba(148,163,184,0.15)" />
      {ZONE_NAMES.map((z, i) => (
        <rect key={z} x={i*ZW} y={gndY} width={ZW} height={h-gndY} fill={ZONE_TINT[z]} />
      ))}
      {ZONE_NAMES.map((z, i) => (
        <text key={z} x={i*ZW+ZW/2} y={gndY+18} fontSize={10} textAnchor="middle"
          fontWeight="700" fill={ZONE_LABEL_CLR[z]} fillOpacity={0.45}>
          {ZONE_ES[z]}
        </text>
      ))}
    </svg>
  )
})
BackgroundSvg.displayName = 'BackgroundSvg'

// ── World objects ─────────────────────────────────────────────────────────────
function AppleTree({ obj, gndY, ZW }: { obj: WorldObject; gndY: number; ZW: number }) {
  const zoneIdx = ZONE_NAMES.indexOf(obj.zone as typeof ZONE_NAMES[number])
  const cx   = (zoneIdx >= 0 ? zoneIdx : 0) * ZW + obj.x * ZW
  const baseY = gndY + obj.y * 25
  const applePositions = useMemo(() => {
    const dots: {ax: number; ay: number}[] = []
    for (let i = 0; i < obj.max_apples; i++) {
      const angle = (i / obj.max_apples) * Math.PI * 2
      dots.push({ ax: cx + Math.cos(angle)*11, ay: baseY-42 + Math.sin(angle)*11 })
    }
    return dots
  }, [cx, baseY, obj.max_apples])
  return (
    <g>
      <rect x={cx-4} y={baseY-28} width={8} height={28} rx={2} fill="#7c5c3a" />
      <circle cx={cx} cy={baseY-44} r={20} fill="rgba(0,0,0,0.2)" />
      <circle cx={cx} cy={baseY-44} r={19} fill={obj.hp < 40 ? '#4a5540' : '#2d6a2d'} />
      <circle cx={cx} cy={baseY-44} r={15} fill={obj.hp < 40 ? '#3a4535' : '#3a8f3a'} />
      {applePositions.map((a, i) => (
        <circle key={i} cx={a.ax} cy={a.ay} r={3.5}
          fill={i < obj.apples ? '#ef4444' : 'rgba(0,0,0,0.2)'}
          stroke={i < obj.apples ? '#dc2626' : 'none'} strokeWidth={0.5} />
      ))}
      {obj.hp < 60 && (
        <text x={cx} y={baseY-64} textAnchor="middle" fontSize={9} fill="#fbbf24">
          {obj.hp}hp
        </text>
      )}
    </g>
  )
}

function Bush({ obj, gndY, ZW }: { obj: WorldObject; gndY: number; ZW: number }) {
  const zoneIdx = ZONE_NAMES.indexOf(obj.zone as typeof ZONE_NAMES[number])
  const cx = (zoneIdx >= 0 ? zoneIdx : 0) * ZW + obj.x * ZW
  const baseY = gndY + 4
  return (
    <g>
      <ellipse cx={cx} cy={baseY-8} rx={14} ry={9} fill="#1a4a1a" />
      <circle cx={cx-7} cy={baseY-6} r={8} fill="#1e5c1e" />
      <circle cx={cx+7} cy={baseY-6} r={8} fill="#1e5c1e" />
      <circle cx={cx} cy={baseY-12} r={9} fill="#256625" />
    </g>
  )
}

function Log({ obj, gndY, ZW }: { obj: WorldObject; gndY: number; ZW: number }) {
  const zoneIdx = ZONE_NAMES.indexOf(obj.zone as typeof ZONE_NAMES[number])
  const cx = (zoneIdx >= 0 ? zoneIdx : 0) * ZW + obj.x * ZW
  const baseY = gndY + 6
  return (
    <g>
      <rect x={cx-18} y={baseY-8} width={36} height={10} rx={5} fill="#6b4a2a" />
      <ellipse cx={cx-18} cy={baseY-3} rx={5} ry={6} fill="#7c5c3a" />
      <ellipse cx={cx+18} cy={baseY-3} rx={5} ry={6} fill="#7c5c3a" />
      <ellipse cx={cx} cy={baseY-7} rx={5} ry={2.5} fill="rgba(255,255,255,0.1)" />
    </g>
  )
}

function Pond({ obj, gndY, ZW }: { obj: WorldObject; gndY: number; ZW: number }) {
  const zoneIdx = ZONE_NAMES.indexOf(obj.zone as typeof ZONE_NAMES[number])
  const cx = (zoneIdx >= 0 ? zoneIdx : 0) * ZW + obj.x * ZW
  const baseY = gndY + 6
  return (
    <g>
      <ellipse cx={cx} cy={baseY} rx={22} ry={10} fill="rgba(30,80,160,0.55)" />
      <ellipse cx={cx} cy={baseY} rx={18} ry={7} fill="rgba(56,130,210,0.4)" />
      <ellipse cx={cx-4} cy={baseY-2} rx={7} ry={2.5} fill="rgba(147,210,255,0.25)" />
    </g>
  )
}

// ── Entity face ───────────────────────────────────────────────────────────────
interface FaceProps {
  entity: Entity; x: number; y: number; selected: boolean; onPress: () => void
}
function EntityFace({ entity: e, x, y, selected, onPress }: FaceProps) {
  const emotion = e.emotional_state.emotion
  const clr     = emotionColor(emotion)
  const cx = x, cy = y
  const pupilDx = Math.sin(Date.now() * 0.001 + e.id) * 1.5
  const pupilDy = Math.cos(Date.now() * 0.001 + e.id) * 1

  return (
    <g onClick={onPress} style={{ cursor: 'pointer' }}>
      {selected && <circle cx={cx} cy={cy} r={16} fill="none" stroke={clr} strokeWidth={2} strokeDasharray="4 3" />}
      {/* Shadow */}
      <ellipse cx={cx} cy={cy+12} rx={11} ry={4} fill="rgba(0,0,0,0.3)" />
      {/* Body */}
      <circle cx={cx} cy={cy} r={12} fill="#1e293b" stroke={clr} strokeWidth={selected ? 2 : 1.5} />
      {/* Eyes */}
      <circle cx={cx-4} cy={cy-3} r={3.5} fill="white" />
      <circle cx={cx+4} cy={cy-3} r={3.5} fill="white" />
      <circle cx={cx-4+pupilDx} cy={cy-3+pupilDy} r={2} fill="#0f172a" />
      <circle cx={cx+4+pupilDx} cy={cy-3+pupilDy} r={2} fill="#0f172a" />
      {/* Pupils shine */}
      <circle cx={cx-3.5+pupilDx} cy={cy-4+pupilDy} r={0.7} fill="white" />
      <circle cx={cx+4.5+pupilDx} cy={cy-4+pupilDy} r={0.7} fill="white" />
      {/* Eyebrows */}
      <path d={eyebrowPath(emotion, 'L', cx, cy)} stroke={clr} strokeWidth={1.5} fill="none" strokeLinecap="round" />
      <path d={eyebrowPath(emotion, 'R', cx, cy)} stroke={clr} strokeWidth={1.5} fill="none" strokeLinecap="round" />
      {/* Mouth */}
      <path d={mouthPath(emotion, cx, cy)} stroke={clr} strokeWidth={1.5} fill="none" strokeLinecap="round" />
      {/* Energy bar */}
      <rect x={cx-10} y={cy+10} width={20} height={2.5} rx={1.2} fill="rgba(0,0,0,0.4)" />
      <rect x={cx-10} y={cy+10} width={20*(e.energy/e.max_energy)} height={2.5} rx={1.2} fill={energyColor(e.energy)} />
      {/* Gen badge */}
      {e.generation > 1 && (
        <text x={cx+11} y={cy-9} fontSize={7} fill="#94a3b8" fontWeight="800">G{e.generation}</text>
      )}
    </g>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
interface WanderTarget { tx: number; ty: number; expires: number }

export default function App() {
  const simRef = useRef<Simulation | null>(null)
  if (!simRef.current) {
    const saved = Simulation.load()   // localStorage fallback while GitHub loads
    simRef.current = new Simulation(saved ?? undefined)
  }

  const [state, setState] = useState(() => simRef.current!.state)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [savedFlash, setSavedFlash] = useState<'idle'|'saving'|'ok'|'err'>('idle')
  const [feedFlash, setFeedFlash]   = useState(false)
  const [bathFlash, setBathFlash]   = useState(false)
  const [paused, setPaused]         = useState(false)

  // Load from GitHub on startup (overrides localStorage if available)
  useEffect(() => {
    loadFromGitHub().then(ghState => {
      if (!ghState) return
      simRef.current = new Simulation(ghState)
      setState({ ...simRef.current.state })
    })
  }, [])

  // Dimensions
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const { w, h } = size
  const ZW    = w / 4
  const HDR_H = 52
  const worldH = h - HDR_H
  const gndY  = worldH * GND_FRAC

  // ── Sim tick ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (paused) return
    const id = setInterval(() => {
      const s = simRef.current!.tick()
      setState({ ...s })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [paused])

  // ── 30fps animation loop (positions) ─────────────────────────────────────
  const posRef    = useRef(new Map<number, {x:number; y:number}>())
  const wanderRef = useRef(new Map<number, WanderTarget>())
  const [animTick, setAnimTick] = useState(0)

  const aliveEntities = state.entities.filter(e => e.is_alive)

  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      if (now - last >= 33) {
        last = now
        aliveEntities.forEach(e => {
          let wt = wanderRef.current.get(e.id)
          if (!wt || now > wt.expires) {
            const zoneIdx = ZONE_NAMES.indexOf(e.current_zone as typeof ZONE_NAMES[number])
            const zoneX = (zoneIdx >= 0 ? zoneIdx : 0) * ZW
            wt = {
              tx: zoneX + 14 + Math.random() * (ZW - 28),
              ty: gndY - WANDER_ABOVE + Math.random() * (WANDER_ABOVE + WANDER_BELOW),
              expires: now + 2500 + Math.random() * 4500,
            }
            wanderRef.current.set(e.id, wt)
          }
          let pos = posRef.current.get(e.id)
          if (!pos) {
            pos = { x: wt.tx, y: wt.ty }
            posRef.current.set(e.id, pos)
          }
          pos.x += (wt.tx - pos.x) * 0.035
          pos.y += (wt.ty - pos.y) * 0.035
        })
        setAnimTick(t => t + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aliveEntities.length, gndY, ZW])

  // Deselect dead entity
  useEffect(() => {
    if (selectedId != null && !aliveEntities.some(e => e.id === selectedId)) {
      setSelectedId(null)
    }
  }, [aliveEntities, selectedId])

  const selected = selectedId != null ? aliveEntities.find(e => e.id === selectedId) : null

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const s = simRef.current!.state
    simRef.current!.save()    // localStorage instantly
    setSavedFlash('saving')
    const ok = await saveToGitHub(s)
    setSavedFlash(ok ? 'ok' : 'err')
    setTimeout(() => setSavedFlash('idle'), 2000)
  }
  const handleFeedAll = () => {
    simRef.current!.feedAll()
    setState({ ...simRef.current!.state })
    setFeedFlash(true)
    setTimeout(() => setFeedFlash(false), 1200)
  }
  const handleBathAll = () => {
    simRef.current!.bathAll()
    setState({ ...simRef.current!.state })
    setBathFlash(true)
    setTimeout(() => setBathFlash(false), 1200)
  }
  const handleFeed = useCallback((id: number) => {
    simRef.current!.feedEntity(id)
    setState({ ...simRef.current!.state })
  }, [])
  const handleBath = useCallback((id: number) => {
    simRef.current!.bathEntity(id)
    setState({ ...simRef.current!.state })
  }, [])
  const handleReset = () => {
    if (!confirm('¿Borrar todo y empezar de nuevo?')) return
    Simulation.clearSave()
    simRef.current = new Simulation()
    setState({ ...simRef.current.state })
    posRef.current.clear()
    wanderRef.current.clear()
    setSelectedId(null)
  }

  // Last event
  const lastEvent = state.events[state.events.length - 1]

  // Suppress unused animTick lint
  void animTick

  const tick = state.world.current_tick

  return (
    <div style={{ width:'100%', height:'100%', background:'#020617', overflow:'hidden', fontFamily:'system-ui,sans-serif' }}>

      {/* Header */}
      <div style={{
        position:'absolute', top:0, left:0, right:0, height: HDR_H,
        display:'flex', alignItems:'center', padding:'0 16px', gap:10,
        background:'rgba(2,6,23,0.88)',
        borderBottom:'1px solid rgba(148,163,184,0.12)',
        zIndex:20,
      }}>
        <div style={{ flex:1 }}>
          <span style={{ fontSize:17, fontWeight:800, color:'#22d3ee', letterSpacing:0.5 }}>Uberis</span>
          <span style={{ fontSize:11, color:'#64748b', marginLeft:10 }}>
            {aliveEntities.length} vivos · tick {tick} · {state.world.season}
          </span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <IconBtn emoji="🍎" flash={feedFlash} flashColor="#f59e0b" onClick={handleFeedAll} title="Alimentar todos" />
          <IconBtn emoji="🚿" flash={bathFlash} flashColor="#38bdf8" onClick={handleBathAll} title="Bañar todos" />
          <IconBtn emoji={paused ? '▶' : '⏸'} onClick={() => setPaused(p => !p)} title={paused ? 'Reanudar' : 'Pausar'} />
          <IconBtn
            emoji={savedFlash === 'saving' ? '…' : savedFlash === 'ok' ? '✓' : savedFlash === 'err' ? '✗' : '💾'}
            flash={savedFlash === 'ok'} flashColor="#22c55e"
            onClick={handleSave} title="Guardar en GitHub"
          />
          <IconBtn emoji="🗑" onClick={handleReset} title="Reiniciar mundo" />
        </div>
      </div>

      {/* World SVG layer */}
      <div style={{ position:'absolute', top: HDR_H, left:0, right:0, bottom:0 }}>
        <BackgroundSvg w={w} h={worldH} gndY={gndY} />

        {/* World objects + entities */}
        <svg width={w} height={worldH} style={{ position:'absolute', inset:0 }}>
          {state.worldObjects.map(obj => {
            if (obj.type === 'apple_tree') return <AppleTree key={obj.id} obj={obj} gndY={gndY} ZW={ZW} />
            if (obj.type === 'bush')       return <Bush      key={obj.id} obj={obj} gndY={gndY} ZW={ZW} />
            if (obj.type === 'log')        return <Log       key={obj.id} obj={obj} gndY={gndY} ZW={ZW} />
            if (obj.type === 'pond')       return <Pond      key={obj.id} obj={obj} gndY={gndY} ZW={ZW} />
            return null
          })}
          {aliveEntities.map(e => {
            const pos = posRef.current.get(e.id)
            if (!pos) return null
            return (
              <EntityFace key={e.id} entity={e} x={pos.x} y={pos.y}
                selected={e.id === selectedId}
                onPress={() => setSelectedId(prev => prev === e.id ? null : e.id)} />
            )
          })}
        </svg>

        {/* Event ticker */}
        {lastEvent && (
          <div style={{
            position:'absolute', bottom: selected ? 130 : 16,
            left:'50%', transform:'translateX(-50%)',
            fontSize:11, color:'rgba(148,163,184,0.7)', fontStyle:'italic',
            whiteSpace:'nowrap', pointerEvents:'none',
            transition:'bottom 0.2s',
          }}>
            {lastEvent.type === 'pick_apple'    ? `🍎 ${lastEvent.entity as string} tomó una manzana` :
             lastEvent.type === 'tree_chopped'   ? `🪵 ${lastEvent.entity as string} taló un árbol` :
             lastEvent.type === 'entity_bathed'  ? `🚿 ${lastEvent.entity as string} se bañó` :
             lastEvent.type === 'entity_born'    ? `✨ ${lastEvent.name as string} nació` :
             lastEvent.type === 'entity_died'    ? `💀 ${lastEvent.name as string} murió` :
             lastEvent.type === 'structure_built'? `🔨 ${lastEvent.builder as string} construyó algo` :
             null}
          </div>
        )}

        {/* Selected entity panel */}
        {selected && (
          <div style={{
            position:'absolute', bottom:0, left:0, right:0,
            background:'rgba(15,23,42,0.96)',
            borderTop:'1px solid rgba(148,163,184,0.15)',
            padding:'12px 16px', display:'flex', alignItems:'center', gap:12,
          }}>
            <button onClick={() => setSelectedId(null)}
              style={{ background:'none', border:'none', color:'#64748b', fontSize:16, cursor:'pointer', padding:'0 4px' }}>
              ✕
            </button>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:700, color: emotionColor(selected.emotional_state.emotion) }}>
                {selected.name}
              </div>
              <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
                {selected.emotional_state.emotion} · {selected.energy.toFixed(0)} energía · G{selected.generation}
              </div>
              {selected.last_thought && (
                <div style={{ fontSize:11, color:'#94a3b8', fontStyle:'italic', marginTop:3,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  "{selected.last_thought}"
                </div>
              )}
              {(selected.resources?.wood ?? 0) > 0 && (
                <div style={{ fontSize:11, color:'#fbbf24', marginTop:2 }}>
                  🪵 {selected.resources!.wood} madera
                </div>
              )}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <ActionBtn emoji="🍎" label="Alimentar" onClick={() => handleFeed(selected.id)} />
              <ActionBtn emoji="🚿" label="Bañar"     onClick={() => handleBath(selected.id)} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Small UI components ───────────────────────────────────────────────────────
function IconBtn({ emoji, onClick, title, flash, flashColor }: {
  emoji: string; onClick: () => void; title?: string
  flash?: boolean; flashColor?: string
}) {
  return (
    <button onClick={onClick} title={title} style={{
      width:34, height:34, borderRadius:17, border:'1px solid',
      borderColor: flash ? (flashColor ?? '#22c55e') : '#334155',
      background: flash ? 'rgba(34,197,94,0.1)' : '#0f172a',
      color:'white', fontSize:15, cursor:'pointer',
      display:'flex', alignItems:'center', justifyContent:'center',
      transition:'border-color 0.2s, background 0.2s',
    }}>
      {emoji}
    </button>
  )
}

function ActionBtn({ emoji, label, onClick }: { emoji: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display:'flex', flexDirection:'column', alignItems:'center', gap:2,
      background:'rgba(30,41,59,0.8)', border:'1px solid #334155',
      borderRadius:10, padding:'8px 14px', cursor:'pointer', color:'white',
    }}>
      <span style={{ fontSize:20 }}>{emoji}</span>
      <span style={{ fontSize:10, color:'#94a3b8' }}>{label}</span>
    </button>
  )
}
