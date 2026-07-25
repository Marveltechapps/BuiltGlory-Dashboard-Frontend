import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  AlertCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  BUDGET_LABELS,
  BUDGET_STYLES,
  INTERIOR_STATUS_LABELS as STATUS_LABELS,
  INTERIOR_STATUS_STYLES as STATUS_STYLES,
  STYLE_LABELS,
  formatInr,
  getAdminDesigners,
  getAdminInteriorLead,
  getSLAHoursRemaining,
  getSLALabel,
  getSLAStatus,
  updateAdminInteriorLead,
  type Designer,
  type InteriorLead,
  type InteriorLeadStatus,
} from '@/api/adminEnquiries'
import { readAdminSession } from '@/api/admin'
import { createWorkflowLog, listWorkflowLogs, type WorkflowLog } from '@/api/adminWorkflow'
import { Badge } from '@/components/ui/badge'
import {
  CallLogPanel,
  type CallLog,
  type CallRecordingPayload,
} from '@/components/admin/CallLogPanel'
import { NegotiationChat } from '@/components/admin/NegotiationChat'
import { SentMessagesCard } from '@/components/admin/SentMessagesCard'
import NotificationPreview from '@/components/NotificationPreview'
import { bindToast, copyText, handleCall } from '@/utils/adminActions'
import { cn } from '@/lib/utils'
import {
  DEFAULT_SENT_BY,
  loadMessages,
  logMessage,
  messageToActivityText,
  openEmail,
  openWhatsApp,
  type SentMessage,
} from '@/utils/messageLog'
import { get72hrStatus, hoursSince } from '@/utils/timer'
import { NOTIFICATION_TEMPLATES, sendPushNotification } from '@/utils/notifications'

type CallOutcome =
  | 'Interested'
  | 'Not Interested'
  | 'Callback Later'
  | 'No Answer'
  | 'Wrong Number'

function getUserTypeBadgeColor(type: string) {
  if (type === 'nri') return 'bg-purple-100 text-purple-700'
  if (type === 'pio') return 'bg-blue-100 text-blue-700'
  return 'bg-green-100 text-green-700'
}

interface AdminNote {
  id: string
  text: string
  at: string
}

interface ActivityItem {
  id: string
  text: string
  at: string
}

interface QuoteHistoryEntry {
  id: string
  packageName: string
  amount: number
  sentAt: string
  status: 'active' | 'expired' | 'superseded' | 'declined'
  revision: number
}

function workflowLogToInteriorCall(log: WorkflowLog): CallLog {
  return {
    id: log.id,
    duration: log.durationMinutes ?? 0,
    outcome: (log.outcome as CallOutcome | undefined) ?? 'Interested',
    notes: log.body ?? log.summary,
    at: log.occurredAt,
    recordingUrl: log.attachments?.[0]?.url,
    recordingFileName: log.attachments?.[0]?.fileName,
  }
}

function workflowLogToInteriorNote(log: WorkflowLog): AdminNote {
  return {
    id: log.id,
    text: log.body ?? log.summary,
    at: log.occurredAt,
  }
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
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function getDesignerAvailability(designer: Designer) {
  if (!designer.isAvailable) {
    return {
      icon: '❌',
      label: 'Unavailable',
      textClass: 'text-red-600',
    }
  }
  if (designer.activeProjects > 3) {
    return {
      icon: '⚠️',
      label: 'Busy',
      textClass: 'text-orange-600',
    }
  }
  return {
    icon: '✅',
    label: 'Available',
    textClass: 'text-green-600',
  }
}

function formatDesignerOption(designer: Designer) {
  const avail = getDesignerAvailability(designer)
  return `${avail.icon} ${designer.name} — ${avail.label} (${designer.activeProjects} projects)`
}

function getStatusDisplay(status: InteriorLeadStatus) {
  if ((status as string) === 'on_hold') {
    return { label: 'On Hold', style: 'bg-amber-100 text-amber-800' }
  }
  return { label: STATUS_LABELS[status], style: STATUS_STYLES[status] }
}

function Breadcrumb({ buyerName }: { buyerName: string }) {
  const navigate = useNavigate()
  const listPath = '/admin/enquiries/interior'

  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back
      </button>
      <ChevronRight className="size-4 text-muted-foreground" />
      <button
        type="button"
        onClick={() => navigate(listPath)}
        className="text-muted-foreground hover:text-foreground"
      >
        Interior Leads
      </button>
      <ChevronRight className="size-4 text-muted-foreground" />
      <span className="font-medium text-foreground">{buyerName}</span>
    </nav>
  )
}

