import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  Bell,
  Eye,
  EyeOff,
  Globe,
  Mail,
  MoreVertical,
  Phone,
  ScrollText,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CATEGORY_LABELS,
  isTicketOverdue,
  type TicketPriority,
  type TicketStatus,
  listAdminFeedback,
  listAdminAuditLogs,
  listAdminSupportTickets,
  updateAdminFeedbackStatus,
  type AdminAuditEntry,
  type AppFeedback,
  type FeedbackStatus,
  type SupportTicket,
} from '@/api/adminSupport'
import { cn } from '@/lib/utils'
import { COMPANY_SUPPORT_PHONE_DISPLAY } from '@/config/companyContact'
import { hoursSince } from '@/utils/timer'
import { readAdminSession } from '@/api/admin'
import {
  inviteAdminOperator,
  listAdminOperators,
  removeAdminOperator,
  resetAdminOperatorPassword,
  setAdminOperatorSuspended,
  updateAdminOperator,
  updateAdminOperatorPermissions,
  type AdminOperator,
} from '@/api/adminAdmins'
import {
  createAdminSalesTeamMember,
  getAdminSalesTeam,
  getRoleLabel as getSalesRoleLabel,
  removeAdminSalesTeamMember,
  updateAdminSalesTeamMember,
  type SalesPerson,
} from '@/api/adminEnquiries'
import { getAdminSettings, updateAdminSettings, type AdminSettings } from '@/api/adminSettings'
import { listAdminUsers, type User } from '@/api/adminUsers'
import {
  createAdminContent,
  deleteAdminContent,
  listAdminContent,
  updateAdminContent,
  type AdminContentItem,
  type AdminContentPayload,
  type ContentStatus,
} from '@/api/adminContent'
import { DEFAULT_ROLE_PERMISSIONS } from '@/config/adminPermissions'

function ticketNoResponse48h(ticket: SupportTicket): boolean {
  const hours = (Date.now() - new Date(ticket.createdAt).getTime()) / 3600000
  return hours > 48 && ticket.responses.length === 0
}

type SettingsTab = 'support' | 'feedback' | 'access' | 'general' | 'legal' | 'audit'

const PERMISSION_LABEL_TO_BACKEND: Record<string, string | string[]> = {
  'View Buy Enquiries': 'enquiries.read',
  'Respond to Enquiries': 'enquiries.write',
  'View Sell Requests': 'enquiries.read',
  'Delete Enquiries': 'enquiries.write',
  'View Acquisition Pipeline': 'acquisitions.read',
  'Update Acquisition Stages': 'acquisitions.write',
  'View Sales Pipeline': 'sales.read',
  'Update Sales Stages': 'sales.write',
  'View Properties': 'properties.read',
  'Add Properties': 'properties.write',
  'Edit Properties': 'properties.write',
  'Delete Properties': 'properties.write',
  'Bulk Upload': 'properties.write',
  'View Users': 'users.read',
  'Block Users': 'users.write',
  'Edit Users': 'users.write',
  'View Reports': ['sales.read', 'audit.read'],
  'Export Data': 'audit.read',
  'App Content': 'support.write',
  Pricing: 'properties.write',
  Templates: 'support.write',
  'Bulk Message': 'support.write',
  'Support Tickets': 'support.read',
  Feedback: 'support.read',
  'Access Control': 'admin.access.manage',
  Settings: 'admin.access.manage',
  'Legal Content': 'support.write',
  'Audit Trail': 'audit.read',
}

function backendPermsForLabel(label: string): string[] {
  const mapped = PERMISSION_LABEL_TO_BACKEND[label]
  if (!mapped) return []
  return Array.isArray(mapped) ? mapped : [mapped]
}

function labelIsGranted(label: string, active: Set<string>) {
  const perms = backendPermsForLabel(label)
  return perms.length > 0 && perms.some((perm) => active.has(perm))
}

function effectiveAdminPermissions(admin: AdminUser | undefined): string[] {
  if (!admin) return []
  if (admin.permissions.length > 0) return admin.permissions
  return DEFAULT_ROLE_PERMISSIONS[mapAdminRoleToBackend(admin.role)] ?? []
}

function permissionsFromBackend(backendPerms: string[]) {
  const active = new Set(backendPerms)
  return Object.fromEntries(
    Object.values(PERMISSION_SECTIONS)
      .flat()
      .map((label) => [label, labelIsGranted(label, active)]),
  )
}

function permissionsForRole(
  role: AdminRole,
  admins: AdminUser[],
  overrides: Partial<Record<AdminRole, string[]>>,
) {
  const override = overrides[role]
  if (override) return permissionsFromBackend(override)
  const roleAdmin = admins.find((admin) => admin.role === role)
  if (roleAdmin) return permissionsFromBackend(effectiveAdminPermissions(roleAdmin))
  return permissionsFromBackend(DEFAULT_ROLE_PERMISSIONS[mapAdminRoleToBackend(role)] ?? [])
}

function adminsForDisplayRole(role: AdminRole, admins: AdminUser[]) {
  return admins.filter((admin) => admin.role === role)
}

type AdminContactDetails = {
  phone: string
  email: string
  ccEmail: string
}

function formatIndianCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}

function formatInternationalCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-US')}`
}

function formatDatePreview(format: string, date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = date.toLocaleString('en-IN', { month: 'short' })
  const year = date.getFullYear()
  const monthNum = String(date.getMonth() + 1).padStart(2, '0')
  switch (format) {
    case 'DD/MM/YYYY':
      return `${day}/${monthNum}/${year}`
    case 'MMM DD, YYYY':
      return `${month} ${day}, ${year}`
    case 'YYYY-MM-DD':
      return `${year}-${monthNum}-${day}`
    default:
      return `${day} ${month} ${year}`
  }
}

type StatusFilter = 'all' | TicketStatus

type AdminRole = 'Super Admin' | 'Admin' | 'Operations' | 'Support'
type AdminDepartment = 'Sales' | 'Acquisition' | 'Support' | 'Tech' | 'Management'

interface AdminUser {
  id: string
  name: string
  email: string
  phone?: string
  photoUrl?: string
  role: AdminRole
  department?: AdminDepartment
  assignedProperties?: string
  lastActive: string
  status: 'active' | 'suspended' | 'invited'
  invitedAt?: string
  isSelf?: boolean
  permissions: string[]
}

interface AdminFormState {
  name: string
  email: string
  phone: string
  photoUrl: string
  password: string
  confirmPassword: string
  role: AdminRole
  department: AdminDepartment | ''
  assignedProperties: string
  active: boolean
  sendWelcomeEmail: boolean
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY_ADMIN_FORM: AdminFormState = {
  name: '',
  email: '',
  phone: '',
  photoUrl: '',
  password: '',
  confirmPassword: '',
  role: 'Admin',
  department: '',
  assignedProperties: '',
  active: true,
  sendWelcomeEmail: true,
}

const ADMIN_ROLES: AdminRole[] = ['Super Admin', 'Admin', 'Operations', 'Support']
const ADMIN_DEPARTMENTS: AdminDepartment[] = [
  'Sales',
  'Acquisition',
  'Support',
  'Tech',
  'Management',
]

function mapBackendAdminRole(role: string): AdminRole {
  const labels: Record<string, AdminRole> = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    operations: 'Operations',
    support: 'Support',
    sales_manager: 'Operations',
    sales_executive: 'Operations',
    relationship_manager: 'Operations',
    designer: 'Support',
  }
  return labels[role] ?? 'Admin'
}

function mapAdminRoleToBackend(role: AdminRole) {
  const values: Record<AdminRole, string> = {
    'Super Admin': 'super_admin',
    Admin: 'admin',
    Operations: 'operations',
    Support: 'support',
  }
  return values[role]
}

function mapAdminOperator(operator: AdminOperator, currentEmail?: string): AdminUser {
  return {
    id: operator.id,
    name: operator.name,
    email: operator.email,
    phone: operator.phone,
    role: mapBackendAdminRole(operator.role),
    department: operator.role === 'support' || operator.role === 'designer' ? 'Support' : 'Management',
    assignedProperties: operator.assignedArea.join(', '),
    lastActive: operator.lastLoginAt
      ? new Date(operator.lastLoginAt).toLocaleString('en-IN')
      : 'Never',
    status: operator.isActive ? 'active' : 'suspended',
    isSelf: operator.email.toLowerCase() === currentEmail?.toLowerCase(),
    permissions: operator.permissions,
  }
}

function backendPermissionsFromLabels(permissions: Record<string, boolean>) {
  const result = new Set<string>()
  for (const [label, enabled] of Object.entries(permissions)) {
    if (!enabled) continue
    backendPermsForLabel(label).forEach((perm) => result.add(perm))
  }
  return [...result]
}

type AuditEntry = AdminAuditEntry

const PERMISSION_SECTIONS: Record<string, string[]> = {
  ENQUIRIES: [
    'View Buy Enquiries',
    'Respond to Enquiries',
    'View Sell Requests',
    'Delete Enquiries',
  ],
  PIPELINE: [
    'View Acquisition Pipeline',
    'Update Acquisition Stages',
    'View Sales Pipeline',
    'Update Sales Stages',
  ],
  PROPERTIES: [
    'View Properties',
    'Add Properties',
    'Edit Properties',
    'Delete Properties',
    'Bulk Upload',
  ],
  USERS: ['View Users', 'Block Users', 'Edit Users'],
  REPORTS: ['View Reports', 'Export Data'],
  TOOLS: ['App Content', 'Pricing', 'Templates', 'Bulk Message'],
  ADMIN: ['Support Tickets', 'Feedback', 'Access Control', 'Settings', 'Legal Content', 'Audit Trail'],
}

function getSettingsTab(pathname: string): SettingsTab {
  if (pathname.includes('/settings/feedback')) return 'feedback'
  if (pathname.includes('/settings/access')) return 'access'
  if (pathname.includes('/settings/general')) return 'general'
  if (pathname.includes('/settings/legal')) return 'legal'
  if (pathname.includes('/settings/audit')) return 'audit'
  return 'support'
}

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function priorityBadge(p: TicketPriority) {
  const map: Record<TicketPriority, { label: string; className: string }> = {
    urgent: { label: 'Urgent', className: 'bg-red-100 text-red-700' },
    high: { label: 'High', className: 'bg-orange-100 text-orange-700' },
    medium: { label: 'Medium', className: 'bg-blue-100 text-blue-700' },
    low: { label: 'Low', className: 'bg-muted text-muted-foreground' },
  }
  const { label, className } = map[p]
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', className)}>{label}</span>
}

function statusBadge(s: TicketStatus) {
  const map: Record<TicketStatus, { variant?: 'new' | 'pending' | 'responded' | 'default'; className?: string }> = {
    open: { variant: 'new' },
    in_progress: { variant: 'pending' },
    resolved: { variant: 'responded' },
    closed: { variant: 'default' },
  }
  const cfg = map[s]
  const label = s.replace('_', ' ')
  return (
    <Badge variant={cfg.variant} className={cfg.className}>
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </Badge>
  )
}

function feedbackStatusBadge(s: FeedbackStatus) {
  const colors: Record<FeedbackStatus, string> = {
    new: 'bg-blue-100 text-blue-700',
    reviewed: 'bg-green-100 text-green-700',
    archived: 'bg-muted text-muted-foreground',
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', colors[s])}>
      {s}
    </span>
  )
}

