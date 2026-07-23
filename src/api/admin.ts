const DEFAULT_API_BASE_URL = 'http://localhost:3000/api/v1'

function normalizeApiBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return DEFAULT_API_BASE_URL
  if (trimmed.endsWith('/api/v1')) return trimmed
  if (trimmed.endsWith('/api')) return `${trimmed}/v1`
  return `${trimmed}/api/v1`
}

export const ADMIN_API_BASE_URL = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? DEFAULT_API_BASE_URL,
)

export const AUTH_STORAGE_KEY = 'builtglory-admin-auth'
export const REDIRECT_AFTER_LOGIN_KEY = 'builtglory-redirect-after-login'

type ApiEnvelope<T> = {
  data: T
  meta?: {
    requestId?: string
    page?: number
    limit?: number
    total?: number
    totalPages?: number
    [key: string]: unknown
  }
}

type ApiErrorPayload = {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
  meta?: {
    requestId?: string
  }
}

export class AdminApiError extends Error {
  status: number
  code?: string
  details?: unknown
  requestId?: string

  constructor(message: string, options: { status: number; code?: string; details?: unknown; requestId?: string }) {
    super(message)
    this.name = 'AdminApiError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
    this.requestId = options.requestId
  }
}

export function formatAdminApiError(error: unknown, fallback = 'Request failed.'): string {
  if (error instanceof AdminApiError) {
    const details = error.details
    if (Array.isArray(details) && details.length > 0) {
      const fieldMessages = details
        .map((detail) => {
          if (!detail || typeof detail !== 'object') return null
          const item = detail as { field?: string; message?: string }
          if (!item.message) return null
          const field = item.field?.replace(/^(body|query|params)\./, '')
          return field ? `${field}: ${item.message}` : item.message
        })
        .filter((message): message is string => Boolean(message))
      if (fieldMessages.length > 0) {
        return fieldMessages.join('. ')
      }
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return fallback
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  accessToken?: string | null
  skipAuthRefresh?: boolean
}

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000
let adminSessionRefreshPromise: Promise<StoredAdminSession> | null = null

async function parseJson<T>(response: Response): Promise<T | null> {
  const text = await response.text()
  if (!text) return null
  return JSON.parse(text) as T
}

async function refreshStoredAdminSession() {
  if (!adminSessionRefreshPromise) {
    const session = readAdminSession()
    if (!session) return null

    adminSessionRefreshPromise = refreshAdminSession(session.refreshToken)
      .then((refreshed) => storeAdminSession({ ...refreshed, admin: session.admin }))
      .catch((error) => {
        clearAdminSession()
        throw error
      })
      .finally(() => {
        adminSessionRefreshPromise = null
      })
  }

  return adminSessionRefreshPromise
}

export async function ensureFreshAdminSession(minValidityMs = ACCESS_TOKEN_REFRESH_BUFFER_MS) {
  const session = readAdminSession()
  if (!session) return null
  if (session.accessTokenExpiresAt > Date.now() + minValidityMs) return session
  return refreshStoredAdminSession()
}

async function resolveRequestAccessToken(accessToken: string) {
  const session = readAdminSession()
  if (!session || session.accessToken !== accessToken) return accessToken

  const freshSession = await ensureFreshAdminSession()
  return freshSession?.accessToken ?? accessToken
}

export async function adminApiRequest<T>(path: string, options: RequestOptions = {}) {
  const envelope = await adminApiRequestEnvelope<T>(path, options)
  return envelope.data
}

export async function adminApiRequestEnvelope<T>(path: string, options: RequestOptions = {}) {
  const accessToken = options.accessToken
    ? await resolveRequestAccessToken(options.accessToken)
    : options.accessToken
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (options.body) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const payload = await parseJson<ApiEnvelope<T> | ApiErrorPayload>(response)
  if (!response.ok && response.status === 401 && accessToken && !options.skipAuthRefresh) {
    const session = readAdminSession()
    const refreshedSession = session?.accessToken !== accessToken
      ? session
      : await refreshStoredAdminSession()

    if (refreshedSession?.accessToken && refreshedSession.accessToken !== accessToken) {
      return adminApiRequestEnvelope<T>(path, {
        ...options,
        accessToken: refreshedSession.accessToken,
        skipAuthRefresh: true,
      })
    }
  }

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null
    throw new AdminApiError(errorPayload?.error?.message ?? 'Request failed.', {
      status: response.status,
      code: errorPayload?.error?.code,
      details: errorPayload?.error?.details,
      requestId: errorPayload?.meta?.requestId,
    })
  }

  if (!payload) return { data: null as T, meta: undefined }
  const envelope = payload as ApiEnvelope<T>
  return { data: envelope.data, meta: envelope.meta }
}

export async function adminFormRequest<T>(
  path: string,
  options: { accessToken: string; formData: FormData; skipAuthRefresh?: boolean; errorMessage?: string },
) {
  const accessToken = await resolveRequestAccessToken(options.accessToken)
  const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: options.formData,
  })

  const payload = await parseJson<ApiEnvelope<T> | ApiErrorPayload>(response)
  if (!response.ok && response.status === 401 && !options.skipAuthRefresh) {
    const session = readAdminSession()
    const refreshedSession = session?.accessToken !== accessToken
      ? session
      : await refreshStoredAdminSession()

    if (refreshedSession?.accessToken && refreshedSession.accessToken !== accessToken) {
      return adminFormRequest<T>(path, {
        ...options,
        accessToken: refreshedSession.accessToken,
        skipAuthRefresh: true,
      })
    }
  }

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null
    throw new AdminApiError(errorPayload?.error?.message ?? options.errorMessage ?? 'Request failed.', {
      status: response.status,
      code: errorPayload?.error?.code,
      details: errorPayload?.error?.details,
      requestId: errorPayload?.meta?.requestId,
    })
  }

  return (payload as ApiEnvelope<T> | null)?.data ?? (null as T)
}