export function InteriorLeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const quoteRef = useRef<HTMLDivElement>(null)
  const designerSelectRef = useRef<HTMLLabelElement>(null)

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lead, setLead] = useState<InteriorLead | null>(null)
  const [designers, setDesigners] = useState<Designer[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const toastApi = useMemo(() => bindToast(setToast), [])

  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [notes, setNotes] = useState<AdminNote[]>([])
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [showCallForm, setShowCallForm] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [callDuration, setCallDuration] = useState('')
  const [callOutcome, setCallOutcome] = useState<CallOutcome>('Interested')
  const [callNotes, setCallNotes] = useState('')
  const [noteText, setNoteText] = useState('')
  const [whatsappOpen, setWhatsappOpen] = useState(false)
  const [whatsappBody, setWhatsappBody] = useState('')
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([])

  const [quotePackage, setQuotePackage] = useState('')
  const [quotePrice, setQuotePrice] = useState('')
  const [quoteTimeline, setQuoteTimeline] = useState('')
  const [quoteInclusions, setQuoteInclusions] = useState('')
  const [quoteDesigner, setQuoteDesigner] = useState<string>('')
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false)
  const [quoteHistory, setQuoteHistory] = useState<QuoteHistoryEntry[]>([])
  const [quoteRevision, setQuoteRevision] = useState(1)
  const [showNewQuoteAfterExpiry, setShowNewQuoteAfterExpiry] = useState(false)
  const [acceptModal, setAcceptModal] = useState<'no_designer' | 'unavailable' | null>(null)
  const [modalDesignerId, setModalDesignerId] = useState('')
  const [unavailableAction, setUnavailableAction] = useState<'reassign' | 'proceed' | 'hold'>(
    'reassign',
  )

  const showToast = useCallback((msg: string) => setToast(msg), [])

  const dispatchPush = useCallback(
    async (
      userName: string,
      template: ReturnType<typeof NOTIFICATION_TEMPLATES.N09_INTERIOR_QUOTE>,
      notificationId: string,
      dedupeKey?: string,
    ) => {
      let msg = await sendPushNotification(userName, template, notificationId, {
        dedupeKey,
        relatedTo: lead ? { type: 'interior', id: lead.id } : undefined,
      })
      if (msg.includes('recently') && window.confirm(`${msg}\n\nSend again?`)) {
        msg = await sendPushNotification(userName, template, notificationId, {
          skipDuplicateCheck: true,
          dedupeKey,
          relatedTo: lead ? { type: 'interior', id: lead.id } : undefined,
        })
      }
      showToast(msg)
      return !msg.includes('recently')
    },
    [lead, showToast],
  )

  const loadLead = useCallback(async () => {
    const session = readAdminSession()
    if (!id || !session?.accessToken) {
      setLoadError('Your admin session has expired. Please log in again.')
      setLead(null)
      setDesigners([])
      setNotFound(true)
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)
    try {
      const [found, designerList, callResult, noteResult] = await Promise.all([
        getAdminInteriorLead(session.accessToken, id),
        getAdminDesigners(session.accessToken),
        listWorkflowLogs(session.accessToken, 'interior', id, 'call').catch(() => ({ data: [] })),
        listWorkflowLogs(session.accessToken, 'interior', id, 'note').catch(() => ({ data: [] })),
      ])
      setLead(found)
      setDesigners(designerList)
      setCallLogs(callResult.data.map(workflowLogToInteriorCall))
      setNotes(noteResult.data.map(workflowLogToInteriorNote))
      setActivities([
        {
          id: 'submitted',
          text: 'Interior interest submitted via app (INT-04)',
          at: found.submittedAt,
        },
      ])
      setQuoteDesigner(
        designerList.find((designer) => designer.id === found.assignedDesigner || designer.name === found.assignedDesigner)?.id ?? '',
      )
      setNotFound(false)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load interior lead.')
      setLead(null)
      setDesigners([])
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadLead()
    }, 600)
    return () => clearTimeout(timer)
  }, [loadLead])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const profilePath = `/admin/users/${lead?.buyerUserId ?? ''}`
  const slaStatus = lead ? getSLAStatus(lead) : 'ok'
  const slaLabel = lead ? getSLALabel(lead) : null
  const slaHours = lead ? getSLAHoursRemaining(lead) : 0
  const isClosedLike =
    lead?.status === 'declined' || lead?.status === 'completed'

  const patchLead = useCallback((patch: Partial<InteriorLead>) => {
    setLead((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const persistLeadPatch = useCallback(
    async (body: Parameters<typeof updateAdminInteriorLead>[2], fallbackPatch?: Partial<InteriorLead>) => {
      if (!lead) return null
      const session = readAdminSession()
      if (!session?.accessToken) {
        showToast('Admin session expired. Please sign in again.')
        return null
      }
      try {
        const updated = await updateAdminInteriorLead(session.accessToken, lead.id, body)
        setLead(updated)
        return updated
      } catch (error) {
        if (fallbackPatch) patchLead(fallbackPatch)
        showToast(error instanceof Error ? error.message : 'Unable to update interior lead.')
        return null
      }
    },
    [lead, patchLead, showToast],
  )

  const addActivity = useCallback((text: string, id?: string) => {
    setActivities((prev) => [
      { id: id ?? `act-${Date.now()}`, text, at: new Date().toISOString() },
      ...prev,
    ])
  }, [])

  const refreshSentMessages = useCallback(() => {
    if (lead) void loadMessages('interior', lead.id).then(setSentMessages)
  }, [lead])

  useEffect(() => {
    refreshSentMessages()
  }, [refreshSentMessages])

  const logInteriorMessage = useCallback(
    (msg: Omit<SentMessage, 'id' | 'sentAt' | 'relatedTo' | 'sentBy'>) => {
      if (!lead) return
      logMessage({
        ...msg,
        sentBy: DEFAULT_SENT_BY,
        relatedTo: {
          type: 'interior',
          id: lead.id,
          title: lead.propertyTitle,
        },
      })
      refreshSentMessages()
    },
    [lead, addActivity, refreshSentMessages],
  )

  const activityTimeline = useMemo(() => {
    const fromMessages = sentMessages.map((m) => ({
      id: m.id,
      text: messageToActivityText(m),
      at: m.sentAt,
    }))
    return [...fromMessages, ...activities].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    )
  }, [activities, sentMessages])

  const handleStatusChange = async (status: InteriorLeadStatus) => {
    const updated = await persistLeadPatch({ status }, { status })
    if (!updated) return
    addActivity(`Status changed to ${STATUS_LABELS[status]}`)
  }

  const quotePreviewTemplate = lead
    ? NOTIFICATION_TEMPLATES.N09_INTERIOR_QUOTE(lead.buyerName, lead.propertyTitle)
    : null

  const quoteTimerStatus = lead?.quoteSentAt ? get72hrStatus(lead.quoteSentAt) : null
  const quoteExpired = quoteTimerStatus?.status === 'expired'
  const noResponse48hrs =
    lead?.quoteSentAt &&
    lead.status === 'quote_sent' &&
    hoursSince(lead.quoteSentAt) >= 48

  const handleSendQuote = async (forceWithoutDesigner = false) => {
    if (!lead || !quotePackage.trim() || !quotePrice.trim()) return
    if (!quoteDesigner && !forceWithoutDesigner) return
    if (
      !quoteDesigner &&
      !window.confirm(
        'Send without designer assigned?\n\nBuyer will expect a designer contact — assign one first.',
      )
    ) {
      return
    }
    const amount = parseInt(quotePrice.replace(/\D/g, ''), 10)
    if (!Number.isFinite(amount)) return
    const now = new Date().toISOString()
    const validUntil = new Date(Date.now() + 72 * 3600000).toISOString()
    const revision = quoteRevision
    const designerName = designers.find((d) => d.id === quoteDesigner)?.name ?? null

    setQuoteHistory((prev) => [
      {
        id: `qh-${Date.now()}`,
        packageName: quotePackage.trim(),
        amount,
        sentAt: now,
        status: 'active',
        revision,
      },
      ...prev.map((q) =>
        q.status === 'active' ? { ...q, status: 'superseded' as const } : q,
      ),
    ])
    setQuoteRevision((n) => n + 1)
    setShowNewQuoteAfterExpiry(false)

    const patch = {
      status: 'quote_sent',
      quotePackageName: quotePackage.trim(),
      quoteAmount: amount,
      quoteTimeline: quoteTimeline.trim() || '6 weeks',
      quoteInclusions: quoteInclusions.trim(),
      quoteSentAt: now,
      quoteValidUntil: validUntil,
      assignedDesigner: quoteDesigner || null,
    } satisfies Partial<InteriorLead>
    const updated = await persistLeadPatch(
      {
        status: 'quote_sent',
        assignedDesigner: quoteDesigner || undefined,
        quote: {
          amount,
          packageName: quotePackage.trim(),
          timeline: quoteTimeline.trim() || '6 weeks',
          inclusions: quoteInclusions.split('\n').map((item) => item.trim()).filter(Boolean),
          validUntil,
        },
      },
      patch,
    )
    if (!updated) return
    addActivity(
      revision > 1
        ? `Revised quote #${revision} sent: ${quotePackage.trim()} — ${formatInr(amount)}${designerName ? ` (${designerName})` : ''}`
        : `Quote sent: ${quotePackage.trim()} — ${formatInr(amount)}${designerName ? ` (${designerName})` : ''}`,
    )

    const template = NOTIFICATION_TEMPLATES.N09_INTERIOR_QUOTE(lead.buyerName, lead.propertyTitle)
    dispatchPush(lead.buyerName, template, 'N-09', `N-09:${lead.id}:${revision}`)

    const quoteMessage = `Your interior design quote: ${quotePackage.trim()} — ${formatInr(amount)}. Valid for 72 hours. Timeline: ${quoteTimeline.trim() || '6 weeks'}.${quoteInclusions.trim() ? ` Inclusions: ${quoteInclusions.trim()}.` : ''}`
    logMessage({
      channel: 'whatsapp',
      to: lead.phone,
      toName: lead.buyerName,
      message: quoteMessage,
      sentBy: DEFAULT_SENT_BY,
      relatedTo: {
        type: 'interior',
        id: lead.id,
        title: lead.propertyTitle,
      },
    })
    refreshSentMessages()
    openWhatsApp(lead.phone, quoteMessage)

    setQuotePackage('')
    setQuotePrice('')
    setQuoteTimeline('')
    setQuoteInclusions('')
  }

  const completeBuyerAcceptance = useCallback(
    async (designerName?: string | null) => {
      if (!lead) return
      const designerId = designerName ? designers.find((d) => d.name === designerName)?.id : undefined
      const updated = await persistLeadPatch(
        {
          status: 'accepted',
          assignedDesigner: designerId,
          customerAcceptedAt: new Date().toISOString(),
        },
        { status: 'accepted', assignedDesigner: designerId ?? lead.assignedDesigner },
      )
      if (!updated) return
      if (designerName) {
        setQuoteDesigner(designerId ?? '')
      }
      const template = NOTIFICATION_TEMPLATES.N17_INTERIOR_CONFIRMED(lead.buyerName)
      dispatchPush(lead.buyerName, template, 'N-17', `N-17:${lead.id}`)
      setQuoteHistory((prev) =>
        prev.map((q) => (q.status === 'active' ? { ...q, status: 'superseded' as const } : q)),
      )
      addActivity('Buyer accepted interior quote')
      showToast('Interior order confirmed!')
      setAcceptModal(null)
    },
    [lead, designers, persistLeadPatch, addActivity, dispatchPush, showToast],
  )

  const handleBuyerAccepted = () => {
    if (!lead) return

    const assigned = lead.assignedDesigner
      ? designers.find((d) => d.name === lead.assignedDesigner || d.id === lead.assignedDesigner)
      : undefined

    if (!lead.assignedDesigner || !assigned) {
      const firstAvailable = designers.find((d) => d.isAvailable)
      setModalDesignerId(firstAvailable?.id ?? '')
      setAcceptModal('no_designer')
      return
    }

    if (!assigned.isAvailable) {
      const alt = designers.find((d) => d.isAvailable && d.id !== assigned.id)
      setModalDesignerId(alt?.id ?? '')
      setUnavailableAction('reassign')
      setAcceptModal('unavailable')
      return
    }

    completeBuyerAcceptance()
  }

  const handleAssignAndAccept = () => {
    const designer = designers.find((d) => d.id === modalDesignerId)
    if (!designer) {
      showToast('Select a designer')
      return
    }
    completeBuyerAcceptance(designer.name)
  }

  const handleUnavailableAcceptAction = () => {
    if (!lead?.assignedDesigner) return
    const assigned = designers.find((d) => d.name === lead.assignedDesigner || d.id === lead.assignedDesigner)

    if (unavailableAction === 'hold') {
      void persistLeadPatch({ status: 'contacted', notes: 'On hold pending designer availability' }, { status: 'contacted' })
      addActivity('Lead put on hold — designer unavailable')
      showToast('Lead put on hold pending designer availability')
      setAcceptModal(null)
      return
    }

    if (unavailableAction === 'reassign') {
      const designer = designers.find((d) => d.id === modalDesignerId)
      if (!designer?.isAvailable) {
        showToast('Select an available designer')
        return
      }
      completeBuyerAcceptance(designer.name)
      return
    }

    if (assigned) {
      completeBuyerAcceptance(assigned.name)
    }
  }

  const handleBuyerDeclined = () => {
    if (!lead) return
    void handleStatusChange('declined')
    setQuoteHistory((prev) =>
      prev.map((q) => (q.status === 'active' ? { ...q, status: 'declined' as const } : q)),
    )
  }

  const startNewQuoteAfterExpiry = () => {
    setShowNewQuoteAfterExpiry(true)
    setQuotePackage('')
    setQuotePrice('')
    setQuoteTimeline('')
    setQuoteInclusions('')
    void persistLeadPatch({ status: 'contacted' }, { status: 'contacted' })
    setQuoteHistory((prev) =>
      prev.map((q) => (q.status === 'active' ? { ...q, status: 'expired' as const } : q)),
    )
    addActivity('New quote form opened after expiry')
  }

  const handleSaveCall = async (recording?: CallRecordingPayload) => {
    if (!lead) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      return
    }
    const duration = parseInt(callDuration, 10) || 0
    try {
      const log = await createWorkflowLog(session.accessToken, 'interior', lead.id, {
        channel: 'call',
        direction: 'outbound',
        summary: `Call logged — ${callOutcome}`,
        body: callNotes,
        outcome: callOutcome,
        durationMinutes: duration,
        attachments: recording
          ? [{ fileName: recording.fileName, url: recording.url, mimeType: 'audio/*', sizeBytes: recording.size }]
          : undefined,
      })
      setCallLogs((prev) => [workflowLogToInteriorCall(log), ...prev])
      addActivity(`Call logged — ${callOutcome} (${duration} min)`)
      setShowCallForm(false)
      setCallDuration('')
      setCallNotes('')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save call log.')
    }
  }

  const handleSaveNote = async () => {
    if (!lead || !noteText.trim()) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Admin session expired. Please sign in again.')
      return
    }
    try {
      const log = await createWorkflowLog(session.accessToken, 'interior', lead.id, {
        channel: 'note',
        direction: 'internal',
        summary: noteText.trim(),
        body: noteText.trim(),
      })
      setNotes((prev) => [workflowLogToInteriorNote(log), ...prev])
      addActivity('Internal note added')
      setNoteText('')
      setShowNoteForm(false)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save note.')
    }
  }

  const resetQuoteForm = () => {
    setQuotePackage('')
    setQuotePrice('')
    setQuoteTimeline('')
    setQuoteInclusions('')
    patchLead({
      status: 'contacted',
      quoteSentAt: null,
      quoteAmount: null,
      quotePackageName: null,
      quoteTimeline: null,
      quoteInclusions: null,
      quoteValidUntil: null,
    })
    addActivity('Revised quote form opened')
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[900px] space-y-4 px-4 py-6">
        <div className="h-6 w-64 animate-pulse rounded bg-muted" />
        <div className="h-10 w-3/4 animate-pulse rounded bg-muted" />
        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          <div className="col-span-3 h-96 animate-pulse rounded-xl bg-muted" />
          <div className="col-span-2 h-96 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    )
  }

  if (notFound || !lead) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-12 text-center">
        <AlertCircle className="mx-auto mb-3 size-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{loadError ? 'Could not load interior lead' : 'Lead not found'}</h1>
        {loadError && <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{loadError}</p>}
        <div className="mt-4 flex justify-center gap-2">
          {loadError && <Button onClick={() => void loadLead()}>Retry</Button>}
          <Button variant="outline" onClick={() => navigate('/admin/enquiries/interior')}>
            Back to Interior Leads
          </Button>
        </div>
      </div>
    )
  }

  const showQuoteForm =
    showNewQuoteAfterExpiry ||
    !lead.quoteSentAt ||
    lead.status === 'declined' ||
    (lead.status === 'contacted' && !lead.quoteAmount) ||
    (quoteExpired && lead.status === 'quote_sent')

  const statusDisplay = getStatusDisplay(lead.status)
  const selectedQuoteDesigner = designers.find((d) => d.id === quoteDesigner)
  const assignedDesigner = lead.assignedDesigner
    ? designers.find((d) => d.name === lead.assignedDesigner || d.id === lead.assignedDesigner)
    : undefined
  const availableDesigners = designers.filter((d) => d.isAvailable)

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <Breadcrumb buyerName={lead.buyerName} />

      {slaStatus === 'breached' && (lead.status === 'new' || lead.status === 'contacted') && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-600 px-4 py-3 text-center text-sm font-medium text-white">
          🔴 SLA breached — respond immediately
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{lead.buyerName}</h1>
          <p className="font-mono text-sm text-muted-foreground">{lead.referenceId}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                statusDisplay.style,
              )}
            >
              {statusDisplay.label}
            </span>
            {(lead.status === 'new' || lead.status === 'contacted') && slaLabel && (
              <span
                className={cn(
                  'text-sm font-medium',
                  slaLabel.tone === 'green' && 'text-green-600',
                  slaLabel.tone === 'orange' && 'text-amber-600',
                  slaLabel.tone === 'red' && 'text-red-600',
                )}
              >
                <Clock className="mr-1 inline size-4" />
                {slaLabel.text}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => handleCall(lead.phone)}>
            📞 Call
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setWhatsappBody(
                `Hi ${lead.buyerName}, regarding your interior design enquiry for ${lead.propertyTitle}.`,
              )
              setWhatsappOpen(true)
            }}
          >
            💬 WhatsApp
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setEmailSubject(`BuiltGlory Interior — ${lead.propertyTitle}`)
              setEmailBody(
                `Hi ${lead.buyerName},\n\nRegarding your interior design enquiry.`,
              )
              setEmailOpen(true)
            }}
          >
            📧 Email
          </Button>
          <select
            value={lead.status}
            onChange={(e) => handleStatusChange(e.target.value as InteriorLeadStatus)}
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
          >
            {(
              [
                'new',
                'contacted',
                'quote_sent',
                'accepted',
                'negotiating',
                'declined',
                'completed',
              ] as InteriorLeadStatus[]
            ).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Requirements from App</CardTitle>
              <p className="text-xs text-muted-foreground">📱 App screen: INT-04</p>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Selected Rooms</p>
                <div className="flex flex-wrap gap-2">
                  {lead.selectedRooms.map((room) => (
                    <span
                      key={room}
                      className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700"
                    >
                      {room}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Design Style</p>
                  <span className="rounded-lg bg-slate-100 px-4 py-2 text-base font-semibold text-slate-800">
                    {STYLE_LABELS[lead.designStyle]}
                  </span>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Budget Range</p>
                  <span
                    className={cn(
                      'rounded-lg px-4 py-2 text-base font-semibold',
                      BUDGET_STYLES[lead.budgetRange],
                    )}
                  >
                    {BUDGET_LABELS[lead.budgetRange]}
                  </span>
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Special Notes</p>
                {lead.specialNotes ? (
                  <p className="rounded-md bg-muted p-3">{lead.specialNotes}</p>
                ) : (
                  <p className="italic text-muted-foreground">No special notes</p>
                )}
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                <img
                  src={lead.propertyThumbnail}
                  alt=""
                  className="size-16 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{lead.propertyTitle}</p>
                  <p className="text-xs text-muted-foreground">{lead.propertyLocation}</p>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-sm"
                    onClick={() => navigate(`/admin/properties/${lead.propertyId}`)}
                  >
                    View Property →
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div ref={quoteRef}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Send Quote to Buyer</CardTitle>
              <p className="text-xs text-muted-foreground">📱 App screen: INT-05</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {lead.status === 'accepted' && lead.quoteAmount && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <p className="font-medium text-green-800">
                    ✅ Buyer accepted quote for {formatInr(lead.quoteAmount)}
                  </p>
                  <Button
                    type="button"
                    className="mt-3 w-full"
                    onClick={() => navigate('/admin/sales/interior')}
                  >
                    Move to Sales Pipeline →
                  </Button>
                </div>
              )}

              {lead.status === 'negotiating' && (
                <NegotiationChat
                  entityType="interior"
                  entityId={lead.id}
                  entityTitle={lead.propertyTitle}
                  currentPrice={lead.quoteAmount ?? 500000}
                  otherPartyName={lead.buyerName}
                  otherPartyPhone={lead.phone}
                  otherPartyType="buyer"
                  negotiationStartedAt={lead.quoteSentAt ?? lead.submittedAt}
                  toast={showToast}
                  onOfferAccepted={(amount) => {
                    void persistLeadPatch(
                      {
                        status: 'accepted',
                        quote: {
                          amount,
                          packageName: lead.quotePackageName || 'Interior quote',
                          timeline: lead.quoteTimeline || 'To be confirmed',
                          inclusions: lead.quoteInclusions ? lead.quoteInclusions.split('\n').filter(Boolean) : [],
                          validUntil: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
                        },
                      },
                      { quoteAmount: amount, status: 'accepted' },
                    )
                    addActivity(`Quote agreed at ${formatInr(amount)}`)
                    showToast('Interior quote agreed')
                  }}
                />
              )}

              {lead.status === 'declined' && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="font-medium text-red-800">Buyer declined</p>
                  <Button type="button" variant="outline" className="mt-3 w-full" onClick={resetQuoteForm}>
                    Send Revised Quote
                  </Button>
                </div>
              )}

              {quoteExpired && lead.status === 'quote_sent' && !showNewQuoteAfterExpiry && (
                <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900">
                  <p className="font-medium">⚠️ Quote validity (72hrs) has expired.</p>
                  <p className="mt-1">Send a new quote to the buyer.</p>
                  <Button type="button" className="mt-3 w-full" onClick={startNewQuoteAfterExpiry}>
                    Send New Quote
                  </Button>
                </div>
              )}

              {noResponse48hrs && !quoteExpired && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No response in 48hrs. Consider following up.
                </div>
              )}

              {quoteHistory.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Quote history</p>
                  {quoteHistory.map((q) => (
                    <div
                      key={q.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span>
                        #{q.revision} {q.packageName} — {formatInr(q.amount)}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatFullDate(q.sentAt)}
                        </span>
                        <Badge
                          variant="default"
                          className={cn(
                            q.status === 'expired' && 'bg-red-100 text-red-800',
                            q.status === 'declined' && 'bg-red-100 text-red-800',
                            q.status === 'superseded' && 'bg-muted text-muted-foreground',
                          )}
                        >
                          {q.status === 'active'
                            ? 'Active'
                            : q.status === 'expired'
                              ? 'Expired'
                              : q.status === 'declined'
                                ? 'Declined'
                                : 'Superseded'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showQuoteForm && lead.status !== 'accepted' && lead.status !== 'negotiating' && (
                <div className="space-y-3">
                  {quoteRevision > 1 && (
                    <p className="text-sm text-muted-foreground">Revised quote #{quoteRevision}</p>
                  )}
                  <label className="block text-sm">
                    Package name *
                    <input
                      value={quotePackage}
                      onChange={(e) => setQuotePackage(e.target.value)}
                      placeholder="Premium Interior Package"
                      className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    Total price ₹ *
                    <input
                      value={quotePrice}
                      onChange={(e) => setQuotePrice(e.target.value)}
                      placeholder="850000"
                      className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    Timeline
                    <input
                      value={quoteTimeline}
                      onChange={(e) => setQuoteTimeline(e.target.value)}
                      placeholder="6 weeks"
                      className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    Inclusions
                    <textarea
                      value={quoteInclusions}
                      onChange={(e) => setQuoteInclusions(e.target.value)}
                      placeholder="What's included in this package"
                      rows={3}
                      className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                    />
                  </label>
                  <label ref={designerSelectRef} className="block text-sm" id="designer-assignment">
                    Designer assigned
                    <select
                      value={quoteDesigner}
                      onChange={(e) => setQuoteDesigner(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm"
                    >
                      <option value="">— Select designer —</option>
                      {designers.map((d) => (
                        <option
                          key={d.id}
                          value={d.id}
                          className={getDesignerAvailability(d).textClass}
                        >
                          {formatDesignerOption(d)} · {d.specialization.join(', ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedQuoteDesigner && !selectedQuoteDesigner.isAvailable && (
                    <p className="mt-2 text-xs text-orange-700">
                      ⚠️ {selectedQuoteDesigner.name} is currently unavailable. Assigning anyway —
                      coordinate workload before proceeding.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Quote validity: 72 hours</p>
                  {!quoteDesigner && (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="flex gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <p className="text-sm font-medium text-amber-900">
                            ⚠️ No designer assigned
                          </p>
                          <p className="text-xs text-amber-800">
                            Assign a designer before sending the quote
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                designerSelectRef.current?.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'center',
                                })
                              }
                            >
                              Assign Designer Now
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="border-amber-300 text-amber-900"
                              onClick={() => handleSendQuote(true)}
                            >
                              Send Anyway
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {quotePreviewTemplate && (
                    <div className="space-y-1">
                      <p className="text-sm font-medium">📱 Buyer will receive:</p>
                      <NotificationPreview
                        notificationId="N-09"
                        title={quotePreviewTemplate.title}
                        body={quotePreviewTemplate.body}
                        deepLink={quotePreviewTemplate.deepLink}
                      />
                    </div>
                  )}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!quoteDesigner}
                    onClick={() => handleSendQuote()}
                  >
                    Send Quote & Notify Buyer
                  </Button>
                </div>
              )}

              {lead.quoteSentAt && lead.status === 'quote_sent' && (
                <>
                  {quoteTimerStatus && (
                    <p
                      className={cn(
                        'text-sm font-medium',
                        quoteTimerStatus.status === 'valid' && 'text-green-700',
                        quoteTimerStatus.status === 'expiring' && 'text-amber-700',
                        quoteTimerStatus.status === 'expired' && 'text-red-700',
                      )}
                    >
                      {quoteTimerStatus.status === 'valid' &&
                        `⏱ Quote valid for ${quoteTimerStatus.hoursRemaining} hours`}
                      {quoteTimerStatus.status === 'expiring' &&
                        `⚠️ Quote expires in ${quoteTimerStatus.hoursRemaining} hours`}
                      {quoteTimerStatus.status === 'expired' && '❌ Quote expired'}
                    </p>
                  )}
                  <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                    {quoteExpired && (
                      <Badge variant="red" className="mb-2">
                        Expired
                      </Badge>
                    )}
                    <p>
                      <span className="text-muted-foreground">Package:</span>{' '}
                      <strong>{lead.quotePackageName}</strong>
                    </p>
                    <p className="mt-1">
                      <span className="text-muted-foreground">Amount:</span>{' '}
                      <strong className="text-primary">
                        {lead.quoteAmount != null ? formatInr(lead.quoteAmount) : '—'}
                      </strong>
                    </p>
                    <p className="mt-1">
                      <span className="text-muted-foreground">Timeline:</span> {lead.quoteTimeline}
                    </p>
                    {lead.quoteValidUntil && (
                      <p className="mt-1 text-muted-foreground">
                        Valid until: {formatFullDate(lead.quoteValidUntil)}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sent: {formatTimeAgo(lead.quoteSentAt)}
                    </p>
                  </div>
                  {!quoteExpired && (
                    <p className="text-sm text-muted-foreground">⏳ Awaiting buyer response...</p>
                  )}
                  {!quoteExpired && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={handleBuyerAccepted}
                      >
                        ✅ Buyer Accepted
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleStatusChange('negotiating')}
                      >
                        💬 Buyer Negotiating
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-red-200 text-red-700"
                        onClick={handleBuyerDeclined}
                      >
                        ❌ Buyer Declined
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          </div>

          <CallLogPanel
            callLogs={callLogs}
            showForm={showCallForm}
            onShowFormChange={setShowCallForm}
            callDuration={callDuration}
            onCallDurationChange={setCallDuration}
            callOutcome={callOutcome}
            onCallOutcomeChange={(v) => setCallOutcome(v as CallOutcome)}
            callNotes={callNotes}
            onCallNotesChange={setCallNotes}
            onSave={handleSaveCall}
            formatTimestamp={formatFullDate}
          />

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Notes</CardTitle>
              {!showNoteForm && (
                <Button variant="outline" size="sm" onClick={() => setShowNoteForm(true)}>
                  <Plus className="size-3" /> Add Note
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Internal notes only</p>
              {notes.map((n) => (
                <div key={n.id} className="rounded-lg bg-muted p-3 text-sm">
                  <p>{n.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatFullDate(n.at)}</p>
                </div>
              ))}
              {showNoteForm && (
                <div className="space-y-2">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                  />
                  <Button size="sm" onClick={handleSaveNote}>
                    Save Note
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Buyer Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-lg font-semibold text-white">
                  {getInitials(lead.buyerName)}
                </div>
                <div>
                  <p className="font-semibold">{lead.buyerName}</p>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium uppercase',
                      getUserTypeBadgeColor(lead.userType),
                    )}
                  >
                    {lead.userType}
                  </span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{lead.phone}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void copyText(lead.phone, toastApi)}
                >
                  Copy
                </Button>
              </div>
              <p>{lead.email ?? '—'}</p>
              <p className="text-xs text-muted-foreground">
                User type: <span className={cn('rounded-full px-2 py-0.5', getUserTypeBadgeColor(lead.userType))}>{lead.userType}</span>
              </p>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                onClick={() => navigate(profilePath)}
              >
                View Buyer Profile →
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Response SLA (24hrs)</CardTitle>
            </CardHeader>
            <CardContent className="text-center text-sm">
              <div
                className={cn(
                  'mx-auto mb-3 flex size-20 items-center justify-center rounded-full text-lg font-bold',
                  slaStatus === 'ok' && 'bg-green-100 text-green-700',
                  slaStatus === 'warning' && 'bg-amber-100 text-amber-800',
                  slaStatus === 'breached' && 'animate-pulse bg-red-100 text-red-700',
                )}
              >
                {slaStatus === 'breached'
                  ? '!'
                  : `${Math.max(0, Math.round(slaHours))}h`}
              </div>
              <p className="font-medium">
                {slaStatus === 'ok' && `${Math.max(1, Math.round(slaHours))} hours remaining`}
                {slaStatus === 'warning' && `Respond within ${Math.max(1, Math.round(slaHours))} hours`}
                {slaStatus === 'breached' &&
                  `OVERDUE by ${Math.max(1, Math.round(Math.abs(slaHours)))} hours`}
              </p>
              <p className="mt-3 text-left text-xs text-muted-foreground">
                Submitted: {formatFullDate(lead.submittedAt)}
              </p>
              <p className="text-left text-xs text-muted-foreground">
                Deadline: {formatFullDate(lead.slaDeadline)}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                All interior leads must be responded to within 24 hours
              </p>
            </CardContent>
          </Card>

          <SentMessagesCard messages={sentMessages} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activityTimeline.map((a) => (
                <div key={a.id} className="border-l-2 border-primary/30 pl-3 text-sm">
                  <p>{a.text}</p>
                  <p className="text-xs text-muted-foreground">{formatTimeAgo(a.at)}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                type="button"
                className="w-full"
                disabled={isClosedLike}
                onClick={() => quoteRef.current?.scrollIntoView({ behavior: 'smooth' })}
              >
                📤 Send Quote
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setShowCallForm(true)}
              >
                📞 Log Call
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full border-destructive text-destructive"
                disabled={isClosedLike}
                onClick={() => setShowDeclineConfirm(true)}
              >
                ❌ Mark Declined
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {showDeclineConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
            <h3 className="font-semibold">Mark as declined?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              The buyer will be marked as declined for this interior request.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                className="border-destructive text-destructive"
                onClick={() => {
                  handleStatusChange('declined')
                  setShowDeclineConfirm(false)
                  setToast('Lead marked declined')
                }}
              >
                Confirm
              </Button>
              <Button variant="outline" onClick={() => setShowDeclineConfirm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {whatsappOpen && lead && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-50 bg-black/50"
            aria-label="Close"
            onClick={() => setWhatsappOpen(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-xl">
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
                  logInteriorMessage({
                    channel: 'whatsapp',
                    to: lead.phone,
                    toName: lead.buyerName,
                    message: whatsappBody.trim(),
                  })
                  openWhatsApp(lead.phone, whatsappBody.trim())
                  setWhatsappOpen(false)
                  setToast('WhatsApp message sent')
                }}
              >
                Send
              </Button>
            </div>
          </div>
        </>
      )}

      {acceptModal === 'no_designer' && lead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-red-700">❌ No Designer Assigned</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              A designer must be assigned before accepting this interior order.
            </p>
            <p className="mt-4 text-sm font-medium">Assign a designer to proceed:</p>
            <select
              value={modalDesignerId}
              onChange={(e) => setModalDesignerId(e.target.value)}
              className="mt-2 h-9 w-full rounded-md border border-border bg-card px-2 text-sm"
            >
              <option value="">— Select available designer —</option>
              {availableDesigners.map((d) => (
                <option key={d.id} value={d.id} className="text-green-600">
                  {formatDesignerOption(d)}
                </option>
              ))}
            </select>
            <div className="mt-4 flex gap-2">
              <Button type="button" disabled={!modalDesignerId} onClick={handleAssignAndAccept}>
                Assign & Accept
              </Button>
              <Button type="button" variant="outline" onClick={() => setAcceptModal(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {acceptModal === 'unavailable' && lead && assignedDesigner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-orange-700">⚠️ Designer Unavailable</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {assignedDesigner.name} is currently unavailable ({assignedDesigner.activeProjects}{' '}
              active projects)
            </p>

            <div className="mt-4 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <input
                  type="radio"
                  name="unavailable-action"
                  checked={unavailableAction === 'reassign'}
                  onChange={() => setUnavailableAction('reassign')}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Assign a different designer</span>
                  <select
                    value={modalDesignerId}
                    onChange={(e) => setModalDesignerId(e.target.value)}
                    disabled={unavailableAction !== 'reassign'}
                    className="mt-2 h-9 w-full rounded-md border border-border bg-card px-2 text-sm disabled:opacity-50"
                  >
                    <option value="">— Select available designer —</option>
                    {availableDesigners
                      .filter((d) => d.id !== assignedDesigner.id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {formatDesignerOption(d)}
                        </option>
                      ))}
                  </select>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <input
                  type="radio"
                  name="unavailable-action"
                  checked={unavailableAction === 'proceed'}
                  onChange={() => setUnavailableAction('proceed')}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Proceed anyway</span>
                  <p className="mt-1 text-muted-foreground">
                    Accept and notify {assignedDesigner.name} to manage workload
                  </p>
                  {unavailableAction === 'proceed' && (
                    <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                      Designer has {assignedDesigner.activeProjects} active projects. Consider
                      workload before proceeding.
                    </p>
                  )}
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <input
                  type="radio"
                  name="unavailable-action"
                  checked={unavailableAction === 'hold'}
                  onChange={() => setUnavailableAction('hold')}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Put on hold</span>
                  <p className="mt-1 text-muted-foreground">
                    Hold acceptance until designer is available
                  </p>
                </span>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {unavailableAction === 'proceed' ? (
                <Button
                  type="button"
                  className="bg-orange-600 hover:bg-orange-700"
                  onClick={handleUnavailableAcceptAction}
                >
                  Accept Anyway
                </Button>
              ) : unavailableAction === 'hold' ? (
                <Button type="button" variant="outline" onClick={handleUnavailableAcceptAction}>
                  Put on Hold
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={!modalDesignerId}
                  onClick={handleUnavailableAcceptAction}
                >
                  Reassign & Accept
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setAcceptModal(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {emailOpen && lead && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-50 bg-black/50"
            aria-label="Close"
            onClick={() => setEmailOpen(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-xl">
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
                onClick={() => {
                  const to = lead.email ?? 'support@builtglory.com'
                  logInteriorMessage({
                    channel: 'email',
                    to,
                    toName: lead.buyerName,
                    subject: emailSubject,
                    message: emailBody,
                  })
                  openEmail(to, emailSubject, emailBody)
                  setEmailOpen(false)
                  setToast('Email sent')
                }}
              >
                Send
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