function auditActionBadge(type: AuditEntry['actionType']) {
  const colors: Record<AuditEntry['actionType'], string> = {
    CREATE: 'bg-green-100 text-green-700',
    UPDATE: 'bg-blue-100 text-blue-700',
    DELETE: 'bg-red-100 text-red-700',
    LOGIN: 'bg-muted text-muted-foreground',
    EXPORT: 'bg-purple-100 text-purple-700',
  }
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', colors[type])}>
      {type}
    </span>
  )
}

function enrichTicket(ticket: SupportTicket, users: User[], salesTeam: SalesPerson[]): SupportTicket {
  const linkedUser = users.find((user) => user.id === ticket.userId || user.referenceId === ticket.userId)
  const assignee = salesTeam.find((person) => person.id === ticket.assignedTo)
  return {
    ...ticket,
    userName: linkedUser?.name ?? ticket.userName,
    phone: linkedUser?.phone ?? ticket.phone,
    assignedToName: assignee?.name ?? ticket.assignedToName,
  }
}

function enrichFeedback(item: AppFeedback, users: User[]): AppFeedback {
  const linkedUser = users.find((user) => user.id === item.userId || user.referenceId === item.userId)
  return {
    ...item,
    userName: linkedUser?.name ?? item.userName,
    phone: linkedUser?.phone ?? item.phone,
  }
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function AdminPage() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const tab = getSettingsTab(pathname)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [feedback, setFeedback] = useState<AppFeedback[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [contentItems, setContentItems] = useState<AdminContentItem[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [supportTeam, setSupportTeam] = useState<SalesPerson[]>([])
  const [search] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [priorityFilter] = useState<'all' | TicketPriority>('all')

  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [permModalRole, setPermModalRole] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<Record<string, boolean>>(() =>
    permissionsFromBackend(DEFAULT_ROLE_PERMISSIONS.admin ?? []),
  )

  const [company, setCompany] = useState({
    name: 'Builtglory',
    tagline: 'Find. Flip. Flourish.',
    email: 'support@builtglory.com',
    phone: COMPANY_SUPPORT_PHONE_DISPLAY,
    address: '123 MG Road, Bangalore',
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560001',
  })
  const [maintenance, setMaintenance] = useState(false)
  const [appToggles, setAppToggles] = useState({
    registration: true,
    kycRequired: true,
    showPrices: true,
    virtualTours: true,
    stagePayment: true,
    interior: true,
  })
  const [emailNotifs, setEmailNotifs] = useState({
    enquiry: true,
    sell: true,
    kyc: true,
    user: true,
    stageProof: true,
    ticket: true,
    daily: false,
    weekly: false,
  })
  const [slaInteriorHours, setSlaInteriorHours] = useState(24)
  const [slaStageHours, setSlaStageHours] = useState(4)
  const [slaEnquiryHours, setSlaEnquiryHours] = useState(2)
  const [adminContact, setAdminContact] = useState<AdminContactDetails>({
    phone: COMPANY_SUPPORT_PHONE_DISPLAY,
    email: 'admin@builtglory.com',
    ccEmail: '',
  })
  const [dashboardTimezone, setDashboardTimezone] = useState('IST')
  const [dashboardDateFormat, setDashboardDateFormat] = useState('DD MMM YYYY')
  const [dashboardCurrencyFormat, setDashboardCurrencyFormat] = useState<'indian' | 'international'>(
    'indian',
  )
  const [slaAutoEscalate, setSlaAutoEscalate] = useState(true)
  const [slaEscalateTo, setSlaEscalateTo] = useState('System Admin')
  const [adminAlerts, setAdminAlerts] = useState({
    slaBreached: true,
    interiorInquiry: true,
    stagePayment: true,
    kycReview: true,
    ticket48: true,
    dailyEmail: false,
    weeklyEmail: false,
  })
  const [alertEmail, setAlertEmail] = useState('admin@builtglory.com')
  const [alertWhatsApp, setAlertWhatsApp] = useState(COMPANY_SUPPORT_PHONE_DISPLAY)

  const [auditDate, setAuditDate] = useState('month')
  const [auditAdmin, setAuditAdmin] = useState('all')
  const [auditAction, setAuditAction] = useState('all')
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => setToast(msg), [])

  const applySettings = useCallback((settings: AdminSettings) => {
    setCompany(settings.organization)
    setMaintenance(settings.app.maintenance)
    setAppToggles({
      registration: settings.app.registration,
      kycRequired: settings.app.kycRequired,
      showPrices: settings.app.showPrices,
      virtualTours: settings.app.virtualTours,
      stagePayment: settings.app.stagePayment,
      interior: settings.app.interior,
    })
    setEmailNotifs(settings.notifications.email)
    setSlaInteriorHours(settings.sla.interiorHours)
    setSlaStageHours(settings.sla.stagePaymentHours)
    setSlaEnquiryHours(settings.sla.enquiryHours)
    setSlaAutoEscalate(settings.sla.autoEscalate)
    setSlaEscalateTo(settings.sla.escalateToName)
    setAdminAlerts(settings.alerts.triggers)
    setAlertEmail(settings.alerts.email)
    setAlertWhatsApp(settings.alerts.whatsapp)
    setAdminContact(settings.notifications.contact)
    setDashboardTimezone(settings.display.timezone)
    setDashboardDateFormat(settings.display.dateFormat)
    setDashboardCurrencyFormat(settings.display.currencyFormat)
  }, [])

  const loadSettingsData = useCallback(async () => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      setTickets([])
      setFeedback([])
      setAuditEntries([])
      setContentItems([])
      setUsers([])
      setSupportTeam([])
      setLoadError('Admin session expired. Please sign in again.')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)
    try {
      const [ticketResult, feedbackResult, auditResult, contentResult, userResult, teamResult, adminResult, settingsResult] = await Promise.all([
        listAdminSupportTickets(session.accessToken),
        listAdminFeedback(session.accessToken).catch(() => ({ data: [] as AppFeedback[] })),
        listAdminAuditLogs(session.accessToken).catch(() => ({ data: [] as AuditEntry[] })),
        listAdminContent(session.accessToken, { section: 'legal', limit: 100, sort: 'newest' }).catch(() => ({ data: [] as AdminContentItem[] })),
        listAdminUsers(session.accessToken).catch(() => ({ data: [] as User[] })),
        getAdminSalesTeam(session.accessToken).catch(() => [] as SalesPerson[]),
        listAdminOperators(session.accessToken).catch(() => ({ data: [] as AdminOperator[] })),
        getAdminSettings(session.accessToken).catch(() => null),
      ])
      setTickets(ticketResult.data)
      setFeedback(feedbackResult.data)
      setAuditEntries(auditResult.data)
      setContentItems(contentResult.data)
      setUsers(userResult.data)
      setSupportTeam(teamResult)
      setAdmins(adminResult.data.map((admin) => mapAdminOperator(admin, session.admin.email)))
      if (settingsResult) applySettings(settingsResult)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load admin settings data.'
      setTickets([])
      setFeedback([])
      setAuditEntries([])
      setContentItems([])
      setUsers([])
      setSupportTeam([])
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [applySettings])

  useEffect(() => {
    void loadSettingsData()
  }, [loadSettingsData])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const userTicketCounts = useMemo(() => {
    const m = new Map<string, number>()
    tickets.forEach((t) => m.set(t.userId, (m.get(t.userId) ?? 0) + 1))
    return m
  }, [tickets])

  const statusCounts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: tickets.length,
      open: 0,
      in_progress: 0,
      resolved: 0,
      closed: 0,
    }
    tickets.forEach((t) => {
      c[t.status] += 1
    })
    return c
  }, [tickets])

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tickets.map((ticket) => enrichTicket(ticket, users, supportTeam)).filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
      if (!q) return true
      return (
        t.id.toLowerCase().includes(q) ||
        t.referenceId.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.userName.toLowerCase().includes(q) ||
        t.phone.includes(q)
      )
    })
  }, [tickets, users, supportTeam, search, statusFilter, priorityFilter])

  const filteredFeedback = useMemo(() => {
    return feedback.map((item) => enrichFeedback(item, users))
  }, [feedback, users])

  const markFeedbackStatus = async (feedbackId: string, status: FeedbackStatus) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      return
    }
    try {
      const updated = await updateAdminFeedbackStatus(session.accessToken, feedbackId, status)
      setFeedback((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      showToast(`Feedback marked ${status}.`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update feedback.')
    }
  }

  const filteredAudit = useMemo(() => {
    return auditEntries.filter((a) => {
      if (auditAdmin !== 'all' && a.admin !== auditAdmin) return false
      if (auditAction !== 'all' && a.actionType !== auditAction) return false
      return true
    })
  }, [auditEntries, auditAdmin, auditAction])

  const legalContent = useMemo(() => {
    return contentItems
      .filter((item) => item.section === 'legal')
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
        const bTime = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime()
        return bTime - aTime
      })
  }, [contentItems])

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (loadError && (tab === 'support' || tab === 'feedback' || tab === 'legal' || tab === 'audit')) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-6 text-center">
        <ScrollText className="size-12 text-muted-foreground" />
        <p className="max-w-md text-lg font-medium text-foreground">{loadError}</p>
        <Button type="button" onClick={() => void loadSettingsData()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      {tab === 'general' && maintenance && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          App is in maintenance mode — users cannot access the app.
        </div>
      )}

      {tab === 'support' && (
        <>
          <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
            {(
              [
                ['all', 'All'],
                ['open', 'Open'],
                ['in_progress', 'In Progress'],
                ['resolved', 'Resolved'],
                ['closed', 'Closed'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={cn(
                  'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  statusFilter === key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                onClick={() => setStatusFilter(key)}
              >
                {label} ({statusCounts[key]})
              </button>
            ))}
          </div>

          <Card className="overflow-hidden rounded-2xl border-border/80 shadow-sm">
            <CardContent className="overflow-x-auto p-0">
              <table className="min-w-[900px] w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Ticket</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Assigned</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((t) => (
                      <tr
                        key={t.id}
                        className={cn(
                          'border-b border-border transition-colors hover:bg-muted/40',
                          t.priority === 'urgent' && 'border-l-4 border-l-red-500',
                          ticketNoResponse48h(t) && 'border-l-4 border-l-red-500 bg-red-50/30',
                        )}
                      >
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-muted-foreground">{t.referenceId}</p>
                          <p className="font-medium">{t.subject}</p>
                          <Badge variant="default" className="mt-1">
                            {CATEGORY_LABELS[t.category]}
                          </Badge>
                          {isTicketOverdue(t) && (
                            <Badge variant="pending" className="ml-1">
                              Overdue
                            </Badge>
                          )}
                          {ticketNoResponse48h(t) && (
                            <Badge variant="red" className="ml-1">
                              No response 48h+
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xs font-semibold text-white">
                              {getInitials(t.userName)}
                            </div>
                            <div>
                              <p className="font-medium">
                                {t.userName}
                                {(userTicketCounts.get(t.userId) ?? 0) > 1 && (
                                  <Badge variant="blue" className="ml-1">
                                    {(userTicketCounts.get(t.userId) ?? 0) as number} tickets
                                  </Badge>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">{t.phone}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">{priorityBadge(t.priority)}</td>
                        <td className="px-4 py-3">{statusBadge(t.status)}</td>
                        <td className="px-4 py-3">{t.assignedToName}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatTimeAgo(t.createdAt)}</td>
                        <td className="px-4 py-3">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => navigate(`/admin/settings/support/${t.referenceId}`)}
                          >
                            View →
                          </Button>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table>
              {filteredTickets.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No tickets match filters</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'feedback' && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="rounded-2xl border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Total Feedback</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{feedback.length}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">New</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-blue-600">{feedback.filter((item) => item.status === 'new').length}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Reviewed</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-green-600">{feedback.filter((item) => item.status === 'reviewed').length}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden rounded-2xl border-border/80 shadow-sm">
            <CardContent className="overflow-x-auto p-0">
              <table className="min-w-[900px] w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Feedback</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Received</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFeedback.map((item) => (
                    <tr key={item.id} className="border-b border-border transition-colors hover:bg-muted/40">
                      <td className="max-w-md px-4 py-3">
                        <p className="font-mono text-xs text-muted-foreground">{item.referenceId}</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{item.message}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xs font-semibold text-white">
                            {getInitials(item.userName)}
                          </div>
                          <div>
                            <p className="font-medium">{item.userName}</p>
                            <p className="text-xs text-muted-foreground">{item.phone || 'No phone'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <p>{item.source}</p>
                        <p className="text-xs">{item.sourceScreen}</p>
                      </td>
                      <td className="px-4 py-3">{feedbackStatusBadge(item.status)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatTimeAgo(item.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {item.status !== 'reviewed' && (
                            <Button type="button" size="sm" onClick={() => void markFeedbackStatus(item.id, 'reviewed')}>
                              Mark reviewed
                            </Button>
                          )}
                          {item.status !== 'archived' && (
                            <Button type="button" size="sm" variant="outline" onClick={() => void markFeedbackStatus(item.id, 'archived')}>
                              Archive
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredFeedback.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No feedback submitted yet</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'access' && (
        <AccessTabFull
          admins={admins}
          setAdmins={setAdmins}
          permModalRole={permModalRole}
          setPermModalRole={setPermModalRole}
          permissions={permissions}
          setPermissions={setPermissions}
          auditEntries={auditEntries}
          showToast={showToast}
        />
      )}

      {tab === 'general' && (
        <GeneralTabContent
          admins={admins}
          company={company}
          setCompany={setCompany}
          maintenance={maintenance}
          setMaintenance={setMaintenance}
          appToggles={appToggles}
          setAppToggles={setAppToggles}
          emailNotifs={emailNotifs}
          setEmailNotifs={setEmailNotifs}
          slaInteriorHours={slaInteriorHours}
          setSlaInteriorHours={setSlaInteriorHours}
          slaStageHours={slaStageHours}
          setSlaStageHours={setSlaStageHours}
          slaAutoEscalate={slaAutoEscalate}
          setSlaAutoEscalate={setSlaAutoEscalate}
          slaEscalateTo={slaEscalateTo}
          setSlaEscalateTo={setSlaEscalateTo}
          adminAlerts={adminAlerts}
          setAdminAlerts={setAdminAlerts}
          alertEmail={alertEmail}
          setAlertEmail={setAlertEmail}
          alertWhatsApp={alertWhatsApp}
          setAlertWhatsApp={setAlertWhatsApp}
          slaEnquiryHours={slaEnquiryHours}
          setSlaEnquiryHours={setSlaEnquiryHours}
          adminContact={adminContact}
          dashboardTimezone={dashboardTimezone}
          setDashboardTimezone={setDashboardTimezone}
          dashboardDateFormat={dashboardDateFormat}
          setDashboardDateFormat={setDashboardDateFormat}
          dashboardCurrencyFormat={dashboardCurrencyFormat}
          setDashboardCurrencyFormat={setDashboardCurrencyFormat}
          onSettingsSaved={applySettings}
          onReloadSettings={() => void loadSettingsData()}
          showToast={showToast}
        />
      )}
      {tab === 'legal' && (
        <LegalContentTabContent
          legalContent={legalContent}
          setContentItems={setContentItems}
          showToast={showToast}
        />
      )}
      {tab === 'audit' && (
        <AuditTabContent
          filteredAudit={filteredAudit}
          auditDate={auditDate}
          setAuditDate={setAuditDate}
          auditAdmin={auditAdmin}
          setAuditAdmin={setAuditAdmin}
          auditAction={auditAction}
          setAuditAction={setAuditAction}
          expandedAuditId={expandedAuditId}
          setExpandedAuditId={setExpandedAuditId}
          showToast={showToast}
        />
      )}

    </div>
  )
}

function adminToForm(admin: AdminUser): AdminFormState {
  return {
    name: admin.name,
    email: admin.email,
    phone: admin.phone ?? '',
    photoUrl: admin.photoUrl ?? '',
    password: '',
    confirmPassword: '',
    role: admin.role,
    department: admin.department ?? '',
    assignedProperties: admin.assignedProperties ?? '',
    active: admin.status === 'active',
    sendWelcomeEmail: false,
  }
}

function AdminAvatar({ admin }: { admin: AdminUser }) {
  if (admin.photoUrl) {
    return (
      <img
        src={admin.photoUrl}
        alt=""
        className="size-8 shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xs text-white">
      {getInitials(admin.name)}
    </div>
  )
}

function AccessTabFull({
  admins,
  setAdmins,
  permModalRole,
  setPermModalRole,
  permissions,
  setPermissions,
  auditEntries,
  showToast,
}: {
  admins: AdminUser[]
  setAdmins: React.Dispatch<React.SetStateAction<AdminUser[]>>
  permModalRole: string | null
  setPermModalRole: React.Dispatch<React.SetStateAction<string | null>>
  permissions: Record<string, boolean>
  setPermissions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  auditEntries: AuditEntry[]
  showToast: (msg: string) => void
}) {
  const navigate = useNavigate()
  const [adminFormOpen, setAdminFormOpen] = useState(false)
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null)
  const [form, setForm] = useState<AdminFormState>(EMPTY_ADMIN_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [resetPasswordAdmin, setResetPasswordAdmin] = useState<AdminUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetErrors, setResetErrors] = useState<Record<string, string>>({})
  const [activityAdminName, setActivityAdminName] = useState<string | null>(null)
  const [confirmSuspend, setConfirmSuspend] = useState<AdminUser | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<AdminUser | null>(null)
  const [salesTeam, setSalesTeam] = useState<SalesPerson[]>([])
  const [salesFormOpen, setSalesFormOpen] = useState(false)
  const [editingSalesId, setEditingSalesId] = useState<string | null>(null)
  const [salesDraft, setSalesDraft] = useState({
    name: '',
    phone: '',
    email: '',
    role: 'sales_executive' as SalesPerson['role'],
    assignedArea: '',
  })
  const [confirmRemoveSales, setConfirmRemoveSales] = useState<SalesPerson | null>(null)
  const [rolePermissionOverrides, setRolePermissionOverrides] = useState<
    Partial<Record<AdminRole, string[]>>
  >({})
  const [salesFormErrors, setSalesFormErrors] = useState<Record<string, string>>({})

  const superAdminCount = useMemo(
    () => admins.filter((a) => a.role === 'Super Admin').length,
    [admins],
  )

  const activityEntries = useMemo(() => {
    if (!activityAdminName) return []
    return auditEntries.filter((a) => a.admin === activityAdminName).slice(0, 10)
  }, [auditEntries, activityAdminName])

  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  useEffect(() => {
    const session = readAdminSession()
    if (!session?.accessToken) return
    void getAdminSalesTeam(session.accessToken)
      .then(setSalesTeam)
      .catch(() => setSalesTeam([]))
  }, [])

  const openCreateForm = () => {
    setEditingAdmin(null)
    setForm(EMPTY_ADMIN_FORM)
    setFormErrors({})
    setAdminFormOpen(true)
  }

  const openEditForm = (admin: AdminUser) => {
    setEditingAdmin(admin)
    setForm(adminToForm(admin))
    setFormErrors({})
    setAdminFormOpen(true)
    setOpenMenuId(null)
  }

  const closeAdminForm = () => {
    setAdminFormOpen(false)
    setEditingAdmin(null)
    setForm(EMPTY_ADMIN_FORM)
    setFormErrors({})
    setShowPassword(false)
    setShowConfirmPassword(false)
  }

  const validateAdminForm = (isEdit: boolean) => {
    const errors: Record<string, string> = {}
    const emailNorm = form.email.trim().toLowerCase()

    if (!form.name.trim()) errors.name = 'Full name is required'
    if (!emailNorm) errors.email = 'Email is required'
    else if (!EMAIL_REGEX.test(emailNorm)) errors.email = 'Enter a valid email address'
    else if (
      admins.some(
        (a) => a.email.toLowerCase() === emailNorm && a.id !== editingAdmin?.id,
      )
    ) {
      errors.email = 'This email is already registered'
    }

    if (!isEdit) {
      if (!form.password) errors.password = 'Password is required'
      else if (form.password.length < 8) {
        errors.password = 'Password must be at least 8 characters'
      }
      if (!form.confirmPassword) errors.confirmPassword = 'Please confirm password'
      else if (form.password !== form.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match'
      }
    } else if (form.password || form.confirmPassword) {
      if (form.password.length < 8) {
        errors.password = 'Password must be at least 8 characters'
      }
      if (form.password !== form.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match'
      }
    }

    if (!form.role) errors.role = 'Role is required'

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmitAdminForm = async () => {
    const isEdit = Boolean(editingAdmin)
    if (!validateAdminForm(isEdit)) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      return
    }

    const emailNorm = form.email.trim().toLowerCase()
    const rolePermissions =
      rolePermissionOverrides[form.role] ??
      DEFAULT_ROLE_PERMISSIONS[mapAdminRoleToBackend(form.role)] ??
      []
    const payload = {
      name: form.name.trim(),
      email: emailNorm,
      phone: form.phone.trim() || undefined,
      photoUrl: form.photoUrl.trim() || undefined,
      role: mapAdminRoleToBackend(form.role),
      department: form.department || undefined,
      assignedArea: form.assignedProperties
        .split(',')
        .map((area) => area.trim())
        .filter(Boolean),
      status: (form.active ? 'active' : 'suspended') as AdminUser['status'],
      permissions: rolePermissions,
    }

    try {
      if (isEdit && editingAdmin) {
        const updated = await updateAdminOperator(session.accessToken, editingAdmin.id, payload)
        setAdmins((prev) =>
          prev.map((a) =>
            a.id === editingAdmin.id
              ? mapAdminOperator(updated, session.admin.email)
              : a,
          ),
        )
        showToast('Admin account updated')
      } else {
        const invited = await inviteAdminOperator(session.accessToken, payload)
        setAdmins((prev) => [mapAdminOperator(invited, session.admin.email), ...prev])
        showToast(`Admin account created. Login credentials issued for ${emailNorm}`)
      }
      closeAdminForm()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save admin account.')
    }
  }

  const handleResetPassword = async () => {
    if (!resetPasswordAdmin) return
    const errors: Record<string, string> = {}
    if (!resetPassword) errors.password = 'Password is required'
    else if (resetPassword.length < 8) {
      errors.password = 'Password must be at least 8 characters'
    }
    if (resetPassword !== resetConfirm) {
      errors.confirmPassword = 'Passwords do not match'
    }
    setResetErrors(errors)
    if (Object.keys(errors).length > 0) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      return
    }
    try {
      const updated = await resetAdminOperatorPassword(session.accessToken, resetPasswordAdmin.id, resetPassword)
      setAdmins((prev) =>
        prev.map((a) => (a.id === resetPasswordAdmin.id ? mapAdminOperator(updated, session.admin.email) : a)),
      )
      showToast('Password reset successfully')
      setResetPasswordAdmin(null)
      setResetPassword('')
      setResetConfirm('')
      setResetErrors({})
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to reset password.')
    }
  }

  const handleConfirmSuspend = async () => {
    if (!confirmSuspend) return
    if (confirmSuspend.isSelf) {
      showToast('You cannot suspend your own account')
      setConfirmSuspend(null)
      return
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      setConfirmSuspend(null)
      return
    }
    try {
      const updated = await setAdminOperatorSuspended(session.accessToken, confirmSuspend.id, true)
      setAdmins((prev) =>
        prev.map((a) =>
          a.id === confirmSuspend.id ? mapAdminOperator(updated, session.admin.email) : a,
        ),
      )
      showToast(`${confirmSuspend.name} has been suspended`)
      setConfirmSuspend(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to suspend admin.')
    }
  }

  const handleConfirmRemove = async () => {
    if (!confirmRemove) return
    if (confirmRemove.isSelf) {
      showToast('You cannot remove your own account')
      setConfirmRemove(null)
      return
    }
    if (confirmRemove.role === 'Super Admin' && superAdminCount <= 1) {
      showToast('Cannot remove the last Super Admin')
      setConfirmRemove(null)
      return
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      setConfirmRemove(null)
      return
    }
    try {
      await removeAdminOperator(session.accessToken, confirmRemove.id)
      setAdmins((prev) => prev.filter((a) => a.id !== confirmRemove.id))
      showToast(`${confirmRemove.name} removed from dashboard`)
      setConfirmRemove(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to remove admin.')
    }
  }

  const openSalesCreateForm = () => {
    setEditingSalesId(null)
    setSalesDraft({
      name: '',
      phone: '',
      email: '',
      role: 'sales_executive',
      assignedArea: '',
    })
    setSalesFormErrors({})
    setSalesFormOpen(true)
  }

  const openSalesEditForm = (person: SalesPerson) => {
    setEditingSalesId(person.id)
    setSalesDraft({
      name: person.name,
      phone: person.phone,
      email: person.email,
      role: person.role,
      assignedArea: person.assignedArea.join(', '),
    })
    setSalesFormErrors({})
    setSalesFormOpen(true)
  }

  const validateSalesForm = () => {
    const errors: Record<string, string> = {}
    if (!salesDraft.name.trim()) errors.salesName = 'Full name is required'
    if (!salesDraft.phone.trim()) errors.salesPhone = 'Phone number is required'
    else if (!/^\+?[\d\s-]{10,}$/.test(salesDraft.phone.trim())) {
      errors.salesPhone = 'Enter a valid phone number'
    }
    const emailNorm = salesDraft.email.trim()
    if (emailNorm && !EMAIL_REGEX.test(emailNorm)) {
      errors.salesEmail = 'Enter a valid email address'
    }
    setSalesFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveSalesPerson = async () => {
    if (!validateSalesForm()) return
    const areas = salesDraft.assignedArea
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      return
    }
    try {
      if (editingSalesId) {
        const updated = await updateAdminSalesTeamMember(session.accessToken, editingSalesId, {
          name: salesDraft.name.trim(),
          phone: salesDraft.phone.trim(),
          email: salesDraft.email.trim(),
          role: salesDraft.role,
          assignedArea: areas,
        })
        setSalesTeam((prev) => prev.map((sp) => (sp.id === editingSalesId ? updated : sp)))
        showToast('Sales team member updated')
      } else {
        const created = await createAdminSalesTeamMember(session.accessToken, {
          name: salesDraft.name.trim(),
          phone: salesDraft.phone.trim(),
          email: salesDraft.email.trim(),
          role: salesDraft.role,
          assignedArea: areas,
        })
        setSalesTeam((prev) => [...prev, created])
        showToast('Sales team member added')
      }
      setSalesFormOpen(false)
      setEditingSalesId(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save sales team member.')
    }
  }

  const handleConfirmRemoveSales = async () => {
    if (!confirmRemoveSales) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      setConfirmRemoveSales(null)
      return
    }
    try {
      await removeAdminSalesTeamMember(session.accessToken, confirmRemoveSales.id)
      setSalesTeam((prev) => prev.filter((sp) => sp.id !== confirmRemoveSales.id))
      showToast(`${confirmRemoveSales.name} removed from sales team`)
      setConfirmRemoveSales(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to remove sales team member.')
    }
  }

  const fieldClass = (key: string) =>
    cn(
      'mt-1 h-9 w-full rounded-md border bg-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20',
      formErrors[key] || salesFormErrors[key] ? 'border-red-500' : 'border-border',
    )

  return (
    <div className="mx-auto max-w-[1000px] space-y-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Admin Users</CardTitle>
          <Button type="button" size="sm" onClick={openCreateForm}>
            + Add Admin
          </Button>
        </CardHeader>
        <CardContent>
          {adminFormOpen && (
            <div className="mb-6 space-y-6 rounded-lg border border-border p-4 md:p-6">
              <h3 className="font-semibold">
                {editingAdmin ? 'Edit Admin Profile' : 'Create Admin Account'}
              </h3>

              <div>
                <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
                  Personal Info
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm sm:col-span-2">
                    Full Name *
                    <input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className={fieldClass('name')}
                    />
                    {formErrors.name && (
                      <p className="mt-1 text-xs text-red-600">{formErrors.name}</p>
                    )}
                  </label>
                  <label className="block text-sm">
                    Email Address *
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className={fieldClass('email')}
                    />
                    {formErrors.email && (
                      <p className="mt-1 text-xs text-red-600">{formErrors.email}</p>
                    )}
                  </label>
                  <label className="block text-sm">
                    Phone Number
                    <input
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      className={fieldClass('phone')}
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    Profile Photo URL
                    <div className="mt-1 flex items-center gap-3">
                      {form.photoUrl.trim() ? (
                        <img
                          src={form.photoUrl}
                          alt=""
                          className="size-12 rounded-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {form.name ? getInitials(form.name) : '?'}
                        </div>
                      )}
                      <input
                        value={form.photoUrl}
                        onChange={(e) => setForm((f) => ({ ...f, photoUrl: e.target.value }))}
                        placeholder="https://..."
                        className={cn(fieldClass('photoUrl'), 'flex-1')}
                      />
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
                  Login Credentials
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    Password {!editingAdmin && '*'}
                    <div className="relative mt-1">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder={editingAdmin ? 'Leave blank to keep' : ''}
                        className={cn(fieldClass('password'), 'pr-10')}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                    {!editingAdmin && (
                      <p className="mt-1 text-xs text-muted-foreground">Min 8 characters</p>
                    )}
                    {formErrors.password && (
                      <p className="mt-1 text-xs text-red-600">{formErrors.password}</p>
                    )}
                  </label>
                  <label className="block text-sm">
                    Confirm Password {!editingAdmin && '*'}
                    <div className="relative mt-1">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={form.confirmPassword}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, confirmPassword: e.target.value }))
                        }
                        className={cn(fieldClass('confirmPassword'), 'pr-10')}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    {formErrors.confirmPassword && (
                      <p className="mt-1 text-xs text-red-600">{formErrors.confirmPassword}</p>
                    )}
                  </label>
                </div>
              </div>

              <div>
                <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
                  Role & Access
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    Role *
                    <select
                      value={form.role}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, role: e.target.value as AdminRole }))
                      }
                      className={fieldClass('role')}
                    >
                      {ADMIN_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    {formErrors.role && (
                      <p className="mt-1 text-xs text-red-600">{formErrors.role}</p>
                    )}
                  </label>
                  <label className="block text-sm">
                    Department
                    <select
                      value={form.department}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          department: e.target.value as AdminFormState['department'],
                        }))
                      }
                      className={fieldClass('department')}
                    >
                      <option value="">—</option>
                      {ADMIN_DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    Assigned Properties
                    <input
                      value={form.assignedProperties}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, assignedProperties: e.target.value }))
                      }
                      placeholder="e.g. Whitefield area"
                      className={fieldClass('assignedProperties')}
                    />
                  </label>
                </div>
              </div>

              <div>
                <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Status</p>
                <div className="space-y-3">
                  <label className="flex items-center justify-between gap-4 text-sm">
                    <span>Active</span>
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                    />
                  </label>
                  {!editingAdmin && (
                    <label className="flex items-start justify-between gap-4 text-sm">
                      <span>
                        Send welcome email
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Send login credentials to admin via email
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={form.sendWelcomeEmail}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, sendWelcomeEmail: e.target.checked }))
                        }
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleSubmitAdminForm}>
                  {editingAdmin ? 'Update Admin' : 'Create Admin Account'}
                </Button>
                <Button type="button" variant="outline" onClick={closeAdminForm}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Admin</th>
                <th>Email</th>
                <th>Role</th>
                <th>Last Active</th>
                <th>Status</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-b border-border">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <AdminAvatar admin={a} />
                      {a.name}
                    </div>
                  </td>
                  <td>{a.email}</td>
                  <td>
                    <Badge
                      variant={
                        a.role === 'Super Admin'
                          ? 'blue'
                          : a.role === 'Admin'
                            ? 'new'
                            : a.role === 'Operations'
                              ? 'responded'
                              : 'pending'
                      }
                    >
                      {a.role}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground">{a.lastActive}</td>
                  <td>
                    {a.status === 'suspended' ? (
                      <Badge variant="red">Suspended</Badge>
                    ) : a.status === 'invited' ? (
                      <div className="flex flex-col gap-1">
                        <Badge variant="pending">Invited</Badge>
                        {a.invitedAt &&
                          hoursSince(a.invitedAt) / 24 > 7 && (
                            <Badge className="w-fit bg-orange-100 text-orange-800">
                              Invite expired
                            </Badge>
                          )}
                      </div>
                    ) : (
                      'Active'
                    )}
                  </td>
                  <td className="relative py-3">
                    <button
                      type="button"
                      className="rounded-md p-1 hover:bg-muted"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenMenuId((id) => (id === a.id ? null : a.id))
                      }}
                      aria-label="Actions"
                    >
                      <MoreVertical className="size-4" />
                    </button>
                    {openMenuId === a.id && (
                      <div
                        className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-border bg-card py-1 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {a.status === 'invited' && (
                          <>
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                              onClick={() => {
                                setAdmins((prev) =>
                                  prev.map((x) =>
                                    x.id === a.id
                                      ? { ...x, invitedAt: new Date().toISOString() }
                                      : x,
                                  ),
                                )
                                showToast(`Invite resent to ${a.email}`)
                                setOpenMenuId(null)
                              }}
                            >
                              Resend Invite
                            </button>
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
                              onClick={() => {
                                setAdmins((prev) => prev.filter((x) => x.id !== a.id))
                                showToast(`Invite cancelled for ${a.email}`)
                                setOpenMenuId(null)
                              }}
                            >
                              Cancel Invite
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => openEditForm(a)}
                        >
                          Edit Profile
                        </button>
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setResetPasswordAdmin(a)
                            setResetPassword('')
                            setResetConfirm('')
                            setResetErrors({})
                            setOpenMenuId(null)
                          }}
                        >
                          Reset Password
                        </button>
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setOpenMenuId(null)
                            navigate('/admin/settings/audit')
                          }}
                        >
                          View Activity
                        </button>
                        {!a.isSelf && a.status === 'active' && (
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm text-orange-600 hover:bg-muted"
                            onClick={() => {
                              setConfirmSuspend(a)
                              setOpenMenuId(null)
                            }}
                          >
                            Suspend
                          </button>
                        )}
                        {!a.isSelf && (
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
                            onClick={() => {
                              setConfirmRemove(a)
                              setOpenMenuId(null)
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Sales Team</CardTitle>
          <Button type="button" size="sm" onClick={openSalesCreateForm}>
            + Add Member
          </Button>
        </CardHeader>
        <CardContent>
          {salesFormOpen && (
            <div className="mb-6 space-y-3 rounded-lg border border-border p-4">
              <h3 className="font-semibold">
                {editingSalesId ? 'Edit Sales Member' : 'Add Sales Member'}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  Full Name *
                  <input
                    value={salesDraft.name}
                    onChange={(e) => setSalesDraft((d) => ({ ...d, name: e.target.value }))}
                    className={fieldClass('salesName')}
                  />
                  {salesFormErrors.salesName && (
                    <p className="mt-1 text-xs text-red-600">{salesFormErrors.salesName}</p>
                  )}
                </label>
                <label className="block text-sm">
                  Phone *
                  <input
                    value={salesDraft.phone}
                    onChange={(e) => setSalesDraft((d) => ({ ...d, phone: e.target.value }))}
                    className={fieldClass('salesPhone')}
                  />
                  {salesFormErrors.salesPhone && (
                    <p className="mt-1 text-xs text-red-600">{salesFormErrors.salesPhone}</p>
                  )}
                </label>
                <label className="block text-sm">
                  Email
                  <input
                    type="email"
                    value={salesDraft.email}
                    onChange={(e) => setSalesDraft((d) => ({ ...d, email: e.target.value }))}
                    className={fieldClass('salesEmail')}
                  />
                  {salesFormErrors.salesEmail && (
                    <p className="mt-1 text-xs text-red-600">{salesFormErrors.salesEmail}</p>
                  )}
                </label>
                <label className="block text-sm">
                  Role
                  <select
                    value={salesDraft.role}
                    onChange={(e) =>
                      setSalesDraft((d) => ({
                        ...d,
                        role: e.target.value as SalesPerson['role'],
                      }))
                    }
                    className={fieldClass('salesRole')}
                  >
                    <option value="sales_manager">Sales Manager</option>
                    <option value="sales_executive">Sales Executive</option>
                    <option value="relationship_manager">Relationship Manager</option>
                  </select>
                </label>
                <label className="block text-sm sm:col-span-2">
                  Assigned Areas (comma-separated)
                  <input
                    value={salesDraft.assignedArea}
                    onChange={(e) =>
                      setSalesDraft((d) => ({ ...d, assignedArea: e.target.value }))
                    }
                    placeholder="Whitefield, Marathahalli"
                    className={fieldClass('salesArea')}
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={saveSalesPerson}>
                  {editingSalesId ? 'Save Changes' : 'Add Member'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSalesFormOpen(false)
                    setEditingSalesId(null)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Name</th>
                <th>Role</th>
                <th>Areas</th>
                <th>Active Enquiries</th>
                <th>Available</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {salesTeam.map((sp) => (
                <tr key={sp.id} className="border-b border-border">
                  <td className="py-3">
                    <div>
                      <p className="font-medium">{sp.name}</p>
                      <p className="text-xs text-muted-foreground">{sp.phone}</p>
                    </div>
                  </td>
                  <td>
                    <Badge variant="default">{getSalesRoleLabel(sp.role)}</Badge>
                  </td>
                  <td className="max-w-[180px] text-xs text-muted-foreground">
                    {sp.assignedArea.join(', ')}
                  </td>
                  <td>{sp.activeEnquiries}</td>
                  <td>
                    <button
                      type="button"
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        sp.isAvailable
                          ? 'bg-green-100 text-green-800'
                          : 'bg-muted text-muted-foreground',
                      )}
                      onClick={async () => {
                        const session = readAdminSession()
                        if (!session?.accessToken) {
                          showToast('Admin session expired. Please sign in again.')
                          return
                        }
                        try {
                          const updated = await updateAdminSalesTeamMember(session.accessToken, sp.id, {
                            isAvailable: !sp.isAvailable,
                          })
                          setSalesTeam((prev) => prev.map((x) => (x.id === sp.id ? updated : x)))
                          showToast('Sales availability updated')
                        } catch (error) {
                          showToast(error instanceof Error ? error.message : 'Unable to update availability.')
                        }
                      }}
                    >
                      {sp.isAvailable ? 'Available' : 'Unavailable'}
                    </button>
                  </td>
                  <td className="space-x-2 py-3">
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => openSalesEditForm(sp)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline"
                      onClick={() => setConfirmRemoveSales(sp)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {resetPasswordAdmin && (
        <Modal
          title={`Reset Password — ${resetPasswordAdmin.name}`}
          onClose={() => setResetPasswordAdmin(null)}
        >
          <div className="space-y-3">
            <label className="block text-sm">
              New password
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className={cn(
                  'mt-1 h-9 w-full rounded-md border bg-input px-3 text-sm',
                  resetErrors.password ? 'border-red-500' : 'border-border',
                )}
              />
              {resetErrors.password && (
                <p className="mt-1 text-xs text-red-600">{resetErrors.password}</p>
              )}
            </label>
            <label className="block text-sm">
              Confirm password
              <input
                type="password"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                className={cn(
                  'mt-1 h-9 w-full rounded-md border bg-input px-3 text-sm',
                  resetErrors.confirmPassword ? 'border-red-500' : 'border-border',
                )}
              />
              {resetErrors.confirmPassword && (
                <p className="mt-1 text-xs text-red-600">{resetErrors.confirmPassword}</p>
              )}
            </label>
            <Button type="button" className="w-full" onClick={handleResetPassword}>
              Reset
            </Button>
          </div>
        </Modal>
      )}

      {activityAdminName && (
        <Modal
          title={`Activity — ${activityAdminName}`}
          onClose={() => setActivityAdminName(null)}
        >
          {activityEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent audit entries for this admin.</p>
          ) : (
            <ul className="max-h-[50vh] space-y-3 overflow-y-auto text-sm">
              {activityEntries.map((entry) => (
                <li key={entry.id} className="border-b border-border pb-2">
                  <div className="flex items-center gap-2">
                    {auditActionBadge(entry.actionType)}
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(entry.at)}
                    </span>
                  </div>
                  <p className="mt-1">{entry.description}</p>
                  <p className="text-xs text-muted-foreground">{entry.section}</p>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {confirmSuspend && (
        <Modal title="Suspend admin?" onClose={() => setConfirmSuspend(null)}>
          <p className="text-sm">
            Suspend <strong>{confirmSuspend.name}</strong>?
          </p>
          <p className="mt-2 text-sm text-muted-foreground">They will not be able to login</p>
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="outline" onClick={handleConfirmSuspend}>
              Confirm
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirmSuspend(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {confirmRemove && (
        <Modal title="Remove admin?" onClose={() => setConfirmRemove(null)}>
          <p className="text-sm">
            Remove <strong>{confirmRemove.name}</strong> from dashboard?
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-destructive text-destructive"
              onClick={handleConfirmRemove}
            >
              Confirm
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {confirmRemoveSales && (
        <Modal title="Remove sales member?" onClose={() => setConfirmRemoveSales(null)}>
          <p className="text-sm">
            Remove <strong>{confirmRemoveSales.name}</strong> from sales team?
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-destructive text-destructive"
              onClick={handleConfirmRemoveSales}
            >
              Confirm
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirmRemoveSales(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      <div>
        <h2 className="mb-4 text-lg font-semibold">Roles & Permissions</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-purple-200 bg-purple-50/30">
            <CardContent className="p-4">
              <Badge className="bg-purple-100 text-purple-800">Super Admin</Badge>
              <p className="mt-2 text-sm text-muted-foreground">Full access to everything</p>
              <p className="mt-1 text-xs">
                Assigned: {superAdminCount} user{superAdminCount === 1 ? '' : 's'}
              </p>
              <p className="mt-2 text-xs italic text-muted-foreground">Cannot be edited or deleted</p>
            </CardContent>
          </Card>
          {(
            [
              {
                role: 'Admin' as AdminRole,
                badge: 'bg-blue-100 text-blue-800',
                perms: [
                  '✅ View all sections',
                  '✅ Edit properties',
                  '✅ Manage users',
                  '✅ View reports',
                  '❌ Access Control',
                  '❌ Delete data',
                ],
              },
              {
                role: 'Operations' as AdminRole,
                badge: 'bg-green-100 text-green-800',
                perms: [
                  '✅ View enquiries',
                  '✅ Manage visits',
                  '✅ Update pipeline',
                  '❌ Delete properties',
                  '❌ Manage users',
                  '❌ Reports',
                ],
              },
              {
                role: 'Support' as AdminRole,
                badge: 'bg-orange-100 text-orange-800',
                perms: ['✅ View tickets', '✅ Respond to tickets', '❌ Everything else'],
              },
            ] as const
          ).map((r) => {
            const assignedCount = adminsForDisplayRole(r.role, admins).length
            return (
            <Card key={r.role}>
              <CardContent className="p-4">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', r.badge)}>
                  {r.role}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">
                  Assigned: {assignedCount} user{assignedCount === 1 ? '' : 's'}
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {r.perms.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    setPermissions(permissionsForRole(r.role, admins, rolePermissionOverrides))
                    setPermModalRole(r.role)
                  }}
                >
                  Edit Permissions
                </Button>
              </CardContent>
            </Card>
            )
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Access Logs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {auditEntries.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No backend access activity has been recorded yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-muted-foreground">
                  <th className="py-2 text-left">Admin</th>
                  <th className="text-left">Action</th>
                  <th>IP</th>
                  <th>Device</th>
                  <th>Date/Time</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.slice(0, 10).map((l) => (
                  <tr key={l.id} className="border-b border-border">
                    <td className="py-2 font-medium">{l.admin}</td>
                    <td>{l.description || l.actionType}</td>
                    <td className="font-mono text-xs">{l.ip || '—'}</td>
                    <td className="text-muted-foreground">{l.device || '—'}</td>
                    <td className="text-muted-foreground">{formatDateTime(l.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {permModalRole && (
        <Modal title={`Edit Permissions — ${permModalRole}`} onClose={() => setPermModalRole(null)}>
          <div className="max-h-[50vh] space-y-4 overflow-y-auto">
            {Object.entries(PERMISSION_SECTIONS).map(([section, items]) => (
              <div key={section}>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  {section}
                </p>
                <div className="space-y-2">
                  {items.map((item) => (
                    <label key={item} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={permissions[item] ?? false}
                        onChange={(e) =>
                          setPermissions((prev) => ({ ...prev, [item]: e.target.checked }))
                        }
                      />
                      {item}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPermModalRole(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const session = readAdminSession()
                if (!session?.accessToken) {
                  showToast('Admin session expired. Please sign in again.')
                  return
                }
                const role = permModalRole as AdminRole
                const selected = adminsForDisplayRole(role, admins)
                const nextPermissions = backendPermissionsFromLabels(permissions)
                if (nextPermissions.length === 0) {
                  showToast('Select at least one permission')
                  return
                }
                try {
                  if (selected.length > 0) {
                    const updated = await Promise.all(
                      selected.map((admin) =>
                        updateAdminOperatorPermissions(session.accessToken, admin.id, nextPermissions),
                      ),
                    )
                    setAdmins((prev) =>
                      prev.map((admin) => {
                        const match = updated.find((item) => item.id === admin.id)
                        return match ? mapAdminOperator(match, session.admin.email) : admin
                      }),
                    )
                  }
                  setRolePermissionOverrides((prev) => ({ ...prev, [role]: nextPermissions }))
                  showToast(
                    selected.length > 0
                      ? `Permissions saved for ${selected.length} ${role} user${selected.length === 1 ? '' : 's'}`
                      : `${role} permission template saved for future admins`,
                  )
                  setPermModalRole(null)
                } catch (error) {
                  showToast(error instanceof Error ? error.message : 'Unable to save permissions.')
                }
              }}
            >
              Save Permissions
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SlaFieldRow({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  onSave,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  unit: string
  onSave: () => void
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <label className="text-sm font-medium">
        {label}
        <div className="mt-1 flex items-center gap-2">
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-9 w-24 rounded-md border border-border bg-input px-3 text-sm"
          />
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
      </label>
      <Button type="button" size="sm" variant="outline" onClick={onSave}>
        Save
      </Button>
    </div>
  )
}

function GeneralTabContent({
  admins,
  company,
  setCompany,
  maintenance,
  setMaintenance,
  appToggles,
  setAppToggles,
  emailNotifs,
  setEmailNotifs,
  slaInteriorHours,
  setSlaInteriorHours,
  slaStageHours,
  setSlaStageHours,
  slaAutoEscalate,
  setSlaAutoEscalate,
  slaEscalateTo,
  setSlaEscalateTo,
  adminAlerts,
  setAdminAlerts,
  alertEmail,
  setAlertEmail,
  alertWhatsApp,
  setAlertWhatsApp,
  slaEnquiryHours,
  setSlaEnquiryHours,
  adminContact,
  dashboardTimezone,
  setDashboardTimezone,
  dashboardDateFormat,
  setDashboardDateFormat,
  dashboardCurrencyFormat,
  setDashboardCurrencyFormat,
  onSettingsSaved,
  onReloadSettings,
  showToast,
}: {
  admins: AdminUser[]
  company: {
    name: string
    tagline: string
    email: string
    phone: string
    address: string
    city: string
    state: string
    pincode: string
  }
  setCompany: React.Dispatch<
    React.SetStateAction<{
      name: string
      tagline: string
      email: string
      phone: string
      address: string
      city: string
      state: string
      pincode: string
    }>
  >
  maintenance: boolean
  setMaintenance: React.Dispatch<React.SetStateAction<boolean>>
  appToggles: {
    registration: boolean
    kycRequired: boolean
    showPrices: boolean
    virtualTours: boolean
    stagePayment: boolean
    interior: boolean
  }
  setAppToggles: React.Dispatch<
    React.SetStateAction<{
      registration: boolean
      kycRequired: boolean
      showPrices: boolean
      virtualTours: boolean
      stagePayment: boolean
      interior: boolean
    }>
  >
  emailNotifs: {
    enquiry: boolean
    sell: boolean
    kyc: boolean
    user: boolean
    stageProof: boolean
    ticket: boolean
    daily: boolean
    weekly: boolean
  }
  setEmailNotifs: React.Dispatch<
    React.SetStateAction<{
      enquiry: boolean
      sell: boolean
      kyc: boolean
      user: boolean
      stageProof: boolean
      ticket: boolean
      daily: boolean
      weekly: boolean
    }>
  >
  slaInteriorHours: number
  setSlaInteriorHours: React.Dispatch<React.SetStateAction<number>>
  slaStageHours: number
  setSlaStageHours: React.Dispatch<React.SetStateAction<number>>
  slaAutoEscalate: boolean
  setSlaAutoEscalate: React.Dispatch<React.SetStateAction<boolean>>
  slaEscalateTo: string
  setSlaEscalateTo: React.Dispatch<React.SetStateAction<string>>
  adminAlerts: {
    slaBreached: boolean
    interiorInquiry: boolean
    stagePayment: boolean
    kycReview: boolean
    ticket48: boolean
    dailyEmail: boolean
    weeklyEmail: boolean
  }
  setAdminAlerts: React.Dispatch<
    React.SetStateAction<{
      slaBreached: boolean
      interiorInquiry: boolean
      stagePayment: boolean
      kycReview: boolean
      ticket48: boolean
      dailyEmail: boolean
      weeklyEmail: boolean
    }>
  >
  alertEmail: string
  setAlertEmail: React.Dispatch<React.SetStateAction<string>>
  alertWhatsApp: string
  setAlertWhatsApp: React.Dispatch<React.SetStateAction<string>>
  slaEnquiryHours: number
  setSlaEnquiryHours: React.Dispatch<React.SetStateAction<number>>
  adminContact: AdminContactDetails
  dashboardTimezone: string
  setDashboardTimezone: React.Dispatch<React.SetStateAction<string>>
  dashboardDateFormat: string
  setDashboardDateFormat: React.Dispatch<React.SetStateAction<string>>
  dashboardCurrencyFormat: 'indian' | 'international'
  setDashboardCurrencyFormat: React.Dispatch<
    React.SetStateAction<'indian' | 'international'>
  >
  onSettingsSaved: (settings: AdminSettings) => void
  onReloadSettings: () => void
  showToast: (msg: string) => void
}) {
  const [appliedInteriorHours, setAppliedInteriorHours] = useState(slaInteriorHours)
  const [appliedStageHours, setAppliedStageHours] = useState(slaStageHours)
  const [appliedEnquiryHours, setAppliedEnquiryHours] = useState(slaEnquiryHours)
  const [contactDraft, setContactDraft] = useState(adminContact)
  const [pendingTimezone, setPendingTimezone] = useState<string | null>(null)
  const [showSlaConfirm, setShowSlaConfirm] = useState(false)
  const [pendingSla, setPendingSla] = useState<{
    label: string
    old: number
    new: number
    kind?: 'enquiry'
    onConfirm: () => void
  } | null>(null)

  const timezoneLabels: Record<string, string> = {
    IST: 'IST (India Standard Time) UTC+5:30',
    GST: 'GST (Gulf Standard Time) UTC+4',
    SGT: 'SGT (Singapore) UTC+8',
    GMT: 'GMT (London) UTC+0',
    EST: 'EST (New York) UTC-5',
    PST: 'PST (Los Angeles) UTC-8',
  }

  const todayPreview = formatDatePreview(dashboardDateFormat, new Date())
  const currencyPreview =
    dashboardCurrencyFormat === 'indian'
      ? formatIndianCurrency(1234567)
      : formatInternationalCurrency(1234567)

  useEffect(() => {
    setAppliedInteriorHours(slaInteriorHours)
    setAppliedStageHours(slaStageHours)
    setAppliedEnquiryHours(slaEnquiryHours)
  }, [slaInteriorHours, slaStageHours, slaEnquiryHours])

  useEffect(() => {
    setContactDraft(adminContact)
  }, [adminContact])

  const saveSettings = async (body: Parameters<typeof updateAdminSettings>[1], message: string) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      return null
    }
    try {
      const saved = await updateAdminSettings(session.accessToken, body)
      onSettingsSaved(saved)
      showToast(message)
      return saved
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save settings.')
      return null
    }
  }

  const exportSettingsSnapshot = () => {
    const payload = {
      organization: company,
      app: { maintenance, ...appToggles },
      sla: {
        interiorHours: slaInteriorHours,
        stagePaymentHours: slaStageHours,
        enquiryHours: slaEnquiryHours,
        autoEscalate: slaAutoEscalate,
        escalateToName: slaEscalateTo,
      },
      alerts: {
        triggers: adminAlerts,
        email: alertEmail,
        whatsapp: alertWhatsApp,
      },
      notifications: {
        contact: adminContact,
        email: emailNotifs,
        whatsapp: {
          enquiry: emailNotifs.enquiry,
          slaBreached: adminAlerts.slaBreached,
        },
      },
      display: {
        timezone: dashboardTimezone,
        dateFormat: dashboardDateFormat,
        currencyFormat: dashboardCurrencyFormat,
      },
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'admin-settings.json'
    link.click()
    URL.revokeObjectURL(url)
    showToast('Settings export downloaded')
  }

  const toggleRow = (
    key: keyof typeof appToggles,
    label: string,
    hint: string,
  ) => (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
      <div>
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <input
        type="checkbox"
        checked={appToggles[key]}
        onChange={(e) => {
          setAppToggles((prev) => ({ ...prev, [key]: e.target.checked }))
        }}
      />
    </div>
  )

  return (
    <div className="mx-auto max-w-[700px] space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(
            [
              ['name', 'Company Name'],
              ['tagline', 'Tagline'],
              ['email', 'Email'],
              ['phone', 'Phone'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-sm">
              {label}
              <input
                value={company[key]}
                onChange={(e) => setCompany((c) => ({ ...c, [key]: e.target.value }))}
                className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              />
            </label>
          ))}
          <label className="block text-sm">
            Address
            <textarea
              value={company.address}
              onChange={(e) => setCompany((c) => ({ ...c, address: e.target.value }))}
              className="mt-1 min-h-[72px] w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['city', 'state', 'pincode'] as const).map((key) => (
              <input
                key={key}
                placeholder={key}
                value={company[key]}
                onChange={(e) => setCompany((c) => ({ ...c, [key]: e.target.value }))}
                className="h-9 rounded-md border border-border bg-input px-3 text-sm capitalize"
              />
            ))}
          </div>
          <Button
            type="button"
            onClick={() => void saveSettings({ organization: company }, 'Company info saved')}
          >
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4 text-blue-600" />
            Display Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="block text-sm">
            Dashboard Timezone
            <select
              value={dashboardTimezone}
              onChange={(e) => {
                const next = e.target.value
                if (next !== dashboardTimezone) setPendingTimezone(next)
              }}
              className="mt-1 h-9 w-full rounded-md border border-border bg-input px-2 text-sm"
            >
              <option value="IST">IST (India Standard Time) UTC+5:30 — Recommended</option>
              <option value="GST">GST (Gulf Standard Time) UTC+4</option>
              <option value="SGT">SGT (Singapore) UTC+8</option>
              <option value="GMT">GMT (London) UTC+0</option>
              <option value="EST">EST (New York) UTC-5</option>
              <option value="PST">PST (Los Angeles) UTC-8</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Affects how dates and times are displayed across dashboard
            </p>
          </label>

          <div>
            <p className="text-sm font-medium">Date Display Format</p>
            <div className="mt-2 space-y-2">
              {(
                [
                  ['DD MMM YYYY', '06 Jun 2026', true],
                  ['DD/MM/YYYY', '06/06/2026', false],
                  ['MMM DD, YYYY', 'Jun 06, 2026', false],
                  ['YYYY-MM-DD', '2026-06-06', false],
                ] as const
              ).map(([value, example, isDefault]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="dateFormat"
                    checked={dashboardDateFormat === value}
                    onChange={() => setDashboardDateFormat(value)}
                  />
                  <span>
                    {value} → {example}
                    {isDefault && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (DEFAULT — Indian)
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Preview: {todayPreview}</p>
          </div>

          <div>
            <p className="text-sm font-medium">Currency Display</p>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="currencyFormat"
                  checked={dashboardCurrencyFormat === 'indian'}
                  onChange={() => setDashboardCurrencyFormat('indian')}
                />
                Indian (₹1,00,000) — DEFAULT
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="currencyFormat"
                  checked={dashboardCurrencyFormat === 'international'}
                  onChange={() => setDashboardCurrencyFormat('international')}
                />
                International (₹100,000)
              </label>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Preview: {currencyPreview}</p>
          </div>

          <Button
            type="button"
            onClick={() =>
              void saveSettings(
                {
                  display: {
                    timezone: dashboardTimezone,
                    dateFormat: dashboardDateFormat,
                    currencyFormat: dashboardCurrencyFormat,
                  },
                },
                'Display settings saved',
              )
            }
          >
            Save Display Settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">App Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-start justify-between gap-4 border-b border-border pb-3">
            <div>
              <p className="font-medium text-sm">App Maintenance Mode</p>
              <p className="text-xs text-muted-foreground">Show maintenance screen to users</p>
              {maintenance && (
                <p className="mt-1 text-xs text-red-600">
                  App is in maintenance mode — users cannot access
                </p>
              )}
            </div>
            <input
              type="checkbox"
              checked={maintenance}
              onChange={(e) => setMaintenance(e.target.checked)}
            />
          </div>
          {toggleRow('registration', 'New User Registration', 'Allow new users to register')}
          {toggleRow('showPrices', 'Show Property Prices', 'Show prices on listing cards')}
          {toggleRow('virtualTours', 'Enable Virtual Tours', 'Show AR/VR tour option')}
          {toggleRow('stagePayment', 'Stage Payment Feature', 'Enable stage payment option')}
          {toggleRow('interior', 'Interior Design Feature', 'Enable interior design requests')}
          <Button
            type="button"
            className="mt-4"
            onClick={() => void saveSettings({ app: { maintenance, ...appToggles } }, 'App configuration saved')}
          >
            Save App Configuration
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SLA Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Interior</p>
              <p className="text-sm font-semibold">Interior: {appliedInteriorHours}hrs</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Stage Payment</p>
              <p className="text-sm font-semibold">Stage Payment: {appliedStageHours}hrs</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Enquiry Response</p>
              <p className="text-sm font-semibold">Enquiry Response: {appliedEnquiryHours}hrs</p>
            </div>
          </div>
          <SlaFieldRow
            label="Interior Inquiry Response Time"
            value={slaInteriorHours}
            onChange={setSlaInteriorHours}
            min={1}
            max={72}
            unit="hours"
            onSave={() => {
              setPendingSla({
                label: 'Interior Inquiry Response Time',
                old: appliedInteriorHours,
                new: slaInteriorHours,
                onConfirm: () => {
                  void saveSettings({ sla: { interiorHours: slaInteriorHours } }, `SLA updated to ${slaInteriorHours} hours`)
                },
              })
              setShowSlaConfirm(true)
            }}
          />
          <SlaFieldRow
            label="Stage Payment Response Time"
            value={slaStageHours}
            onChange={setSlaStageHours}
            min={1}
            max={24}
            unit="hours"
            onSave={() => {
              setPendingSla({
                label: 'Stage Payment Response Time',
                old: appliedStageHours,
                new: slaStageHours,
                onConfirm: () => {
                  void saveSettings({ sla: { stagePaymentHours: slaStageHours } }, `SLA updated to ${slaStageHours} hours`)
                },
              })
              setShowSlaConfirm(true)
            }}
          />
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 flex items-center gap-2">
              <Bell className="size-4 text-blue-600" />
              <p className="text-sm font-medium">Buyer Enquiry Response SLA</p>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Maximum time to respond to a new buy enquiry
            </p>
            <SlaFieldRow
              label="Response time"
              value={slaEnquiryHours}
              onChange={(n) => setSlaEnquiryHours(Math.min(72, Math.max(1, n)))}
              min={1}
              max={72}
              unit="hours"
              onSave={() => {
                setPendingSla({
                  label: 'Buyer Enquiry Response SLA',
                  old: appliedEnquiryHours,
                  new: slaEnquiryHours,
                  kind: 'enquiry',
                  onConfirm: () => {
                    void saveSettings({ sla: { enquiryHours: slaEnquiryHours } }, `Enquiry SLA updated to ${slaEnquiryHours} hours`)
                  },
                })
                setShowSlaConfirm(true)
              }}
            />
          </div>
          <div className="border-t border-border pt-4">
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">Auto-escalate tickets open &gt; 48hrs</span>
              <input
                type="checkbox"
                checked={slaAutoEscalate}
                onChange={(e) => setSlaAutoEscalate(e.target.checked)}
              />
            </label>
            <label className="mt-2 block text-sm">
              Escalate to
              <select
                value={slaEscalateTo}
                onChange={(e) => setSlaEscalateTo(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-input px-2 text-sm"
              >
                {admins.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() =>
                void saveSettings(
                  { sla: { autoEscalate: slaAutoEscalate, escalateToName: slaEscalateTo } },
                  'Escalation settings saved',
                )
              }
            >
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert Me When:</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(
            [
              ['slaBreached', 'SLA Breach', `→ ${adminContact.email} + WhatsApp ${adminContact.phone}`],
              ['interiorInquiry', 'New interior inquiry', null],
              ['stagePayment', 'New stage payment request', null],
              ['ticket48', 'Support ticket open > 48hrs', null],
            ] as const
          ).map(([key, label, subText]) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={adminAlerts[key]}
                onChange={(e) =>
                  setAdminAlerts((prev) => ({ ...prev, [key]: e.target.checked }))
                }
              />
              <span>
                {label}
                {subText && (
                  <span className="block text-xs text-muted-foreground">{subText}</span>
                )}
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={adminAlerts.dailyEmail}
              onChange={(e) =>
                setAdminAlerts((prev) => ({ ...prev, dailyEmail: e.target.checked }))
              }
            />
            Daily summary (email)
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={adminAlerts.weeklyEmail}
              onChange={(e) =>
                setAdminAlerts((prev) => ({ ...prev, weeklyEmail: e.target.checked }))
              }
            />
            Weekly analytics (email)
          </label>
          <div className="border-t border-border pt-3 space-y-2">
            <label className="block text-sm">
              Admin contact email
              <input
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              />
            </label>
            <label className="block text-sm">
              Admin WhatsApp
              <input
                value={alertWhatsApp}
                onChange={(e) => setAlertWhatsApp(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              />
            </label>
          </div>
          <Button
            type="button"
            onClick={() =>
              void saveSettings(
                { alerts: { triggers: adminAlerts, email: alertEmail, whatsapp: alertWhatsApp } },
                'Alert settings saved',
              )
            }
          >
            Save Alert Settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-semibold">Admin Contact Details</p>
            <p className="mb-4 mt-1 text-xs text-muted-foreground">
              These details receive admin notifications for SLA breaches, new enquiries, and
              system alerts
            </p>
            <label className="mb-3 block text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <Phone className="size-3.5 text-muted-foreground" />
                Admin WhatsApp Number
              </span>
              <input
                value={contactDraft.phone}
                onChange={(e) => setContactDraft((c) => ({ ...c, phone: e.target.value }))}
                placeholder={COMPANY_SUPPORT_PHONE_DISPLAY}
                className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Receives WhatsApp alerts for SLA breaches and new leads
              </span>
            </label>
            <label className="mb-3 block text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <Mail className="size-3.5 text-muted-foreground" />
                Admin Email Address
              </span>
              <input
                type="email"
                value={contactDraft.email}
                onChange={(e) => setContactDraft((c) => ({ ...c, email: e.target.value }))}
                placeholder="admin@builtglory.com"
                className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Receives email reports and SLA breach notifications
              </span>
            </label>
            <label className="mb-4 block text-sm">
              <span className="font-medium">CC Email (optional)</span>
              <input
                type="email"
                value={contactDraft.ccEmail}
                onChange={(e) => setContactDraft((c) => ({ ...c, ccEmail: e.target.value }))}
                placeholder="manager@builtglory.com"
                className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Additional email for reports
              </span>
            </label>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void saveSettings({ notifications: { contact: contactDraft } }, 'Contact details saved')
              }}
            >
              Save Contact Details
            </Button>
          </div>

          <p className="text-sm font-medium">Email notifications</p>
          {(
            [
              [
                'enquiry',
                'New Enquiry',
                `→ ${adminContact.email} + WhatsApp ${adminContact.phone}`,
              ],
              ['sell', 'New Listing', `→ ${adminContact.email}`],
              ['user', 'New user registered', null],
              ['stageProof', 'Stage payment proof uploaded', null],
              ['ticket', 'Support ticket created', null],
              ['daily', 'Daily summary report', null],
              ['weekly', 'Weekly analytics report', null],
            ] as const
          ).map(([key, label, subText]) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={emailNotifs[key]}
                onChange={(e) =>
                  setEmailNotifs((prev) => ({ ...prev, [key]: e.target.checked }))
                }
              />
              <span>
                {label}
                {subText && (
                  <span className="block text-xs text-muted-foreground">{subText}</span>
                )}
              </span>
            </label>
          ))}

          <p className="pt-2 text-sm font-medium">WhatsApp notifications</p>
          {(
            [
              [
                'enquiry',
                'New Enquiry',
                `→ WhatsApp ${adminContact.phone}`,
              ],
              [
                'slaBreached',
                'SLA Breach',
                `→ WhatsApp ${adminContact.phone}`,
              ],
            ] as const
          ).map(([key, label, subText]) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={key === 'enquiry' ? emailNotifs.enquiry : adminAlerts.slaBreached}
                onChange={(e) => {
                  if (key === 'enquiry') {
                    setEmailNotifs((prev) => ({ ...prev, enquiry: e.target.checked }))
                  } else {
                    setAdminAlerts((prev) => ({ ...prev, slaBreached: e.target.checked }))
                  }
                }}
              />
              <span>
                {label}
                <span className="block text-xs text-muted-foreground">{subText}</span>
              </span>
            </label>
          ))}
          <Button
            type="button"
            className="mt-2"
            variant="outline"
            onClick={() =>
              void saveSettings(
                {
                  notifications: {
                    email: emailNotifs,
                    whatsapp: { enquiry: emailNotifs.enquiry, slaBreached: adminAlerts.slaBreached },
                  },
                },
                'Notification preferences saved',
              )
            }
          >
            Save Preferences
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settings Data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={onReloadSettings}
          >
            Reload Saved Settings
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={exportSettingsSnapshot}
          >
            Export Settings JSON
          </Button>
        </CardContent>
      </Card>

      {pendingTimezone && (
        <Modal
          title={`Change timezone to ${pendingTimezone}?`}
          onClose={() => {
            setPendingTimezone(null)
          }}
        >
          <p className="text-sm text-muted-foreground">
            All timestamps will display in {timezoneLabels[pendingTimezone] ?? pendingTimezone}{' '}
            time.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              onClick={() => {
                setDashboardTimezone(pendingTimezone)
                setPendingTimezone(null)
                void saveSettings({ display: { timezone: pendingTimezone } }, `Timezone changed to ${pendingTimezone}`)
              }}
            >
              Confirm
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingTimezone(null)}
            >
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {showSlaConfirm && pendingSla && (
        <Modal
          title={
            pendingSla.kind === 'enquiry'
              ? `Update Enquiry SLA from ${pendingSla.old}hrs to ${pendingSla.new}hrs?`
              : 'Update SLA Settings?'
          }
          onClose={() => setShowSlaConfirm(false)}
        >
          <p className="text-sm text-muted-foreground">
            {pendingSla.kind === 'enquiry'
              ? 'This affects all active enquiry timers'
              : `Changing from ${pendingSla.old}hrs to ${pendingSla.new}hrs will affect all active timers and ongoing cases.`}
          </p>
          {pendingSla.kind !== 'enquiry' && (
            <p className="mt-2 text-sm font-medium">{pendingSla.label}</p>
          )}
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              onClick={() => {
                pendingSla.onConfirm()
                setShowSlaConfirm(false)
                setPendingSla(null)
              }}
            >
              Confirm Update
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowSlaConfirm(false)
                setPendingSla(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

const legalContentId = (item: AdminContentItem) => String(item._id ?? item.id ?? item.referenceId ?? item.slug)

const emptyLegalDraft = {
  title: '',
  slug: '',
  excerpt: '',
  body: '',
  category: 'terms',
  status: 'published' as ContentStatus,
}

type LegalContentDraft = typeof emptyLegalDraft

function legalStatusBadge(status: ContentStatus) {
  const variants: Record<ContentStatus, 'blue' | 'pending' | 'default'> = {
    published: 'blue',
    draft: 'pending',
    archived: 'default',
  }
  return <Badge variant={variants[status]}>{status}</Badge>
}

function draftFromLegalItem(item: AdminContentItem): LegalContentDraft {
  return {
    title: item.title,
    slug: item.slug,
    excerpt: item.excerpt ?? '',
    body: item.body ?? '',
    category: item.category ?? 'terms',
    status: item.status,
  }
}

function LegalContentTabContent({
  legalContent,
  setContentItems,
  showToast,
}: {
  legalContent: AdminContentItem[]
  setContentItems: React.Dispatch<React.SetStateAction<AdminContentItem[]>>
  showToast: (msg: string) => void
}) {
  const [draft, setDraft] = useState<LegalContentDraft>(emptyLegalDraft)
  const [editingItem, setEditingItem] = useState<AdminContentItem | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const openCreate = (template: 'terms' | 'privacy' | 'custom') => {
    const templateDrafts: Record<typeof template, LegalContentDraft> = {
      terms: {
        ...emptyLegalDraft,
        title: 'Terms of Use',
        slug: 'terms-of-service',
        excerpt: 'Rules and conditions for using Builtglory.',
        category: 'terms',
      },
      privacy: {
        ...emptyLegalDraft,
        title: 'Privacy Policy',
        slug: 'privacy-policy',
        excerpt: 'How Builtglory uses and protects user data.',
        category: 'privacy',
      },
      custom: emptyLegalDraft,
    }
    const draft = templateDrafts[template]
    const existingItem = draft.slug ? legalContent.find((item) => item.slug === draft.slug) ?? null : null
    setEditingItem(existingItem)
    setDraft(existingItem ? draftFromLegalItem(existingItem) : draft)
    setEditorOpen(true)
  }

  const openEdit = (item: AdminContentItem) => {
    setEditingItem(item)
    setDraft(draftFromLegalItem(item))
    setEditorOpen(true)
  }

  const closeEditor = () => {
    setEditingItem(null)
    setDraft(emptyLegalDraft)
    setEditorOpen(false)
  }

  const saveLegalContent = async () => {
    if (!draft.title.trim() || !draft.body.trim()) {
      showToast('Title and content are required.')
      return
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      return
    }

    const payload: AdminContentPayload = {
      slug: draft.slug.trim() || undefined,
      section: 'legal',
      title: draft.title.trim(),
      excerpt: draft.excerpt.trim() || null,
      body: draft.body.trim(),
      category: draft.category.trim() || null,
      status: draft.status,
      metadata: { lastUpdatedLabel: new Date().toLocaleDateString('en-IN') },
    }

    setSaving(true)
    try {
      const saved = editingItem
        ? await updateAdminContent(session.accessToken, legalContentId(editingItem), payload)
        : await createAdminContent(session.accessToken, payload)
      setContentItems((prev) =>
        editingItem
          ? prev.map((item) => (legalContentId(item) === legalContentId(editingItem) ? saved : item))
          : [saved, ...prev],
      )
      showToast(editingItem ? 'Legal content updated.' : 'Legal content created.')
      closeEditor()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save legal content.')
    } finally {
      setSaving(false)
    }
  }

  const removeLegalContent = async (item: AdminContentItem) => {
    if (!window.confirm(`Delete "${item.title}" from legal content?`)) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      return
    }
    const id = legalContentId(item)
    setDeletingId(id)
    try {
      await deleteAdminContent(session.accessToken, id)
      setContentItems((prev) => prev.filter((entry) => legalContentId(entry) !== id))
      showToast('Legal content deleted.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete legal content.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Terms & Privacy Content</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage legal copy shown in the app for Terms of Use, Privacy Policy, and related screens.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => openCreate('terms')}>
            New Terms
          </Button>
          <Button type="button" variant="outline" onClick={() => openCreate('privacy')}>
            New Privacy Policy
          </Button>
          <Button type="button" onClick={() => openCreate('custom')}>
            Add Legal Page
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden rounded-2xl border-border/80 shadow-sm">
        <CardContent className="overflow-x-auto p-0">
          {legalContent.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <ScrollText className="size-16 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No legal content has been created yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Start with Terms of Use or Privacy Policy.</p>
            </div>
          ) : (
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3">Content</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {legalContent.map((item) => (
                  <tr key={legalContentId(item)} className="border-b border-border transition-colors hover:bg-muted/40">
                    <td className="max-w-md px-4 py-3">
                      <p className="font-medium">{item.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {item.excerpt || item.body || 'No summary provided'}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.slug}</td>
                    <td className="px-4 py-3">{item.category ?? 'legal'}</td>
                    <td className="px-4 py-3">{legalStatusBadge(item.status)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatTimeAgo(item.updatedAt ?? item.createdAt ?? '')}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={() => openEdit(item)}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={deletingId === legalContentId(item)}
                          onClick={() => void removeLegalContent(item)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {editorOpen && (
        <Modal title={editingItem ? 'Edit Legal Content' : 'Create Legal Content'} onClose={closeEditor}>
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="font-medium">Title</span>
              <input
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                className="mt-1 h-10 w-full rounded-md border border-border bg-input px-3 text-sm"
                placeholder="Terms of Use"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Slug</span>
              <input
                value={draft.slug}
                onChange={(e) => setDraft((prev) => ({ ...prev, slug: e.target.value }))}
                className="mt-1 h-10 w-full rounded-md border border-border bg-input px-3 text-sm"
                placeholder="terms-of-service"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium">Category</span>
                <select
                  value={draft.category}
                  onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-md border border-border bg-input px-3 text-sm"
                >
                  <option value="terms">Terms</option>
                  <option value="privacy">Privacy</option>
                  <option value="legal">Legal</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium">Status</span>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value as ContentStatus }))}
                  className="mt-1 h-10 w-full rounded-md border border-border bg-input px-3 text-sm"
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="font-medium">Summary</span>
              <input
                value={draft.excerpt}
                onChange={(e) => setDraft((prev) => ({ ...prev, excerpt: e.target.value }))}
                className="mt-1 h-10 w-full rounded-md border border-border bg-input px-3 text-sm"
                placeholder="Short description shown in dashboards"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Content</span>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft((prev) => ({ ...prev, body: e.target.value }))}
                className="mt-1 min-h-56 w-full rounded-md border border-border bg-input px-3 py-2 text-sm leading-6"
                placeholder="Write the legal copy users will see..."
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeEditor}>
                Cancel
              </Button>
              <Button type="button" disabled={saving} onClick={() => void saveLegalContent()}>
                {saving ? 'Saving...' : 'Save Content'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function AuditTabContent({
  filteredAudit,
  auditDate,
  setAuditDate,
  auditAdmin,
  setAuditAdmin,
  auditAction,
  setAuditAction,
  expandedAuditId,
  setExpandedAuditId,
  showToast,
}: {
  filteredAudit: AuditEntry[]
  auditDate: string
  setAuditDate: React.Dispatch<React.SetStateAction<string>>
  auditAdmin: string
  setAuditAdmin: React.Dispatch<React.SetStateAction<string>>
  auditAction: string
  setAuditAction: React.Dispatch<React.SetStateAction<string>>
  expandedAuditId: string | null
  setExpandedAuditId: React.Dispatch<React.SetStateAction<string | null>>
  showToast: (msg: string) => void
}) {
  const admins = ['System Admin', 'Priya Admin', 'Vikram Ops', 'System']

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-2xl font-bold">Audit Trail</h1>
        <div className="flex flex-wrap gap-2">
          <select
            value={auditDate}
            onChange={(e) => setAuditDate(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-2 text-sm"
          >
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="custom">Custom</option>
          </select>
          <select
            value={auditAdmin}
            onChange={(e) => setAuditAdmin(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-2 text-sm"
          >
            <option value="all">All Admins</option>
            {admins.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={auditAction}
            onChange={(e) => setAuditAction(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-2 text-sm"
          >
            <option value="all">All Actions</option>
            {['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'EXPORT'].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" onClick={() => showToast('Downloading audit log...')}>
            Export Audit Log
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {filteredAudit.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <ScrollText className="size-16 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No audit entries for this period</p>
            </div>
          ) : (
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">Section</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">Date/Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((a) => (
                  <Fragment key={a.id}>
                    <tr
                      className="cursor-pointer border-b border-border hover:bg-muted/30"
                      onClick={() =>
                        setExpandedAuditId((id) => (id === a.id ? null : a.id))
                      }
                    >
                      <td className="px-4 py-3">
                        {auditActionBadge(a.actionType)}
                        <p className="mt-1">{a.description}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                            {getInitials(a.admin)}
                          </div>
                          {a.admin}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {a.section}
                        {a.recordId && (
                          <p className="font-mono text-xs text-muted-foreground">{a.recordId}</p>
                        )}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">
                        {a.details}
                      </td>
                      <td className="px-4 py-3">
                        <p>{formatDateTime(a.at)}</p>
                        <p className="text-xs text-muted-foreground">{a.ip}</p>
                      </td>
                    </tr>
                    {expandedAuditId === a.id && (
                      <tr className="bg-muted/10">
                        <td colSpan={5} className="px-4 py-4 text-sm">
                          <p>{a.details}</p>
                          {a.before && (
                            <p className="mt-2">
                              <strong>Before:</strong> {a.before}
                            </p>
                          )}
                          {a.after && (
                            <p>
                              <strong>After:</strong> {a.after}
                            </p>
                          )}
                          <p className="mt-2 text-xs text-muted-foreground">
                            {a.device} · {a.ip}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
