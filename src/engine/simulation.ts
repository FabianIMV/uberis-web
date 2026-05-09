import type {
  Action, Emotion, Entity, LiveEvent, SimState, WorldObject, WorldState, Zone,
} from './types'

const ZONES: Zone[]   = ['Garden', 'Archive', 'Void', 'Storm']
const NAMES           = ['Aeon','Lyra','Zeth','Mira','Kael','Nyx','Sora','Thorn',
                         'Vex','Aria','Dusk','Echo','Flint','Gale','Iris','Jade',
                         'Knox','Luna','Myra','Nova','Orin','Pax','Quill','Rion',
                         'Sage','Tala','Ula','Vera','Wren','Xan','Yael','Zara']
const MAX_DEAD_STORED = 50
const TICK_MS         = 2000   // 2s per sim tick
const APPLE_REGEN     = 12     // ticks between apple regrowth
const MAX_ENTITIES    = 200

let _nameIdx = 0
function nextName(): string {
  return NAMES[_nameIdx++ % NAMES.length] + (_nameIdx > NAMES.length ? String(Math.floor(_nameIdx / NAMES.length)) : '')
}

// ── World object helpers ──────────────────────────────────────────────────────
let _woId = 1
function makeTree(zone: Zone, x: number): WorldObject {
  return { id: _woId++, type: 'apple_tree', zone, x, y: 0, apples: 4, max_apples: 6, hp: 100, created_tick: 0 }
}
function makeBush(zone: Zone, x: number): WorldObject {
  return { id: _woId++, type: 'bush', zone, x, y: 0, apples: 0, max_apples: 0, hp: 80, created_tick: 0 }
}
function makePond(zone: Zone, x: number): WorldObject {
  return { id: _woId++, type: 'pond', zone, x, y: 0, apples: 0, max_apples: 0, hp: 999, created_tick: 0 }
}

function initWorldObjects(): WorldObject[] {
  return [
    makeTree('Garden', 0.15), makeTree('Garden', 0.55), makeTree('Garden', 0.85),
    makeBush('Garden', 0.35), makePond('Garden', 0.70),
    makeTree('Archive', 0.20), makeTree('Archive', 0.70),
    makeBush('Archive', 0.45), makeBush('Archive', 0.80),
    makeTree('Void', 0.30), makeTree('Void', 0.65),
    makePond('Void', 0.15),
    makeTree('Storm', 0.25), makeTree('Storm', 0.75),
    makeBush('Storm', 0.50), makePond('Storm', 0.90),
  ]
}

// ── Entity factory ────────────────────────────────────────────────────────────
let _eId = 1
function makeEntity(zone: Zone, generation = 1, parentIds?: number[]): Entity {
  return {
    id: _eId++,
    name: nextName(),
    generation,
    age_ticks: 0,
    energy: 70 + Math.random() * 20,
    max_energy: 100,
    is_alive: true,
    current_zone: zone,
    emotional_state: { emotion: 'wonder', intensity: 0.7, since_tick: 0 },
    last_action: 'wander',
    memories: [],
    resources: { wood: 0 },
    parent_ids: parentIds,
  }
}

// ── Heuristic brain ───────────────────────────────────────────────────────────
function think(e: Entity, tick: number, worldObjects: WorldObject[]): { action: Action; thought: string } {
  const zoneObjs = worldObjects.filter(o => o.zone === e.current_zone)
  const trees    = zoneObjs.filter(o => o.type === 'apple_tree' && o.apples > 0)
  const chopable = zoneObjs.filter(o => o.type === 'apple_tree' && o.hp > 0 && o.apples === 0)
  const ponds    = zoneObjs.filter(o => o.type === 'pond')
  const wood     = e.resources?.wood ?? 0

  // Critical energy — find food
  if (e.energy < 25) {
    if (trees.length > 0) return { action: 'pick_apple', thought: 'Tengo hambre, necesito una manzana.' }
    if (ponds.length > 0) return { action: 'rest', thought: 'Sin comida... descanso junto al estanque.' }
    return { action: 'rest', thought: 'Me desvanezco de hambre.' }
  }

  // Enough wood to build
  if (wood >= 6) return { action: 'build_structure', thought: `Tengo ${wood} maderas, ¡voy a construir algo!` }

  // Low energy — eat if possible
  if (e.energy < 55 && trees.length > 0) return { action: 'pick_apple', thought: 'Me vendría bien una manzana.' }

  // Occasionally chop
  if (chopable.length > 0 && wood < 8 && Math.random() < 0.15) {
    return { action: 'chop_tree', thought: 'Este árbol sin manzanas, lo voy a talar.' }
  }

  // Contemplate near ponds
  if (ponds.length > 0 && Math.random() < 0.08) {
    const thoughts = [
      'El agua me invita a reflexionar.',
      '¿Qué hay más allá de estas zonas?',
      'La existencia es extraña y maravillosa.',
    ]
    return { action: 'contemplate', thought: thoughts[tick % thoughts.length] }
  }

  // Zone-specific behavior
  const zoneThoughts: Record<Zone, string[]> = {
    Garden:  ['El jardín es tranquilo hoy.', 'Las flores me alegran.', 'Me gusta explorar aquí.'],
    Archive: ['Hay tanto que aprender.', 'Los registros del pasado me fascinan.', 'Busco conocimiento.'],
    Void:    ['La oscuridad es serena.', 'El vacío tiene su propia belleza.', 'Me pregunto qué soy.'],
    Storm:   ['La tormenta me energiza.', 'El caos tiene orden oculto.', 'Sobreviviré esto.'],
  }

  const zThoughts = zoneThoughts[e.current_zone]
  const thought   = zThoughts[tick % zThoughts.length]

  // Random zone change
  if (Math.random() < 0.08) {
    const nextZone = ZONES[Math.floor(Math.random() * ZONES.length)]
    return { action: 'wander', thought: `Quiero explorar ${nextZone}.` }
  }

  if (Math.random() < 0.12 && trees.length > 0 && e.energy < 80) {
    return { action: 'pick_apple', thought: 'Una manzana de precaución.' }
  }

  return { action: 'wander', thought }
}

