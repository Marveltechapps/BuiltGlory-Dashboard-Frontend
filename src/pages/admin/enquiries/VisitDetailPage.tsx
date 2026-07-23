import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Link2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Video,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  findVisitConflicts,
  getAdminSalesTeam,
  getAdminVisit,
  getVisitMeetingLink,
  isVisitPast,
  isVisitToday,
  listAdminVisits,
  updateAdminVisitStatus,
  VIRTUAL_PLATFORM_LABELS,
  canCancelVisit,
  canRescheduleVisit,
  formatVisitApiError,
  formatVisitTransitionError,
  type BuyerInterest,
  type NextAction,
  type Visit,
  type VisitActivity,
  type VisitCallLog,
  type VisitNote,
  type VisitStatus,
  type VirtualPlatform,
  type SalesPerson,
} from '@/api/adminEnquiries'
import { formatAdminApiError, readAdminSession } from '@/api/admin'
import { getDashboardOptions, type DashboardOptions } from '@/api/adminAppConfig'
import { sendWorkflowEmail } from '@/api/adminWorkflow'
import {
  CallRecordingCard,
  NriAssistanceCard,
  ShareDocumentsModal,
  VirtualVisitHeaderBadges,
} from '@/pages/admin/enquiries/VirtualVisitSections'
import { SentMessagesCard } from '@/components/admin/SentMessagesCard'
import NotificationPreview from '@/components/NotificationPreview'
import { bindToast, copyText, handleCall } from '@/utils/adminActions'
import { cn } from '@/lib/utils'
import {
  DEFAULT_SENT_BY,
  loadMessages,
  logMessage,
  messageToActivityText,
  openWhatsApp,
  type SentMessage,
} from '@/utils/messageLog'
import { NOTIFICATION_TEMPLATES, sendPushNotification } from '@/utils/notifications'

function isVisitTomorrow(visitDate: string): boolean {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return visitDate === tomorrow.toISOString().split('T')[0]
}

function isVisitTodayOrTomorrow(visitDate: string): boolean {
  const today = new Date().toISOString().split('T')[0]
  return visitDate === today || isVisitTomorrow(visitDate)
}

function hasReminderSentToday(messages: SentMessage[]): boolean {
  const today = new Date().toISOString().split('T')[0]
  return messages.some(
    (message) =>
      message.channel === 'push' &&
      message.sentAt.slice(0, 10) === today &&
      /visit reminder/i.test(`${message.relatedTo.title} ${message.message}`),
  )
}

const DEFAULT_RESCHEDULE_REASONS = [
  'Buyer request',
  'Admin schedule conflict',
  'Property not ready',
  'Other',
]

const DEFAULT_CANCEL_REASONS = ['Buyer cancelled', 'Admin cancelled', 'Property sold', 'Other']

const DEFAULT_CHECKLIST_ITEMS = [
  'Called buyer to confirm',
  'Sent visit confirmation WhatsApp',
  'Property keys/access arranged',
  'Property cleaned and ready',
  'Seller informed (if applicable)',
  'Directions sent to buyer',
]

const STATUS_LABELS: Record<VisitStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  missed: 'Missed',
  rescheduled: 'Rescheduled',
}

const INTEREST_OPTIONS: { key: BuyerInterest; label: string; emoji: string; className: string }[] = [
  { key: 'very_interested', label: 'Very Interested', emoji: '🔥', className: 'border-green-500 bg-green-50 text-green-800' },
  { key: 'interested', label: 'Interested', emoji: '👍', className: 'border-blue-500 bg-blue-50 text-blue-800' },
  { key: 'needs_time', label: 'Needs Time', emoji: '🤔', className: 'border-orange-500 bg-orange-50 text-orange-800' },
  { key: 'not_interested', label: 'Not Interested', emoji: '👎', className: 'border-red-500 bg-red-50 text-red-800' },
]

const QUICK_LINK_PREFIXES = [
  { label: '+ Zoom', prefix: 'https://zoom.us/j/' },
  { label: '+ Google Meet', prefix: 'https://meet.google.com/' },
  { label: '+ Teams', prefix: 'https://teams.microsoft.com/' },
  { label: '+ WhatsApp', prefix: 'https://wa.me/' },
] as const

const PLATFORM_BADGE: Record<NonNullable<VirtualPlatform>, string> = {
  zoom: 'bg-blue-100 text-blue-800',
  google_meet: 'bg-green-100 text-green-800',
  teams: 'bg-indigo-100 text-indigo-800',
  whatsapp_video: 'bg-emerald-100 text-emerald-800',
}

function truncateUrl(url: string, max = 40) {
  return url.length > max ? `${url.slice(0, max)}…` : url
}

function isValidMeetingUrl(url: string) {
  return /^https?:\/\//i.test(url.trim())
}

