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
  roles: Role[]
}

export type Catalog = Record<string, Record<string, string[]>>

export interface VariableSeries {
  values: (number | null)[]
  flags: string[] | null
}

export interface VariableDataResponse {
  time: string[]
  variables: Record<string, VariableSeries>
}

export interface OAuthSettings {
  allowed_domains: string[]
}

export interface ThemeSettings {
  primary_color: string
  secondary_color: string
  tertiary_color: string
}
