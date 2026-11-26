export interface Rule {
  paths: string[]
  claude: 'off' | 'comments' | 'approve'
  seats: string[]
}

export interface Policy {
  rules: Rule[]
}

export function loadPolicy(raw: unknown): Policy {
  return raw as Policy
}