// ── Emotion updater ───────────────────────────────────────────────────────────
function updateEmotion(e: Entity, action: Action, tick: number): Emotion {
  const energy = e.energy
  if (energy < 15)  return 'existential_dread'
  if (energy < 30)  return 'fear'
  if (energy > 85)  return Math.random() < 0.5 ? 'joy' : 'elation'
  if (action === 'contemplate') return 'contemplation'
  if (action === 'build_structure') return 'joy'
  if (action === 'chop_tree') return 'frustration'
  if (action === 'pick_apple') return energy < 40 ? 'hope' : 'content'
  const zone = e.current_zone
  if (zone === 'Void')    return Math.random() < 0.4 ? 'loneliness' : 'calm'
  if (zone === 'Storm')   return Math.random() < 0.3 ? 'fear' : 'wonder'
  if (zone === 'Garden')  return Math.random() < 0.5 ? 'content' : 'calm'
  return 'calm'
}

// ── Main simulation class ─────────────────────────────────────────────────────
export class Simulation {
  state: SimState

  constructor(saved?: SimState) {
    if (saved) {
      this.state = saved
      // Restore ID counters
      const maxEId = Math.max(0, ...saved.entities.map(e => e.id))
      const maxWId = Math.max(0, ...saved.worldObjects.map(o => o.id))
      if (maxEId >= _eId) _eId = maxEId + 1
      if (maxWId >= _woId) _woId = maxWId + 1
    } else {
      this.state = this._initialState()
    }
  }

  private _initialState(): SimState {
    const world: WorldState = {
      current_tick: 0,
      season: 'spring',
      weather: 'clear',
      world_age_days: 0,
    }
    const worldObjects = initWorldObjects()
    const entities: Entity[] = []
    // Seed 6 entities across zones
    ZONES.forEach((z, i) => {
      entities.push(makeEntity(z))
      if (i % 2 === 0) entities.push(makeEntity(z))
    })
    return { entities, world, worldObjects, events: [] }
  }