export type AdminUser = {
  _id?: string
  id?: string
  name?: string
  email: string
  role: string
  permissions?: string[]
}

export type AdminSession = {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
  admin: AdminUser
}

export type StoredAdminSession = AdminSession & {
  loggedInAt: string
  accessTokenExpiresAt: number
}

export type AdminOverview = {
  kpis?: {
    activeProperties?: number
    featuredProperties?: number
    upcomingProperties?: number
    newEnquiries?: number
    tokenPaidDeals?: number
    closedDeals?: number
    revenue?: number
    overdueCallbacks?: number
    openSupportTickets?: number
    pendingKycUsers?: number
    pendingSellRequests?: number
  }
  schedule?: AdminOverviewScheduleItem[]
  recentActivities?: Array<{
    id: string
    description: string
    time: string
    route: string
    resourceType?: string
    action?: string
  }>
  pipelineCounts?: {
    acquisitions?: Array<{ value?: string; count?: number }>
    sales?: Array<{ value?: string; count?: number }>
  }
  chartSeries?: {
    enquiriesLast7Days?: Array<{ date?: string; day: string; count: number }>
    propertiesByType?: Array<{ value?: string; count: number }>
  }
  recentEnquiries?: Array<{
    id: string
    referenceId?: string
    buyer: string
    property: string
    type: string
    date: string
    status: string
    viewPath: string
  }>
  pendingApprovals?: Array<{
    id: string
    referenceId?: string
    seller: string
    title: string
    type: string
    submitted: string
    status?: string
    viewPath: string
  }>
  slaQueues?: {
    enquiries?: AdminOverviewSlaItem[]
    stagePayments?: AdminOverviewSlaItem[]
    interiorLeads?: AdminOverviewSlaItem[]
  }
  navBadges?: Record<string, number>
}

export type AdminOverviewScheduleItem = {
  id: string
  referenceId?: string
  buyerName: string
  buyerPhone?: string
  buyerEmail?: string
  buyerUserType?: string
  propertyTitle: string
  propertyId?: string
  propertyType?: string
  propertyLocation?: string
  propertyPrice?: number
  visitDate: string
  visitTime: string
  visitType: 'physical' | 'virtual' | string
  virtualPlatform?: string | null
  meetingLink?: string | null
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'missed' | 'rescheduled' | string
  assignedAdmin?: string
  rescheduleCount?: number
  createdAt?: string
  updatedAt?: string
  viewPath: string
}

export type AdminOverviewSlaItem = {
  id: string
  name: string
  property: string
  phone?: string
  viewPath: string
  sourceTime: string
  limitHours: number
  elapsedHours: number
  remainingHours: number
  progressPercent: number
  status: 'ok' | 'warning' | 'breached'
}

export type AdminDeviceSession = {
  sid: string
  type: string
  role: string
  deviceId?: string
  userAgent?: string
  ip?: string
  status: string
  createdAt: string
  lastSeenAt: string
  current: boolean
}

export type AdminLoginStats = {
  properties: number
  users: number
  deals: number
}

export async function loginAdmin(email: string, password: string) {
  return adminApiRequest<AdminSession>('/auth/admin/login', {
    method: 'POST',
    body: { email, password },
  })
}

export async function getAdminLoginStats() {
  return adminApiRequest<AdminLoginStats>('/public/admin-login-stats')
}

export async function refreshAdminSession(refreshToken: string) {
  return adminApiRequest<Omit<AdminSession, 'admin'>>('/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  })
}

export async function logoutAdminSession(accessToken: string | null, refreshToken: string) {
  return adminApiRequest<{ revoked: boolean }>('/auth/logout', {
    method: 'POST',
    accessToken,
    skipAuthRefresh: true,
    body: { refreshToken },
  })
}

export async function listAdminDeviceSessions(accessToken: string) {
  return adminApiRequest<AdminDeviceSession[]>('/admin/sessions', { accessToken })
}

export async function revokeAdminDeviceSession(accessToken: string, sid: string) {
  return adminApiRequest<{ revoked: boolean; sid: string }>(`/admin/sessions/${sid}`, {
    method: 'DELETE',
    accessToken,
  })
}

export async function revokeOtherAdminDeviceSessions(accessToken: string) {
  return adminApiRequest<{ revoked: number }>('/admin/sessions', {
    method: 'DELETE',
    accessToken,
  })
}

export async function getAdminOverview(accessToken: string) {
  return adminApiRequest<AdminOverview>('/admin/overview', {
    accessToken,
  })
}

export function storeAdminSession(session: AdminSession) {
  const { passwordHash: _passwordHash, ...admin } = session.admin as AdminUser & {
    passwordHash?: string
  }
  const stored: StoredAdminSession = {
    ...session,
    admin,
    loggedInAt: new Date().toISOString(),
    accessTokenExpiresAt: Date.now() + session.expiresInSeconds * 1000,
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stored))
  return stored
}

export function readAdminSession(): StoredAdminSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredAdminSession>
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.admin?.email) return null
    return parsed as StoredAdminSession
  } catch {
    return null
  }
}

export function clearAdminSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY)
}