function buyerWhatsAppLink(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits}`
}

function getEffectiveMeetingLink(
  visit: Visit,
  linkSaved: boolean,
  useWhatsAppVideo: boolean,
  meetingLink: string,
): string | null {
  if (!linkSaved) return null
  if (useWhatsAppVideo || visit.virtualPlatform === 'whatsapp_video') {
    return buyerWhatsAppLink(visit.buyerPhone)
  }
  const trimmed = meetingLink.trim()
  return trimmed || getVisitMeetingLink(visit)
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

function formatFullDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  return `${Math.floor(hours / 24)} days ago`
}

function StatusBadge({ status, large }: { status: VisitStatus; large?: boolean }) {
  const config: Record<VisitStatus, { variant?: 'new' | 'responded' | 'default' | 'red' | 'pending'; className?: string }> = {
    scheduled: { variant: 'new' },
    confirmed: { variant: 'responded' },
    completed: { className: 'bg-muted text-muted-foreground' },
    cancelled: { variant: 'red' },
    missed: { variant: 'pending' },
    rescheduled: { className: 'bg-purple-100 text-purple-700' },
  }
  const { variant, className } = config[status]
  return (
    <Badge variant={variant} className={cn(large && 'px-3 py-1 text-sm', className)}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <button type="button" className="fixed inset-0 z-50 bg-black/50" aria-label="Close" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl">
        {children}
      </div>
    </>
  )
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[900px] animate-pulse space-y-6 px-4 py-6">
      <div className="h-4 w-64 rounded bg-muted" />
      <div className="h-10 w-1/2 rounded bg-muted" />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <div className="h-48 rounded-xl bg-muted" />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <div className="h-48 rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  )
}

export function VisitDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [visit, setVisit] = useState<Visit | null>(null)
  const [allVisits, setAllVisits] = useState<Visit[]>([])
  const [status, setStatus] = useState<VisitStatus>('scheduled')
  const [meetingLink, setMeetingLink] = useState('')
  const [editingLink, setEditingLink] = useState(false)
  const [linkSaved, setLinkSaved] = useState(false)
  const [useWhatsAppVideo, setUseWhatsAppVideo] = useState(false)
  const [showRemoveLinkDialog, setShowRemoveLinkDialog] = useState(false)
  const [showNotifyUpdatedLink, setShowNotifyUpdatedLink] = useState(false)
  const [nriChecklistState, setNriChecklistState] = useState<Record<string, boolean>>({})
  const [nriAssistanceNotes, setNriAssistanceNotes] = useState('')
  const [shareDocsOpen, setShareDocsOpen] = useState(false)
  const [dashboardOptions, setDashboardOptions] = useState<DashboardOptions | null>(null)
  const visitOptionConfig = dashboardOptions?.visits
  const rescheduleReasons = visitOptionConfig?.rescheduleReasons?.length
    ? visitOptionConfig.rescheduleReasons
    : DEFAULT_RESCHEDULE_REASONS
  const cancelReasons = visitOptionConfig?.cancelReasons?.length
    ? visitOptionConfig.cancelReasons
    : DEFAULT_CANCEL_REASONS
  const checklistItems = visitOptionConfig?.physicalChecklist?.length
    ? visitOptionConfig.physicalChecklist
    : DEFAULT_CHECKLIST_ITEMS
  const [checklist, setChecklist] = useState<boolean[]>(DEFAULT_CHECKLIST_ITEMS.map(() => false))
  const [activities, setActivities] = useState<VisitActivity[]>([])
  const [callLogs, setCallLogs] = useState<VisitCallLog[]>([])
  const [notes, setNotes] = useState<VisitNote[]>([])
  const [showCallForm, setShowCallForm] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [showReschedule, setShowReschedule] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [showConfirmVisit, setShowConfirmVisit] = useState(false)
  const [cancelNotes, setCancelNotes] = useState('')
  const [reminderSent, setReminderSent] = useState(false)
  const [showCompletePrompt, setShowCompletePrompt] = useState(false)
  const [showFeedbackForm, setShowFeedbackForm] = useState(false)
  const [showConflictWarning, setShowConflictWarning] = useState<Visit[] | null>(null)
  const [pendingReschedule, setPendingReschedule] = useState<{
    date: string
    time: string
    reason: string
  } | null>(null)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('10:00 AM')
  const [rescheduleReason, setRescheduleReason] = useState(DEFAULT_RESCHEDULE_REASONS[0])
  const [rescheduleNotes, setRescheduleNotes] = useState('')
  const [cancelReason, setCancelReason] = useState(DEFAULT_CANCEL_REASONS[0])
  const [notifyCancel, setNotifyCancel] = useState(true)
  const [interest, setInterest] = useState<BuyerInterest | null>(null)
  const [feedbackNotes, setFeedbackNotes] = useState('')
  const [nextAction, setNextAction] = useState<NextAction>('follow_up')
  const [callDuration, setCallDuration] = useState('')
  const [callOutcome, setCallOutcome] = useState('Interested')
  const [callNotes, setCallNotes] = useState('')
  const [noteText, setNoteText] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const toastApi = useMemo(() => bindToast(setToast), [])
  const [whatsappOpen, setWhatsappOpen] = useState(false)
  const [whatsappBody, setWhatsappBody] = useState('')
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([])
  const [reassignTo, setReassignTo] = useState('')
  const [salesTeam, setSalesTeam] = useState<SalesPerson[]>([])

  const loadVisit = useCallback(async () => {
    const session = readAdminSession()
    if (!id || !session?.accessToken) {
      setLoadError('Your admin session has expired. Please log in again.')
      setVisit(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)
    try {
      const [found, list, team] = await Promise.all([
        getAdminVisit(session.accessToken, id),
        listAdminVisits(session.accessToken),
        getAdminSalesTeam(session.accessToken).catch(() => [] as SalesPerson[]),
      ])
      setVisit(found)
      setAllVisits(list.data)
      setSalesTeam(team.filter((member) => member.isAvailable))
      setReminderSent(Boolean(found.reminderSent))
      setStatus(found.status)
      const existingLink = getVisitMeetingLink(found) ?? ''
      setMeetingLink(existingLink)
      setLinkSaved(!!existingLink || found.virtualPlatform === 'whatsapp_video')
      setEditingLink(false)
      setUseWhatsAppVideo(found.virtualPlatform === 'whatsapp_video')
      setShowNotifyUpdatedLink(false)
      setReassignTo(found.assignedAdmin)
      setNriChecklistState(found.nriChecklist ?? {})
      setNriAssistanceNotes(found.nriAssistanceNotes ?? '')
      setActivities([...found.activities])
      setCallLogs([...found.callLogs])
      setNotes([...found.notes])
      if (found.status === 'completed' && !found.feedback) {
        setShowFeedbackForm(true)
      }
    } catch (error) {
      setLoadError(formatAdminApiError(error, 'Unable to load visit.'))
      setVisit(null)
      setAllVisits([])
      setSalesTeam([])
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadVisit()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadVisit])

  useEffect(() => {
    let cancelled = false
    void getDashboardOptions().then((options) => {
      if (!cancelled) setDashboardOptions(options)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setChecklist((prev) => checklistItems.map((_, index) => prev[index] ?? false))
    if (!rescheduleReasons.includes(rescheduleReason)) {
      setRescheduleReason(rescheduleReasons[0] ?? DEFAULT_RESCHEDULE_REASONS[0])
    }
    if (!cancelReasons.includes(cancelReason)) {
      setCancelReason(cancelReasons[0] ?? DEFAULT_CANCEL_REASONS[0])
    }
  }, [cancelReason, cancelReasons, checklistItems, rescheduleReason, rescheduleReasons])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  const addActivity = useCallback((desc: string, type: VisitActivity['type'] = 'status') => {
    setActivities((prev) => [
      { id: `act-${Date.now()}`, type, description: desc, timestamp: new Date().toISOString() },
      ...prev,
    ])
  }, [])

  const refreshSentMessages = useCallback(() => {
    if (!visit) return
    void loadMessages('visit', visit.id).then((messages) => {
      setSentMessages(messages)
      setReminderSent(Boolean(visit.reminderSent) || hasReminderSentToday(messages))
    })
  }, [visit])

  useEffect(() => {
    refreshSentMessages()
  }, [refreshSentMessages])

  const logVisitMessage = useCallback(
    (msg: Omit<SentMessage, 'id' | 'sentAt' | 'relatedTo' | 'sentBy'>) => {
      if (!visit) return
      logMessage({
        ...msg,
        sentBy: DEFAULT_SENT_BY,
        relatedTo: {
          type: 'visit',
          id: visit.id,
          title: visit.propertyTitle,
        },
      })
      refreshSentMessages()
    },
    [visit, addActivity, refreshSentMessages],
  )

  const activityTimeline = useMemo(() => {
    const fromMessages = sentMessages.map((m) => ({
      id: m.id,
      type: 'note' as VisitActivity['type'],
      description: messageToActivityText(m),
      timestamp: m.sentAt,
    }))
    return [...fromMessages, ...activities].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
  }, [activities, sentMessages])

  const persistVisitUpdate = useCallback(
    async (nextStatus: VisitStatus, extra: Record<string, unknown> = {}) => {
      if (!visit) throw new Error('Visit not loaded')
      const session = readAdminSession()
      if (!session?.accessToken) throw new Error('Your admin session has expired. Please log in again.')
      await updateAdminVisitStatus(session.accessToken, visit.id, {
        status: nextStatus,
        ...extra,
      })
      const fresh = await getAdminVisit(session.accessToken, visit.id)
      setVisit(fresh)
      setStatus(fresh.status)
      setReminderSent(Boolean(fresh.reminderSent))
      setCallLogs([...fresh.callLogs])
      setNotes([...fresh.notes])
      if (fresh.assignedAdmin && fresh.assignedAdmin !== 'Unassigned') {
        setReassignTo(fresh.assignedAdmin)
      }
      const existingLink = getVisitMeetingLink(fresh) ?? ''
      setMeetingLink(existingLink)
      setLinkSaved(!!existingLink || fresh.virtualPlatform === 'whatsapp_video')
      return fresh
    },
    [visit],
  )

  const updateStatus = useCallback(
    (next: VisitStatus, extra?: Partial<Visit>) => {
      setStatus(next)
      setVisit((prev) => (prev ? { ...prev, status: next, ...extra } : prev))
      addActivity(`Status changed to ${STATUS_LABELS[next]}`)
    },
    [addActivity],
  )

  const isFinal = status === 'completed' || status === 'cancelled'
  const canCancel = canCancelVisit(status)
  const canReschedule = canRescheduleVisit(status)
  const showMissedAlert = useMemo(() => {
    if (!visit) return false
    if (status === 'completed' || status === 'cancelled' || status === 'missed') return false
    return isVisitPast(visit)
  }, [visit, status])

  const checklistDone = checklist.filter(Boolean).length

  const toggleChecklist = (index: number) => {
    setChecklist((prev) => {
      const next = [...prev]
      next[index] = !next[index]
      if (next[index]) {
        addActivity(`Checklist: ${checklistItems[index]}`, 'checklist')
      }
      return next
    })
  }

  const handleConfirm = async () => {
    if (!visit) return
    if (status === 'confirmed') {
      setToast('Already confirmed')
      setShowConfirmVisit(false)
      return
    }
    const link = getEffectiveMeetingLink(visit, linkSaved, useWhatsAppVideo, meetingLink)
    if (visit.visitType === 'virtual' && !link) {
      toastApi.error('Add meeting link first')
      return
    }
    try {
      await persistVisitUpdate('confirmed', { meetingLink: link, virtualPlatform: visit.virtualPlatform })
      updateStatus('confirmed')
    } catch (error) {
      toastApi.error(formatAdminApiError(error, 'Could not confirm visit'))
      return
    }
    if (visit.visitType === 'virtual' && link) {
      addActivity('Meeting confirmed - link sent to buyer')
    }
    const template =
      visit.visitType === 'virtual' && link
        ? {
            title: 'Virtual Visit Confirmed! 📅',
            body: `Your virtual visit for ${visit.propertyTitle} is confirmed. Join here: ${link}${
              visit.virtualPlatform
                ? ` Platform: ${visit.virtualPlatform.replace('_', ' ')}`
                : ''
            }`,
            deepLink: 'B-12',
            audience: 'buyer' as const,
          }
        : NOTIFICATION_TEMPLATES.N03_VISIT_CONFIRMED(
            visit.buyerName,
            visit.propertyTitle,
            visit.visitDate,
            visit.visitTime,
          )
    const msg = sendPushNotification(visit.buyerName, template, 'N-03', {
      dedupeKey: `N-03:${visit.id}`,
      audience: 'buyer',
      userId: visit.buyerUserId,
      relatedTo: { type: 'visit', id: visit.id },
    })
    setToast(`Visit confirmed. Buyer notified via N-03. ${msg}`)
    setShowConfirmVisit(false)
  }

  const handleCancelVisit = async () => {
    if (!visit) return
    if (!canCancelVisit(status)) {
      toastApi.error(formatVisitTransitionError(status, 'cancelled'))
      setShowCancel(false)
      return
    }
    const reason =
      cancelReason === 'Other'
        ? cancelNotes.trim()
        : cancelNotes.trim()
          ? `${cancelReason}: ${cancelNotes}`
          : cancelReason
    if (!reason.trim()) {
      setToast('Cancellation reason required')
      return
    }
    if (status === 'confirmed') {
      if (
        !window.confirm(
          'Buyer already confirmed. Sure you want to cancel?',
        )
      ) {
        return
      }
    }
    const template = NOTIFICATION_TEMPLATES.N03_VISIT_CANCELLED(
      visit.buyerName,
      visit.propertyTitle,
      reason,
    )
    if (notifyCancel) {
      sendPushNotification(visit.buyerName, template, 'N-03', {
        dedupeKey: `N-03:cancel:${visit.id}`,
        audience: 'buyer',
        userId: visit.buyerUserId,
        relatedTo: { type: 'visit', id: visit.id },
      })
    }
    try {
      await persistVisitUpdate('cancelled', { reason, cancelReason: reason })
      updateStatus('cancelled', { cancelReason: reason })
    } catch (error) {
      toastApi.error(formatVisitApiError(error, status, 'cancelled', 'Could not cancel visit'))
      return
    }
    setShowCancel(false)
    setToast('Visit cancelled. Buyer notified.')
  }

  const effectiveMeetingLink = visit
    ? getEffectiveMeetingLink(visit, linkSaved, useWhatsAppVideo, meetingLink)
    : null

  const linkSentToBuyer = useMemo(() => {
    if (!visit || !effectiveMeetingLink) return false
    return sentMessages.some(
      (m) =>
        m.channel === 'whatsapp' &&
        (m.message.includes(effectiveMeetingLink) ||
          m.message.toLowerCase().includes('virtual visit link')),
    )
  }, [sentMessages, visit, effectiveMeetingLink])

  const persistMeetingLink = (url: string) => {
    if (!visit) return
    setVisit((prev) =>
      prev
        ? {
            ...prev,
            virtualMeetingLink: url,
            virtualLink: url,
          }
        : prev,
    )
  }

  const handleSaveMeetingLink = async () => {
    if (!visit) return
    if (!meetingLink.trim()) {
      toastApi.error('Please enter a link')
      return
    }
    if (!isValidMeetingUrl(meetingLink)) {
      toastApi.error('Please enter a valid URL starting with https://')
      return
    }
    try {
      await persistVisitUpdate(status, { meetingLink: meetingLink.trim(), virtualPlatform: visit.virtualPlatform })
      persistMeetingLink(meetingLink.trim())
    } catch (error) {
      toastApi.error(formatAdminApiError(error, 'Could not save meeting link'))
      return
    }
    setLinkSaved(true)
    setEditingLink(false)
    addActivity('Virtual meeting link added')
    toastApi.success('Meeting link saved!')
  }

  const handleUpdateMeetingLink = async () => {
    if (!visit) return
    if (!meetingLink.trim()) {
      toastApi.error('Please enter a link')
      return
    }
    if (!isValidMeetingUrl(meetingLink)) {
      toastApi.error('Please enter a valid URL starting with https://')
      return
    }
    try {
      await persistVisitUpdate(status, { meetingLink: meetingLink.trim(), virtualPlatform: visit.virtualPlatform })
      persistMeetingLink(meetingLink.trim())
    } catch (error) {
      toastApi.error(formatAdminApiError(error, 'Could not update meeting link'))
      return
    }
    setLinkSaved(true)
    setEditingLink(false)
    addActivity('Virtual meeting link updated')
    toastApi.success('Link updated!')
    if (visit && status === 'confirmed') {
      setShowNotifyUpdatedLink(true)
    }
  }

  const handleRemoveMeetingLink = async () => {
    if (!visit) return
    try {
      await persistVisitUpdate(status, { meetingLink: null, virtualPlatform: null })
    } catch (error) {
      toastApi.error(formatAdminApiError(error, 'Could not remove meeting link'))
      return
    }
    setMeetingLink('')
    setLinkSaved(false)
    setEditingLink(false)
    setUseWhatsAppVideo(false)
    setShowRemoveLinkDialog(false)
    setVisit((prev) =>
      prev ? { ...prev, virtualMeetingLink: null, virtualLink: null } : prev,
    )
    addActivity('Virtual meeting link removed')
    toastApi.success('Meeting link removed')
  }

  const handleNotifyUpdatedLink = () => {
    if (!visit || !effectiveMeetingLink) return
    const msg = `Hi ${visit.buyerName}, the meeting link for your visit has been updated. New link: ${effectiveMeetingLink}`
    logVisitMessage({
      channel: 'whatsapp',
      to: visit.buyerPhone,
      toName: visit.buyerName,
      message: msg,
    })
    openWhatsApp(visit.buyerPhone, msg)
    setShowNotifyUpdatedLink(false)
    addActivity('Updated meeting link sent to buyer via WhatsApp')
    toastApi.success('WhatsApp opened with updated link')
  }

  const handleSendLinkToBuyer = () => {
    if (!visit || !effectiveMeetingLink) return
    const platformLabel = visit.virtualPlatform
      ? VIRTUAL_PLATFORM_LABELS[visit.virtualPlatform]
      : useWhatsAppVideo
        ? 'WhatsApp Video'
        : 'Virtual'
    const msg = `Hi ${visit.buyerName}, here is your virtual visit link for ${visit.propertyTitle}: ${effectiveMeetingLink}\nDate: ${visit.visitDate} at ${visit.visitTime}\nPlatform: ${platformLabel}`
    logVisitMessage({
      channel: 'whatsapp',
      to: visit.buyerPhone,
      toName: visit.buyerName,
      message: msg,
    })
    openWhatsApp(visit.buyerPhone, msg)
    addActivity('Virtual visit link sent to buyer via WhatsApp')
    toastApi.success('WhatsApp opened with visit link')
  }

  const handleSendCancellationAfterRemove = () => {
    if (!visit) return
    const msg = `Hi ${visit.buyerName}, the meeting link for your virtual visit (${visit.propertyTitle}) is no longer valid. We will share an updated link shortly.`
    logVisitMessage({
      channel: 'whatsapp',
      to: visit.buyerPhone,
      toName: visit.buyerName,
      message: msg,
    })
    openWhatsApp(visit.buyerPhone, msg)
    setShowRemoveLinkDialog(false)
    addActivity('Link cancellation notice sent to buyer')
    toastApi.success('Cancellation message sent via WhatsApp')
  }

  const handleSaveCallRecord = async (data: {
    callDuration: number
    virtualRecordingUrl: string | null
    callNotes: string
    documentsShared: string[]
    followUpAction: string | null
    followUpDate: string | null
  }) => {
    if (!visit) return
    const now = new Date().toISOString()
    try {
      await persistVisitUpdate('completed', {
        ...data,
        completedAt: now,
        feedback: visit.feedback ?? {
          buyerInterest: 'interested',
          notes: data.callNotes || 'Virtual visit call completed',
          nextAction: data.followUpAction === 'move_to_negotiation' ? 'move_to_negotiation' : 'follow_up',
        },
        callLog: {
          duration: data.callDuration,
          outcome: data.followUpAction || 'Completed',
          notes: data.callNotes,
          calledAt: now,
        },
      })
    } catch (error) {
      toastApi.error(formatAdminApiError(error, 'Could not record call'))
      return
    }
    setVisit((prev) =>
      prev
        ? {
            ...prev,
            ...data,
            status: 'completed',
            completedAt: now,
          }
        : prev,
    )
    updateStatus('completed', { ...data, completedAt: now })
    addActivity(`Call completed - ${data.callDuration} minutes`, 'status')
    addActivity(
      `Call notes recorded by ${visit.assignedAdmin}${
        data.documentsShared.length
          ? ` — Documents shared: ${data.documentsShared.join(', ')}`
          : ''
      }`,
      'note',
    )
    toastApi.success('Call recorded successfully')
  }

  const handleSendReminder = async () => {
    if (!visit) return
    const link = effectiveMeetingLink
    const template =
      visit.visitType === 'virtual' && link
        ? {
            title: 'Virtual Visit Reminder 🔔',
            body: `Reminder: Your virtual visit tomorrow at ${visit.visitTime}. Join: ${link}`,
            deepLink: 'B-12',
            audience: 'buyer' as const,
          }
        : NOTIFICATION_TEMPLATES.N03_VISIT_REMINDER(
            visit.buyerName,
            visit.propertyTitle,
            visit.visitTime,
          )
    sendPushNotification(visit.buyerName, template, 'N-03', {
      dedupeKey: `N-03:reminder:${visit.id}:${new Date().toISOString().split('T')[0]}`,
      audience: 'buyer',
      userId: visit.buyerUserId,
      relatedTo: { type: 'visit', id: visit.id },
    })
    try {
      await persistVisitUpdate(status, { reminderSent: true })
      setReminderSent(true)
    } catch (error) {
      toastApi.error(formatAdminApiError(error, 'Could not save reminder status'))
      return
    }
    setToast('Visit reminder sent (N-03)')
  }

  const applyReschedule = async (
    data: { date: string; time: string; reason: string },
    force = false,
  ) => {
    if (!visit) return
    const conflicts = findVisitConflicts(allVisits, visit.propertyId, data.date, data.time, visit.id)
    if (!force && conflicts.length > 0) {
      setPendingReschedule(data)
      setShowConflictWarning(conflicts)
      return
    }
    const entry = {
      previousDate: visit.visitDate,
      previousTime: visit.visitTime,
      newDate: data.date,
      newTime: data.time,
      reason: data.reason,
      at: new Date().toISOString(),
    }
    try {
      await persistVisitUpdate('rescheduled', {
        visitDate: data.date,
        visitTime: data.time,
        reason: data.reason,
      })
    } catch (error) {
      toastApi.error(formatVisitApiError(error, status, 'rescheduled', 'Could not reschedule visit'))
      return
    }
    setVisit((prev) =>
      prev
        ? {
            ...prev,
            visitDate: data.date,
            visitTime: data.time,
            rescheduleCount: prev.rescheduleCount + 1,
            rescheduleHistory: [...prev.rescheduleHistory, entry],
          }
        : prev,
    )
    updateStatus('rescheduled')
    addActivity(`Rescheduled to ${data.date} ${data.time}`)
    setShowReschedule(false)
    setShowConflictWarning(null)
    setPendingReschedule(null)
    const rescheduleMsg = `Hi ${visit.buyerName}, your visit for ${visit.propertyTitle} has been rescheduled to ${data.date} at ${data.time}`
    logVisitMessage({
      channel: 'whatsapp',
      to: visit.buyerPhone,
      toName: visit.buyerName,
      message: rescheduleMsg,
    })
    openWhatsApp(visit.buyerPhone, rescheduleMsg)
  }

  const submitReschedule = () => {
    if (!visit || !rescheduleDate) return
    void applyReschedule({ date: rescheduleDate, time: rescheduleTime, reason: rescheduleReason }, false)
  }

  const handleMarkCompleted = async () => {
    if (!visit) return
    if (!visit?.feedback && !showFeedbackForm) {
      setShowCompletePrompt(true)
      setShowFeedbackForm(true)
      return
    }
    if (visit.feedback) {
      try {
        await persistVisitUpdate('completed', { feedback: visit.feedback })
      } catch (error) {
        toastApi.error(formatVisitApiError(error, status, 'completed', 'Could not mark visit completed'))
        return
      }
    }
    updateStatus('completed')
    setShowFeedbackForm(true)
  }

  const saveFeedback = async () => {
    if (!visit || !interest) return
    const feedback = {
      buyerInterest: interest,
      notes: feedbackNotes,
      nextAction,
      completedAt: new Date().toISOString(),
    }
    try {
      await persistVisitUpdate('completed', { feedback })
    } catch (error) {
      toastApi.error(formatAdminApiError(error, 'Could not save feedback'))
      return
    }
    setVisit((prev) => (prev ? { ...prev, feedback } : prev))
    updateStatus('completed', { feedback })
    addActivity('Post-visit feedback submitted', 'feedback')
    setShowFeedbackForm(false)

    if (nextAction === 'move_to_negotiation') navigate('/admin/sales/negotiation')
    else if (nextAction === 'mark_lost') navigate('/admin/sales/lost')
    else if (nextAction === 'schedule_another_visit') setShowReschedule(true)
  }

  if (loading) return <DetailSkeleton />

  if (!visit) {
    return (
      <div className="mx-auto flex max-w-[900px] flex-col items-center px-4 py-24 text-center">
        <AlertCircle className="mb-4 size-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">{loadError ? 'Could not load visit' : 'Visit not found'}</h2>
        {loadError && <p className="mt-2 max-w-md text-sm text-muted-foreground">{loadError}</p>}
        <div className="mt-6 flex gap-2">
          {loadError && <Button onClick={() => void loadVisit()}>Retry</Button>}
          <Button variant="outline" onClick={() => navigate('/admin/enquiries/visits')}>
            Back to Visits
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg bg-foreground px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {showRemoveLinkDialog && visit && (
        <ModalShell onClose={() => setShowRemoveLinkDialog(false)}>
          <h3 className="text-lg font-semibold">Remove meeting link?</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            The buyer will need a new link.
          </p>
          {status === 'confirmed' && (
            <p className="mt-2 text-sm text-amber-800">
              Visit was confirmed with this link. Buyer may have saved it. Consider notifying buyer.
            </p>
          )}
          {linkSentToBuyer && (
            <p className="mt-2 text-sm text-orange-800">
              Buyer may still have the old link. Send cancellation?
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2">
            {linkSentToBuyer && (
              <Button variant="outline" className="w-full" onClick={handleSendCancellationAfterRemove}>
                Send cancellation to buyer
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowRemoveLinkDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => void handleRemoveMeetingLink()}
              >
                Remove
              </Button>
            </div>
          </div>
        </ModalShell>
      )}

      {showConflictWarning && (
        <ModalShell onClose={() => setShowConflictWarning(null)}>
          <h3 className="text-lg font-semibold">Schedule conflict</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Another visit is scheduled for this property at{' '}
            {showConflictWarning[0]?.visitTime} on {showConflictWarning[0]?.visitDate}.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowConflictWarning(null)}>
              Change Time
            </Button>
            <Button
              className="flex-1"
              onClick={() => pendingReschedule && void applyReschedule(pendingReschedule, true)}
            >
              Schedule Anyway
            </Button>
          </div>
        </ModalShell>
      )}

      {showConfirmVisit && visit && (
        <ModalShell onClose={() => setShowConfirmVisit(false)}>
          <h3 className="text-lg font-semibold">Confirm visit</h3>
          {status === 'confirmed' ? (
            <p className="mt-2 text-sm text-green-700">Already confirmed</p>
          ) : (
            <>
              <NotificationPreview
                notificationId="N-03"
                title={NOTIFICATION_TEMPLATES.N03_VISIT_CONFIRMED(
                  visit.buyerName,
                  visit.propertyTitle,
                  visit.visitDate,
                  visit.visitTime,
                ).title}
                body={NOTIFICATION_TEMPLATES.N03_VISIT_CONFIRMED(
                  visit.buyerName,
                  visit.propertyTitle,
                  visit.visitDate,
                  visit.visitTime,
                ).body}
                deepLink="B-12"
              />
              <div className="mt-4 flex gap-2">
                <Button className="flex-1" onClick={() => void handleConfirm()}>
                  Confirm Visit
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setShowConfirmVisit(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </ModalShell>
      )}

      {showCancel && visit && (
        <ModalShell onClose={() => setShowCancel(false)}>
          <h3 className="text-lg font-semibold">Cancel visit</h3>
          {status === 'confirmed' && (
            <p className="mt-2 text-sm text-orange-700">
              Buyer already confirmed. Sure you want to cancel?
            </p>
          )}
          <select
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            className="mt-3 h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
          >
            {cancelReasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <textarea
            value={cancelNotes}
            onChange={(e) => setCancelNotes(e.target.value)}
            placeholder={cancelReason === 'Other' ? 'Reason (required)' : 'Additional details'}
            rows={2}
            className="mt-2 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
          <NotificationPreview
            notificationId="N-03"
            title={NOTIFICATION_TEMPLATES.N03_VISIT_CANCELLED(
              visit.buyerName,
              visit.propertyTitle,
              cancelReason === 'Other'
                ? cancelNotes.trim() || '…'
                : cancelNotes.trim()
                  ? `${cancelReason}: ${cancelNotes}`
                  : cancelReason,
            ).title}
            body={NOTIFICATION_TEMPLATES.N03_VISIT_CANCELLED(
              visit.buyerName,
              visit.propertyTitle,
              cancelReason === 'Other'
                ? cancelNotes.trim() || '…'
                : cancelNotes.trim()
                  ? `${cancelReason}: ${cancelNotes}`
                  : cancelReason,
            ).body}
            deepLink="B-12"
          />
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notifyCancel} onChange={(e) => setNotifyCancel(e.target.checked)} />
            Send push notification to buyer
          </label>
          <Button variant="destructive" className="mt-4 w-full" onClick={() => void handleCancelVisit()}>
            Confirm Cancel
          </Button>
        </ModalShell>
      )}

      {showReschedule && (
        <ModalShell onClose={() => setShowReschedule(false)}>
          <h3 className="text-lg font-semibold">Reschedule visit</h3>
          <input
            type="date"
            value={rescheduleDate}
            onChange={(e) => setRescheduleDate(e.target.value)}
            className="mt-3 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
          />
          <input
            type="text"
            value={rescheduleTime}
            onChange={(e) => setRescheduleTime(e.target.value)}
            placeholder="10:00 AM"
            className="mt-2 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
          />
          <select
            value={rescheduleReason}
            onChange={(e) => setRescheduleReason(e.target.value)}
            className="mt-2 h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
          >
            {rescheduleReasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <textarea
            rows={2}
            value={rescheduleNotes}
            onChange={(e) => setRescheduleNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="mt-2 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
          <Button className="mt-4 w-full" onClick={submitReschedule}>
            Reschedule
          </Button>
        </ModalShell>
      )}

      {showCompletePrompt && (
        <ModalShell onClose={() => setShowCompletePrompt(false)}>
          <p className="text-sm">Add feedback before closing this visit.</p>
          <Button className="mt-4 w-full" onClick={() => setShowCompletePrompt(false)}>
            OK
          </Button>
        </ModalShell>
      )}

      <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Breadcrumb">
        <Button
          variant="ghost"
          size="icon"
          className="mr-1 size-8"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        {[
          { label: 'Enquiries', path: '/admin/enquiries/visits' },
          { label: 'Visits', path: '/admin/enquiries/visits' },
          { label: `${visit.buyerName} — ${visit.propertyTitle}`, path: null },
        ].map((item, index) => (
          <span key={item.label} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="size-4 text-muted-foreground" />}
            {item.path ? (
              <button
                type="button"
                onClick={() => navigate(item.path!)}
                className="text-muted-foreground hover:text-foreground"
              >
                {item.label}
              </button>
            ) : (
              <span className="line-clamp-1 max-w-[240px] font-medium">{item.label}</span>
            )}
          </span>
        ))}
      </nav>

      {isVisitToday(visit) && status !== 'cancelled' && status !== 'completed' && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <span>
            🗓️ This visit is TODAY at {visit.visitTime}
          </span>
          {visit.visitType === 'physical' && visit.googleMapsLink && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(visit.googleMapsLink!, '_blank')}
            >
              <MapPin className="size-4" /> Get Directions
            </Button>
          )}
          {visit.visitType === 'virtual' && effectiveMeetingLink && (
            <Button
              variant="outline"
              size="sm"
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={() => window.open(effectiveMeetingLink, '_blank')}
            >
              <Video className="size-4" /> Join Virtual Call
            </Button>
          )}
        </div>
      )}

      {showMissedAlert && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <AlertTriangle className="size-5 shrink-0" />
          <span className="flex-1">This visit time has passed</span>
          <Button size="sm" onClick={() => void handleMarkCompleted()}>
            Mark as Completed
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void persistVisitUpdate('missed')
                .then(() => {
                  updateStatus('missed')
                  addActivity('Buyer did not show up', 'status')
                })
                .catch((error) => toastApi.error(formatVisitApiError(error, status, 'missed', 'Could not mark missed')))
            }}
          >
            Mark as Missed
          </Button>
        </div>
      )}

      {visit.rescheduleCount >= 3 && (
        <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-800">
          Rescheduled multiple times ({visit.rescheduleCount}x)
        </div>
      )}

      {visit.visitType === 'virtual' &&
        status === 'confirmed' &&
        !effectiveMeetingLink && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            ⚠️ This visit is confirmed but has no meeting link. Add one immediately.
          </div>
        )}

      <header className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {visit.buyerName} — {visit.propertyTitle}
          </h1>
          <p className="text-sm text-muted-foreground">
            {visit.referenceId} · Created {formatFullDate(visit.createdAt)}
          </p>
          {visit.visitType === 'virtual' && <VirtualVisitHeaderBadges visit={visit} />}
          {visit.rescheduleCount > 0 && (
            <span className="mt-2 inline-block rounded-full bg-orange-100 px-3 py-0.5 text-xs font-medium text-orange-800">
              Rescheduled {visit.rescheduleCount} time{visit.rescheduleCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <StatusBadge status={status} large />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => handleCall(visit.buyerPhone)}>
              <Phone className="size-4" /> Call Buyer
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-green-600"
              onClick={() => {
                setWhatsappBody(
                  `Hi ${visit.buyerName}, regarding your visit for ${visit.propertyTitle} on ${visit.visitDate}.`,
                )
                setWhatsappOpen(true)
              }}
            >
              WhatsApp
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!visit.buyerEmail}
              onClick={() => {
                setEmailSubject(`BuiltGlory — Visit: ${visit.propertyTitle}`)
                setEmailBody(
                  `Hi ${visit.buyerName},\n\nRegarding your scheduled visit for ${visit.propertyTitle}.`,
                )
                setEmailOpen(true)
              }}
            >
              <Mail className="size-4" /> Email
            </Button>
            {canReschedule && (
              <Button variant="outline" size="sm" onClick={() => setShowReschedule(true)}>
                Reschedule
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                className="border-destructive text-destructive"
                onClick={() => setShowCancel(true)}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </header>

      <hr className="my-6 border-border" />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Visit Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-xs uppercase text-muted-foreground">Date</p>
                  <p className="font-medium">{visit.visitDate}</p>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-xs uppercase text-muted-foreground">Time</p>
                  <p className="font-medium">
                    {visit.visitTime} – {visit.visitEndTime}
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-xs uppercase text-muted-foreground">Type</p>
                  <p className="font-medium capitalize">{visit.visitType}</p>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-xs uppercase text-muted-foreground">Assigned To</p>
                  <p className="font-medium">{visit.assignedAdmin}</p>
                </div>
              </div>

              {visit.visitType === 'virtual' ? (
                <div className="mt-4 text-sm text-muted-foreground">
                  Virtual visit — meeting details below
                </div>
              ) : visit.visitType === 'physical' ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm">
                    <MapPin className="mr-1 inline size-4" />
                    {visit.propertyLocation}
                  </p>
                  {visit.googleMapsLink && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(visit.googleMapsLink!, '_blank')}
                    >
                      <ExternalLink className="size-4" /> Get Directions
                    </Button>
                  )}
                  {visit.googleMapsLink && (
                    <img
                      src={`https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(visit.propertyLocation)}&zoom=14&size=400x200&markers=color:red|${encodeURIComponent(visit.propertyLocation)}&key=`}
                      alt="Map preview"
                      className="h-32 w-full rounded-lg bg-muted object-cover"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  )}
                </div>
              ) : null}

              {visit.rescheduleHistory.length > 0 && (
                <div className="mt-6 border-t border-border pt-4">
                  <h4 className="font-medium">Reschedule History</h4>
                  <ul className="mt-2 space-y-2 text-sm">
                    <li className="text-muted-foreground">
                      Original: {visit.rescheduleHistory[0].previousDate} {visit.rescheduleHistory[0].previousTime}
                    </li>
                    {visit.rescheduleHistory.map((h, i) => (
                      <li key={i}>
                        Reschedule {i + 1}: {h.newDate} {h.newTime} — {h.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {visit.visitType === 'virtual' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Virtual Meeting Details</CardTitle>
                  <p className="text-xs text-muted-foreground">📱 App screen: B-12, B-13</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Video className="size-4 text-blue-600" />
                    <span className="font-medium">Platform</span>
                    {visit.virtualPlatform ? (
                      <Badge className={PLATFORM_BADGE[visit.virtualPlatform]}>
                        {VIRTUAL_PLATFORM_LABELS[visit.virtualPlatform]}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    )}
                  </div>

                  {visit.virtualPlatform === 'whatsapp_video' && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                      <p className="text-sm font-medium text-emerald-900">
                        WhatsApp Video Call — no link needed
                      </p>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={useWhatsAppVideo}
                          disabled={isFinal}
                          onChange={(e) => {
                            setUseWhatsAppVideo(e.target.checked)
                            if (e.target.checked) {
                              setLinkSaved(true)
                              setEditingLink(false)
                            } else if (!meetingLink.trim()) {
                              setLinkSaved(false)
                            }
                          }}
                        />
                        Use WhatsApp Video
                      </label>
                      {useWhatsAppVideo && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">
                            Buyer phone:{' '}
                            <span className="font-medium text-foreground">{visit.buyerPhone}</span>
                          </p>
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700"
                            onClick={() =>
                              window.open(buyerWhatsAppLink(visit.buyerPhone), '_blank')
                            }
                          >
                            Start WhatsApp Video
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {!useWhatsAppVideo && (
                    <>
                      {!linkSaved || editingLink ? (
                        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="size-4 shrink-0 text-orange-600" />
                            <p className="text-sm font-medium text-orange-700">
                              {editingLink ? 'Edit meeting link' : 'No meeting link added'}
                            </p>
                          </div>
                          {!editingLink && (
                            <p className="text-xs text-orange-600">
                              Add a meeting link before confirming this visit
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <input
                              type="url"
                              value={meetingLink}
                              onChange={(e) => setMeetingLink(e.target.value)}
                              placeholder="Paste Zoom/Meet/Teams link here..."
                              disabled={isFinal}
                              className="flex-1 min-w-[200px] rounded-lg border border-border bg-background px-3 py-2 text-sm"
                            />
                            <Button
                              size="sm"
                              disabled={isFinal}
                              onClick={() => void (editingLink ? handleUpdateMeetingLink() : handleSaveMeetingLink())}
                            >
                              {editingLink ? 'Update Link' : 'Save Link'}
                            </Button>
                          </div>
                          {!editingLink && (
                            <div className="flex flex-wrap gap-2">
                              {QUICK_LINK_PREFIXES.map((q) => (
                                <Button
                                  key={q.label}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  disabled={isFinal}
                                  onClick={() => setMeetingLink(q.prefix)}
                                >
                                  {q.label}
                                </Button>
                              ))}
                            </div>
                          )}
                          {editingLink && (
                            <button
                              type="button"
                              className="text-sm text-primary underline"
                              onClick={() => setEditingLink(false)}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
                          <div className="flex items-start gap-2">
                            <CheckCircle className="size-4 shrink-0 text-green-600" />
                            <p className="text-sm font-medium text-green-700">
                              Meeting Link Added ✅
                            </p>
                          </div>
                          <p className="flex items-center gap-2 text-sm text-primary">
                            <Link2 className="size-4 shrink-0" />
                            {truncateUrl(meetingLink)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                void navigator.clipboard.writeText(meetingLink)
                                toastApi.success('Link copied!')
                              }}
                            >
                              📋 Copy Link
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => window.open(meetingLink, '_blank')}
                            >
                              ▶ Test Link
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={isFinal}
                              onClick={() => setEditingLink(true)}
                            >
                              ✏️ Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs border-destructive text-destructive hover:bg-destructive/10"
                              disabled={isFinal}
                              onClick={() => setShowRemoveLinkDialog(true)}
                            >
                              🗑 Remove
                            </Button>
                          </div>
                          {status === 'confirmed' && (
                            <p className="text-xs text-amber-700">
                              Visit was confirmed with this link. Buyer may have saved it. Consider
                              notifying buyer.
                            </p>
                          )}
                        </div>
                      )}

                      {showNotifyUpdatedLink && status === 'confirmed' && (
                        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                          <p className="text-sm font-medium">Send updated link to buyer?</p>
                          <Button variant="outline" size="sm" onClick={handleNotifyUpdatedLink}>
                            Yes, notify
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
              {(status === 'confirmed' ||
                status === 'scheduled' ||
                status === 'completed') && (
                <CallRecordingCard
                  visit={visit}
                  status={status}
                  isFinal={isFinal}
              onSaveCallRecord={(data) => void handleSaveCallRecord(data)}
                />
              )}
              <NriAssistanceCard
                visit={visit}
                checklist={nriChecklistState}
                onChecklistChange={(key, checked) =>
                  setNriChecklistState((p) => ({ ...p, [key]: checked }))
                }
                notes={nriAssistanceNotes}
                onNotesChange={setNriAssistanceNotes}
                onSaveChecklist={() => {
                  void persistVisitUpdate(status, { nriChecklist: nriChecklistState })
                    .then(() => {
                      setVisit((p) => (p ? { ...p, nriChecklist: nriChecklistState } : p))
                      addActivity('NRI assistance checklist saved', 'checklist')
                      toastApi.success('Checklist saved')
                    })
                    .catch((error) => toastApi.error(formatAdminApiError(error, 'Could not save checklist')))
                }}
                onSaveNotes={() => {
                  const notesValue = nriAssistanceNotes.trim() || null
                  void persistVisitUpdate(status, { nriAssistanceNotes: notesValue })
                    .then(() => {
                      setVisit((p) =>
                        p ? { ...p, nriAssistanceNotes: notesValue } : p,
                      )
                      addActivity('NRI assistance notes saved', 'note')
                      toastApi.success('Notes saved')
                    })
                    .catch((error) => toastApi.error(formatAdminApiError(error, 'Could not save notes')))
                }}
              />
            </>
          )}

          {visit.visitType === 'physical' && (
          <Card>
            <CardHeader>
              <CardTitle>Pre-Visit Checklist</CardTitle>
              <p className="text-xs text-muted-foreground">Complete before visit</p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {checklistItems.map((item, i) => (
                  <li key={item}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checklist[i]}
                        onChange={() => toggleChecklist(i)}
                        disabled={isFinal}
                      />
                      {item}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">
                {checklistDone} of {checklistItems.length} completed
              </p>
            </CardContent>
          </Card>
          )}

          {visit.visitType === 'physical' && (
          <Card>
            <CardHeader>
              <CardTitle>Post-Visit Feedback</CardTitle>
            </CardHeader>
            <CardContent>
              {status !== 'completed' && !showFeedbackForm && (
                <p className="text-sm italic text-muted-foreground">Complete after visit</p>
              )}
              {visit.feedback && status === 'completed' && (
                <div className="space-y-2 text-sm">
                  <p>
                    <strong>Interest:</strong> {visit.feedback.buyerInterest.replace(/_/g, ' ')}
                  </p>
                  <p>{visit.feedback.notes}</p>
                  <p className="text-muted-foreground">
                    Next: {visit.feedback.nextAction.replace(/_/g, ' ')}
                  </p>
                </div>
              )}
              {showFeedbackForm && status !== 'completed' && (
                <div className="space-y-4">
                  <p className="text-sm font-medium">Buyer Interest *</p>
                  <div className="grid grid-cols-2 gap-2">
                    {INTEREST_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setInterest(opt.key)}
                        className={cn(
                          'rounded-lg border-2 p-2 text-left text-sm transition-colors',
                          interest === opt.key ? opt.className : 'border-border',
                        )}
                      >
                        {opt.emoji} {opt.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={4}
                    value={feedbackNotes}
                    onChange={(e) => setFeedbackNotes(e.target.value)}
                    placeholder="How did the visit go? Buyer reactions..."
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                  />
                  <p className="text-sm font-medium">Next Action *</p>
                  <div className="space-y-2 text-sm">
                    {(
                      [
                        ['move_to_negotiation', 'Move to Negotiation'],
                        ['schedule_another_visit', 'Schedule Another Visit'],
                        ['follow_up', 'Follow Up in 3 Days'],
                        ['mark_lost', 'Mark as Lost'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="nextAction"
                          checked={nextAction === key}
                          onChange={() => setNextAction(key)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <Button className="w-full" disabled={!interest} onClick={() => void saveFeedback()}>
                    Save Feedback
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          )}

          <CallLogCard
            logs={callLogs}
            showForm={showCallForm}
            setShowForm={setShowCallForm}
            callDuration={callDuration}
            setCallDuration={setCallDuration}
            callOutcome={callOutcome}
            setCallOutcome={setCallOutcome}
            callNotes={callNotes}
            setCallNotes={setCallNotes}
            onSave={() => {
              const log: VisitCallLog = {
                id: `c-${Date.now()}`,
                duration: parseInt(callDuration, 10) || 0,
                outcome: callOutcome,
                notes: callNotes,
                at: new Date().toISOString(),
              }
              void persistVisitUpdate(status, {
                callLog: {
                  duration: log.duration,
                  outcome: log.outcome,
                  notes: log.notes,
                  calledAt: log.at,
                },
              })
                .then((updated) => {
                  setCallLogs(updated.callLogs)
                  addActivity(`Call logged — ${callOutcome}`, 'call')
                  setShowCallForm(false)
                })
                .catch((error) => toastApi.error(formatAdminApiError(error, 'Could not save call log')))
            }}
          />

          <NotesCard
            notes={notes}
            showForm={showNoteForm}
            setShowForm={setShowNoteForm}
            noteText={noteText}
            setNoteText={setNoteText}
            onSave={() => {
              if (!noteText.trim()) return
              const note: VisitNote = { id: `n-${Date.now()}`, text: noteText.trim(), at: new Date().toISOString() }
              void persistVisitUpdate(status, { note: { text: note.text } })
                .then((updated) => {
                  setNotes(updated.notes)
                  addActivity('Note added', 'note')
                  setNoteText('')
                  setShowNoteForm(false)
                })
                .catch((error) => toastApi.error(formatAdminApiError(error, 'Could not save note')))
            }}
            onDelete={(nid) => {
              const nextNotes = notes.filter((n) => n.id !== nid)
              void persistVisitUpdate(status, {
                visitNotes: nextNotes.map((note) => ({ text: note.text, createdAt: note.at })),
              })
                .then((updated) => setNotes(updated.notes))
                .catch((error) => toastApi.error(formatAdminApiError(error, 'Could not delete note')))
            }}
          />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Buyer Info</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-2xl font-bold text-white">
                {getInitials(visit.buyerName)}
              </div>
              <p className="text-lg font-semibold">{visit.buyerName}</p>
              <Badge variant="default" className="mt-1">
                {visit.buyerUserType}
              </Badge>
              <button
                type="button"
                className="mt-3 block text-sm hover:text-primary"
                onClick={() => void copyText(visit.buyerPhone, toastApi)}
              >
                {visit.buyerPhone}
              </button>
              <p className={cn('text-sm', !visit.buyerEmail && 'italic text-muted-foreground')}>
                {visit.buyerEmail ?? 'Not provided'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {visit.buyerEnquiriesCount} enquiries · {visit.buyerVisitNumber}
                {visit.buyerVisitNumber === 1 ? 'st' : visit.buyerVisitNumber === 2 ? 'nd' : 'th'} visit
              </p>
              <button
                type="button"
                onClick={() => navigate(`/admin/users/${visit.buyerUserId}`)}
                className="mt-4 text-sm font-medium text-primary hover:underline"
              >
                View Buyer Profile →
              </button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Property Info</CardTitle>
            </CardHeader>
            <CardContent>
              <img src={visit.propertyImage} alt="" className="mb-3 h-32 w-full rounded-lg object-cover" />
              <p className="font-semibold">{visit.propertyTitle}</p>
              <p className="text-lg font-bold text-primary">{visit.propertyPrice}</p>
              <Badge variant="default" className="mt-1">
                {visit.propertyType}
              </Badge>
              <p className="mt-1 text-sm text-muted-foreground">{visit.propertyLocation}</p>
              {(visit.propertyBhk || visit.propertyArea) && (
                <p className="mt-2 text-sm">
                  {[visit.propertyBhk, visit.propertyArea, visit.propertyFloor].filter(Boolean).join(' · ')}
                </p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">
                {visit.propertyVisitsTotal} visits total
              </p>
              <button
                type="button"
                onClick={() => navigate(`/admin/properties/${visit.propertyId}`)}
                className="mt-4 text-sm font-medium text-primary hover:underline"
              >
                View Property →
              </button>
            </CardContent>
          </Card>

          <SentMessagesCard messages={sentMessages} />

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 border-l-2 border-border pl-4">
                {activityTimeline.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" />
                    <p className="text-sm">{a.description}</p>
                    <p className="text-xs text-muted-foreground">{formatTimeAgo(a.timestamp)}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {visit.visitType === 'virtual' ? (
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {effectiveMeetingLink ? (
                  <Button
                    className="w-full bg-green-600 hover:bg-green-700"
                    onClick={() => window.open(effectiveMeetingLink, '_blank')}
                  >
                    🎥 Join Meeting
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled
                    title="Add meeting link above to join"
                  >
                    ⚠️ Add Meeting Link First
                  </Button>
                )}
                {effectiveMeetingLink && (
                  <Button variant="outline" className="w-full" onClick={handleSendLinkToBuyer}>
                    📤 Send Link to Buyer
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    document
                      .getElementById('call-recording-section')
                      ?.scrollIntoView({ behavior: 'smooth' })
                  }
                >
                  📋 Record Call Notes
                </Button>
                <Button variant="outline" className="w-full" onClick={() => setShareDocsOpen(true)}>
                  📤 Share Documents
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={reminderSent}
                  onClick={() => void handleSendReminder()}
                >
                  {reminderSent ? '✓ Reminder Sent' : '🔔 Send Reminder'}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {visit && isVisitTodayOrTomorrow(visit.visitDate) && status !== 'cancelled' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={reminderSent}
                    onClick={() => void handleSendReminder()}
                  >
                    {reminderSent ? '✓ Reminder Sent' : '🔔 Send Visit Reminder'}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Visit Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-sm font-medium">↗️ Reassign Visit</p>
                <select
                  value={reassignTo}
                  onChange={(e) => setReassignTo(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-input px-2 text-sm"
                  disabled={isFinal}
                >
                  <option value="">Choose assignee…</option>
                  {salesTeam.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  disabled={isFinal || !reassignTo || reassignTo === visit.assignedAdmin}
                  onClick={async () => {
                    const session = readAdminSession()
                    if (!session?.accessToken) {
                      toastApi.error('Your admin session has expired. Please log in again.')
                      return
                    }
                    const assignee = salesTeam.find((member) => member.id === reassignTo)
                    try {
                      const updated = await updateAdminVisitStatus(session.accessToken, visit.id, {
                        status,
                        assignedAdmin: reassignTo,
                      })
                      setVisit(updated)
                      setStatus(updated.status)
                      addActivity(`Visit reassigned to ${assignee?.name ?? reassignTo}`)
                      const msg = `Hi ${visit.buyerName}, your visit for ${visit.propertyTitle} has been reassigned. ${assignee?.name ?? 'our team'} will contact you.`
                      openWhatsApp(visit.buyerPhone, msg)
                      toastApi.success(`Visit reassigned to ${assignee?.name ?? 'selected assignee'}`)
                    } catch (error) {
                      toastApi.error(formatAdminApiError(error, 'Could not reassign visit'))
                    }
                  }}
                >
                  Confirm Reassign
                </Button>
              </div>
              {status === 'scheduled' && (
                <Button
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={() => setShowConfirmVisit(true)}
                >
                  ✅ Confirm Visit
                </Button>
              )}
              {status === 'confirmed' && (
                <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                  Already confirmed
                </p>
              )}
              {(status === 'scheduled' || status === 'confirmed' || status === 'rescheduled') && (
                <Button className="w-full" onClick={() => void handleMarkCompleted()}>
                  ✔️ Mark as Completed
                </Button>
              )}
              {status !== 'missed' && status !== 'completed' && status !== 'cancelled' && (
                <Button
                  variant="outline"
                  className="w-full border-orange-300 text-orange-700"
              onClick={() => {
                    void persistVisitUpdate('missed')
                      .then(() => {
                        updateStatus('missed')
                        addActivity('Marked as missed')
                      })
                      .catch((error) => toastApi.error(formatVisitApiError(error, status, 'missed', 'Could not mark missed')))
                  }}
                >
                  ⚠️ Mark as Missed
                </Button>
              )}
              {canReschedule && (
                <Button variant="outline" className="w-full" onClick={() => setShowReschedule(true)}>
                  🔄 Reschedule Visit
                </Button>
              )}
              {canCancel && (
                <Button
                  variant="outline"
                  className="w-full border-destructive text-destructive"
                  onClick={() => setShowCancel(true)}
                >
                  ❌ Cancel Visit
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {shareDocsOpen && visit && (
        <ShareDocumentsModal
          visit={visit}
          onClose={() => setShareDocsOpen(false)}
          onSendWhatsApp={(docs) => {
            const msg = `Documents shared for ${visit.propertyTitle}: ${docs.join(', ')}`
            logVisitMessage({
              channel: 'whatsapp',
              to: visit.buyerPhone,
              toName: visit.buyerName,
              message: msg,
            })
            openWhatsApp(visit.buyerPhone, msg)
            addActivity(`Documents shared: ${docs.join(', ')}`)
            setShareDocsOpen(false)
            toastApi.success('WhatsApp opened with document list')
          }}
        />
      )}

      {whatsappOpen && visit && (
        <ModalShell onClose={() => setWhatsappOpen(false)}>
          <h3 className="text-lg font-semibold">Send WhatsApp</h3>
          <textarea
            value={whatsappBody}
            onChange={(e) => setWhatsappBody(e.target.value)}
            className="mt-3 min-h-[120px] w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
          <div className="mt-4 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setWhatsappOpen(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!whatsappBody.trim()}
              onClick={() => {
                logVisitMessage({
                  channel: 'whatsapp',
                  to: visit.buyerPhone,
                  toName: visit.buyerName,
                  message: whatsappBody.trim(),
                })
                openWhatsApp(visit.buyerPhone, whatsappBody.trim())
                setWhatsappOpen(false)
                setToast('WhatsApp message sent')
              }}
            >
              Send
            </Button>
          </div>
        </ModalShell>
      )}

      {emailOpen && visit && (
        <ModalShell onClose={() => setEmailOpen(false)}>
          <h3 className="text-lg font-semibold">Send Email</h3>
          <input
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            placeholder="Subject"
            className="mt-3 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
          />
          <textarea
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            placeholder="Body"
            className="mt-2 min-h-[120px] w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
          <div className="mt-4 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEmailOpen(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!visit.buyerEmail || !emailSubject.trim() || !emailBody.trim()}
              onClick={() => {
                void (async () => {
                  if (!visit.buyerEmail) return
                  const session = readAdminSession()
                  if (!session?.accessToken) {
                    toastApi.error('Your admin session has expired. Please log in again.')
                    return
                  }
                  try {
                    await sendWorkflowEmail(session.accessToken, 'visit', visit.id, {
                      to: visit.buyerEmail,
                      subject: emailSubject.trim(),
                      body: emailBody.trim(),
                      summary: `Email sent to ${visit.buyerName}`,
                    })
                    refreshSentMessages()
                    setEmailOpen(false)
                    toastApi.success('Email sent successfully')
                  } catch (error) {
                    toastApi.error(formatAdminApiError(error, 'Could not send email'))
                  }
                })()
              }}
            >
              Send
            </Button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}

function CallLogCard({
  logs,
  showForm,
  setShowForm,
  callDuration,
  setCallDuration,
  callOutcome,
  setCallOutcome,
  callNotes,
  setCallNotes,
  onSave,
}: {
  logs: VisitCallLog[]
  showForm: boolean
  setShowForm: (v: boolean) => void
  callDuration: string
  setCallDuration: (v: string) => void
  callOutcome: string
  setCallOutcome: (v: string) => void
  callNotes: string
  setCallNotes: (v: string) => void
  onSave: () => void
}) {
  return (
    <Card>
      <CardHeader className="flex-row justify-between">
        <CardTitle>Call Log</CardTitle>
        {!showForm && (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="size-3" /> Log Call
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {logs.length === 0 && !showForm && (
          <div className="py-8 text-center">
            <Phone className="mx-auto mb-2 size-10 text-muted-foreground/40" />
            <p className="font-medium">No calls logged yet</p>
          </div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="mb-2 rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">
              {log.duration} min · {log.outcome}
            </p>
            <p className="text-xs text-muted-foreground">{formatFullDate(log.at)}</p>
            {log.notes && <p className="mt-1">{log.notes}</p>}
          </div>
        ))}
        {showForm && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <input
              type="number"
              placeholder="Duration (minutes)"
              value={callDuration}
              onChange={(e) => setCallDuration(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
            />
            <input
              value={callOutcome}
              onChange={(e) => setCallOutcome(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
            />
            <textarea
              rows={3}
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={onSave}>
                Save Call
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function NotesCard({
  notes,
  showForm,
  setShowForm,
  noteText,
  setNoteText,
  onSave,
  onDelete,
}: {
  notes: VisitNote[]
  showForm: boolean
  setShowForm: (v: boolean) => void
  noteText: string
  setNoteText: (v: string) => void
  onSave: () => void
  onDelete: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader className="flex-row justify-between">
        <CardTitle>Notes</CardTitle>
        {!showForm && (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="size-3" /> Add Note
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {notes.length === 0 && !showForm && (
          <div className="py-8 text-center">
            <FileText className="mx-auto mb-2 size-10 text-muted-foreground/40" />
            <p className="font-medium">No notes yet</p>
          </div>
        )}
        {notes.map((note) => (
          <div key={note.id} className="mb-2 flex items-start justify-between rounded-lg bg-muted p-3">
            <div>
              <p className="text-sm">{note.text}</p>
              <p className="text-xs text-muted-foreground">{formatFullDate(note.at)}</p>
            </div>
            <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => onDelete(note.id)}>
              <X className="size-4" />
            </Button>
          </div>
        ))}
        {showForm && (
          <div className="space-y-2">
            <textarea
              rows={4}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={onSave}>
                Save Note
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
