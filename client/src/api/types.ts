export type Role = 'admin' | 'qca'

export interface LoginResponse {
  access_token: string
  token_type: string
  roles: Role[]
}

export interface VariableMetadata {
  dims: string[]
  shape: number[]
  dtype: string
  attrs: Record<string, unknown>
}

export interface FileMetadata {
  variables: Record<string, VariableMetadata>
  dimensions: Record<string, number>
  global_attrs: Record<string, unknown>
}

export interface AuditEntry {
  id: number
  filename?: string
  user_id: number
  username: string | null
  action: string
  var_name: string | null
  old_value: number | null
  new_value: number | string | null
  reverted: boolean
  timestamp: string
}

export interface TempSessionEntry {
  filename: string
  created_at: string
  last_edited_at: string | null
}

export interface JobStatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed'
  error: string | null
  result: { audit_id: number } | null
}

export interface CurrentUser {
  id: number
  username: string
  email?: string | null
  roles: Role[]
}

export type Catalog = Record<string, Record<string, string[]>>

// Call sign -> ship name (null when the ship's files don't record one).
export type ShipNames = Record<string, string | null>

export interface VariableSeries {
  values: (number | null)[]
  flags: string[] | null
}

export interface VariableDataResponse {
  time: string[]
  variables: Record<string, VariableSeries>
}

export interface ClimatologyResponse {
  variables: Record<string, (number | null)[]>
}

export interface OAuthSettings {
  allowed_domains: string[]
}

export interface ThemeSettings {
  primary_color: string
  secondary_color: string
  tertiary_color: string
  site_name: string
  save_draft_label: string
  publish_label: string
  has_logo: boolean
}

export type ThemeSettingsUpdate = Omit<ThemeSettings, 'has_logo'>

export type Modifier = 'shift' | 'ctrl' | 'alt' | 'meta'
export type DragTrigger =
  | 'none'
  | Modifier
  | 'shift+ctrl'
  | 'shift+alt'
  | 'shift+meta'
  | 'ctrl+alt'
  | 'ctrl+meta'
  | 'alt+meta'
export type ClickTrigger = Modifier | 'dblclick'

// Phase A widens a binding to any canonical "<mods>/<button>/<action>"
// string (see appConfig.ts parseTrigger), not just the built-in legacy
// tokens below — so these fields are validated at runtime, not by type.
// DragTrigger/ClickTrigger remain the built-in dropdown option lists.
export interface KeyBindings {
  x_zoom: string
  y_zoom: string
  box_zoom: string
  flag_select: string
  undo: string
  redo: string
}

export interface DocTab {
  title: string
  body: string
}

// A named, user-recorded trigger. `trigger` is always canonical
// "<mods>/<button>/<action>"; its action decides which gestures it fits.
export interface CustomTrigger {
  name: string
  trigger: string
}

export interface AppConfig {
  keybindings: KeyBindings
  user_keybindings?: KeyBindings | null
  documentation: DocTab[]
  custom_triggers?: CustomTrigger[]
  user_custom_triggers?: CustomTrigger[]
}

export interface PathLists {
  raw_dirs: string[]
  draft_dirs: string[]
  published_dirs: string[]
}

export interface PathSettings extends PathLists {
  defaults: { raw: string; draft: string; published: string }
}
