import type { CurrentUser, Catalog, VariableDataResponse } from './types'

const BASE_URL = 'http://localhost:8000'
const TOKEN_KEY = 'svidat_token'

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${response.status}: ${body}`)
  }
  return response
}

export async function login(username: string, password: string) {
  const form = new URLSearchParams()
  form.set('username', username)
  form.set('password', password)
  const response = await fetch(`${BASE_URL}/auth/login`, { method: 'POST', body: form })
  if (!response.ok) {
    throw new Error('invalid username or password')
  }
  return response.json()
}

export const listRawFiles = () => apiFetch('/files/raw').then((r) => r.json())
export const listDrafts = (username?: string) => {
  const params = username ? `?${new URLSearchParams({ username }).toString()}` : ''
  return apiFetch(`/files/drafts${params}`).then((r) => r.json())
}
export const getFileMetadata = (filename: string) =>
  apiFetch(`/files/${encodeURIComponent(filename)}/metadata`).then((r) => r.json())
export const openSession = (filename: string, source: string, sourceUsername?: string) => {
  const params = new URLSearchParams({ source })
  if (sourceUsername) params.set('source_username', sourceUsername)
  return apiFetch(`/session/${encodeURIComponent(filename)}/open?${params.toString()}`, {
    method: 'POST',
  }).then((r) => r.json())
}
export const closeSession = (filename: string) =>
  apiFetch(`/session/${encodeURIComponent(filename)}/close`, { method: 'POST' }).then((r) =>
    r.json()
  )
export const pointEdit = (
  filename: string,
  varName: string,
  indices: number[],
  value: number
) =>
  apiFetch('/edit/point', {
    method: 'POST',
    body: JSON.stringify({ filename, var_name: varName, indices, value }),
  }).then((r) => r.json())
export const bulkEdit = (
  filename: string,
  varName: string,
  slices: number[][],
  op: string,
  value: number
) =>
  apiFetch('/edit/bulk', {
    method: 'POST',
    body: JSON.stringify({ filename, var_name: varName, slices, op, value }),
  }).then((r) => r.json())
export const jobStatus = (jobId: string) =>
  apiFetch(`/edit/jobs/${encodeURIComponent(jobId)}`).then((r) => r.json())
export const saveDraft = (filename: string) =>
  apiFetch('/save', { method: 'POST', body: JSON.stringify({ filename }) }).then((r) => r.json())
export const publishFile = (filename: string) =>
  apiFetch('/publish', { method: 'POST', body: JSON.stringify({ filename }) }).then((r) => r.json())
export const getAuditHistory = (filename: string) =>
  apiFetch(`/audit/${encodeURIComponent(filename)}`).then((r) => r.json())
export const revertAuditEntry = (auditId: number) =>
  apiFetch(`/audit/${auditId}/revert`, { method: 'POST' }).then((r) => r.json())
export const getMyAuditHistory = () => apiFetch('/audit').then((r) => r.json())
export const listUsers = () => apiFetch('/users').then((r) => r.json())
export const createUser = (username: string, password: string, role: string) =>
  apiFetch('/users', { method: 'POST', body: JSON.stringify({ username, password, role }) }).then(
    (r) => r.json()
  )
export const deleteUser = (userId: number) =>
  apiFetch(`/users/${encodeURIComponent(String(userId))}`, { method: 'DELETE' })

export const getCurrentUser = (): Promise<CurrentUser> =>
  apiFetch('/users/me').then((r) => r.json())

export const uploadAvatar = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(`${BASE_URL}/users/me/avatar`, {
    method: 'POST',
    body: form,
    headers,
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}: upload failed`)
    return r.json()
  })
}

export const fetchAvatarBlobUrl = async (userId: number): Promise<string | null> => {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${BASE_URL}/users/${userId}/avatar`, { headers })
  if (!response.ok) return null
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export const getCatalog = (): Promise<Catalog> => apiFetch('/files/catalog').then((r) => r.json())

export const getVariableData = (
  filename: string,
  varNames: string[]
): Promise<VariableDataResponse> => {
  const params = new URLSearchParams({ vars: varNames.join(',') })
  return apiFetch(`/files/${encodeURIComponent(filename)}/data?${params.toString()}`).then((r) =>
    r.json()
  )
}

export const applyFlag = (
  filename: string,
  varName: string,
  startTimeIdx: number,
  endTimeIdx: number,
  flagCode: string
) =>
  apiFetch('/edit/flag', {
    method: 'POST',
    body: JSON.stringify({
      filename,
      var_name: varName,
      start_time_idx: startTimeIdx,
      end_time_idx: endTimeIdx,
      flag_code: flagCode,
    }),
  }).then((r) => r.json())