  tick(): SimState {
    const { world, worldObjects } = this.state
    let { entities, events } = this.state
    const t = world.current_tick + 1

    // Regen apples
    worldObjects.forEach(obj => {
      if (obj.type === 'apple_tree' && obj.apples < obj.max_apples && t % APPLE_REGEN === 0) {
        obj.apples = Math.min(obj.max_apples, obj.apples + 1)
      }
      // Log decay → remove after 100 ticks
      if (obj.type === 'log' && t - obj.created_tick > 100) {
        obj.hp = 0
      }
    })

    // Filter out dead logs
    const activeObjs = worldObjects.filter(o => !(o.type === 'log' && o.hp <= 0))

    const newEvents: LiveEvent[] = []
    const alive = entities.filter(e => e.is_alive)

    alive.forEach(e => {
      // Age + energy drain
      e.age_ticks++
      const drain = e.current_zone === 'Storm' ? 3.5 : 2.2
      e.energy = Math.max(0, e.energy - drain)

      // Think
      const { action, thought } = think(e, t, activeObjs)
      e.last_action = action
      e.last_thought = thought

      // Execute action
      if (action === 'pick_apple') {
        const tree = activeObjs.find(o => o.zone === e.current_zone && o.type === 'apple_tree' && o.apples > 0)
        if (tree) {
          tree.apples--
          e.energy = Math.min(e.max_energy, e.energy + 18)
          newEvents.push({ type: 'pick_apple', tick: t, entity: e.name })
        }
      } else if (action === 'chop_tree') {
        const tree = activeObjs.find(o => o.zone === e.current_zone && o.type === 'apple_tree' && o.apples === 0)
        if (tree) {
          tree.hp -= 30
          if (tree.hp <= 0) {
            const log: WorldObject = {
              id: _woId++, type: 'log', zone: tree.zone,
              x: tree.x, y: tree.y, apples: 0, max_apples: 0, hp: 100,
              created_tick: t,
            }
            activeObjs.splice(activeObjs.indexOf(tree), 1, log)
            e.resources = { wood: (e.resources?.wood ?? 0) + 2 }
            newEvents.push({ type: 'tree_chopped', tick: t, entity: e.name })
          }
        }
      } else if (action === 'build_structure') {
        e.resources = { wood: 0 }
        newEvents.push({ type: 'structure_built', tick: t, builder: e.name })
      } else if (action === 'wander') {
        // Maybe migrate zone
        if (thought.includes('Quiero explorar')) {
          const nextZone = ZONES[Math.floor(Math.random() * ZONES.length)]
          e.current_zone = nextZone
        }
      } else if (action === 'rest') {
        e.energy = Math.min(e.max_energy, e.energy + 1.5)
      }

      // Update emotion
      e.emotional_state = {
        emotion: updateEmotion(e, action, t),
        intensity: 0.5 + Math.random() * 0.5,
        since_tick: t,
      }

      // Death
      if (e.energy <= 0) {
        e.is_alive = false
        e.died_at_tick = t
        newEvents.push({ type: 'entity_died', tick: t, name: e.name })
      }
    })

    // Reproduction (2 parents needed, max 200 entities)
    const currentAlive = entities.filter(e => e.is_alive)
    if (currentAlive.length < MAX_ENTITIES && currentAlive.length >= 2 && t % 15 === 0) {
      const parents = currentAlive.filter(e => e.energy > 70 && e.age_ticks > 20)
      if (parents.length >= 2) {
        const p1 = parents[Math.floor(Math.random() * parents.length)]
        const p2 = parents[Math.floor(Math.random() * parents.length)]
        if (p1 !== p2) {
          const baby = makeEntity(p1.current_zone, Math.max(p1.generation, p2.generation) + 1, [p1.id, p2.id])
          p1.energy -= 15
          p2.energy -= 15
          entities.push(baby)
          newEvents.push({ type: 'entity_born', tick: t, name: baby.name })
        }
      }
    }

    // Trim dead entities (keep last 50)
    const dead  = entities.filter(e => !e.is_alive)
    const alive2 = entities.filter(e => e.is_alive)
    const trimmedDead = dead.slice(-MAX_DEAD_STORED)

    // World season
    const day = Math.floor(t / 50)
    const seasons: WorldState['season'][] = ['spring', 'summer', 'autumn', 'winter']
    const newWorld: WorldState = {
      ...world,
      current_tick: t,
      world_age_days: day,
      season: seasons[Math.floor(day / 90) % 4],
    }

    // Keep last 20 events
    const allEvents = [...events, ...newEvents].slice(-20)

    this.state = {
      entities: [...alive2, ...trimmedDead],
      world: newWorld,
      worldObjects: activeObjs,
      events: allEvents,
    }
    return this.state
  }

  feedEntity(id: number) {
    const e = this.state.entities.find(e => e.id === id && e.is_alive)
    if (e) {
      e.energy = Math.min(e.max_energy, e.energy + 30)
      e.emotional_state = { emotion: 'joy', intensity: 0.9, since_tick: this.state.world.current_tick }
      e.memories.push({ tick: this.state.world.current_tick, event: 'Me alimentaron', emotion: 'joy' })
    }
  }

  bathEntity(id: number) {
    const e = this.state.entities.find(e => e.id === id && e.is_alive)
    if (e) {
      e.energy = Math.min(e.max_energy, e.energy + 5)
      e.emotional_state = { emotion: 'content', intensity: 0.85, since_tick: this.state.world.current_tick }
      e.memories.push({ tick: this.state.world.current_tick, event: 'Me bañaron', emotion: 'content' })
    }
  }

  feedAll() {
    this.state.entities.filter(e => e.is_alive).forEach(e => this.feedEntity(e.id))
  }

  bathAll() {
    this.state.entities.filter(e => e.is_alive).forEach(e => this.bathEntity(e.id))
  }

  save() {
    try {
      localStorage.setItem('uberis_state', JSON.stringify(this.state))
    } catch { /* quota exceeded */ }
  }

  static load(): SimState | null {
    try {
      const raw = localStorage.getItem('uberis_state')
      return raw ? JSON.parse(raw) as SimState : null
    } catch { return null }
  }

  static clearSave() {
    localStorage.removeItem('uberis_state')
  }
}

export { TICK_MS }
