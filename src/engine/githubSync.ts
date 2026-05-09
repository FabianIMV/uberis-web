import type { SimState } from './types'

const OWNER  = 'FabianIMV'
const REPO   = 'uberis-web'
const FILE   = 'state.json'
const BRANCH = 'main'

const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${FILE}`
const TOKEN_KEY = 'uberis_gh_token'

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setStoredToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token.trim())
}

export async function loadFromGitHub(): Promise<SimState | null> {
  try {
    const r = await fetch(RAW + '?t=' + Date.now())
    if (!r.ok) return null
    return await r.json() as SimState
  } catch {
    return null
  }
}

export async function saveToGitHub(state: SimState): Promise<boolean> {
  const token = getStoredToken()
  if (!token) return false
  try {
    let sha: string | undefined
    const meta = await fetch(API, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
    })
    if (meta.ok) {
      const d = await meta.json() as { sha: string }
      sha = d.sha
    }

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(state))))
    const body: Record<string, unknown> = {
      message: `save: tick ${state.world.current_tick}`,
      content,
      branch: BRANCH,
    }
    if (sha) body.sha = sha

    const r = await fetch(API, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return r.ok
  } catch {
    return false
  }
}
