export type Emotion =
  | 'joy' | 'elation' | 'sadness' | 'grief' | 'fear' | 'existential_dread'
  | 'anger' | 'frustration' | 'wonder' | 'curiosity' | 'hope' | 'love'
  | 'loneliness' | 'content' | 'calm' | 'contemplation' | 'acceptance'

export type Zone = 'Garden' | 'Archive' | 'Void' | 'Storm'

export type Action =
  | 'wander' | 'rest' | 'eat' | 'sleep' | 'interact' | 'contemplate'
  | 'pick_apple' | 'chop_tree' | 'build_structure' | 'terraform'

export interface EmotionalState {
  emotion: Emotion
  intensity: number
  since_tick: number
}

export interface Memory {
  tick: number
  event: string
  emotion: Emotion
}

export interface WorldObject {
  id: number
  type: 'apple_tree' | 'log' | 'bush' | 'pond'
  zone: Zone
  x: number   // 0-1 within zone
  y: number   // offset from ground
  apples: number
  max_apples: number
  hp: number
  created_tick: number
}

export interface Entity {
  id: number
  name: string
  generation: number
  age_ticks: number
  energy: number
  max_energy: number
  is_alive: boolean
  died_at_tick?: number
  current_zone: Zone
  emotional_state: EmotionalState
  last_action: Action
  last_thought?: string
  memories: Memory[]
  resources?: { wood: number }
  parent_ids?: number[]
}

export interface WorldState {
  current_tick: number
  season: 'spring' | 'summer' | 'autumn' | 'winter'
  weather: 'clear' | 'cloudy' | 'rain' | 'storm'
  world_age_days: number
}

export interface LiveEvent {
  type: string
  tick: number
  [key: string]: unknown
}

export interface SimState {
  entities: Entity[]
  world: WorldState
  worldObjects: WorldObject[]
  events: LiveEvent[]
}
