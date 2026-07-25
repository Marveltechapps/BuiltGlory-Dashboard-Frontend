import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  AlertCircle,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  FileText,
  Mail,
  MapPin,
  Phone,
  Plus,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AdminApiError, readAdminSession } from '@/api/admin'
import {
  findDuplicateEnquiryId,
  formatPreferredVisitTimeDisplay,
  getAdminBuyEnquiry,
  getAdminSalesTeam,
  getRoleLabel,
  getSalesPersonById,
  INTEREST_TYPE_LABELS,
  isPreferredVisitTimePassed,
  parseEnquiryPrice,
  PREFERRED_CONTACT_BADGE_CLASS,
  PREFERRED_CONTACT_LABELS,
  updateAdminBuyEnquiry,
  type BuyEnquiry,
  type EnquiryStatus,
  type PreferredContact,
  type SalesPerson,
} from '@/api/adminEnquiries'
import { createAdminSalesDeal, listAdminSalesDeals } from '@/api/adminSales'
import { isValidPhone } from '@/utils/adminActions'
import {
  claimConcurrentEditing,
  getConcurrentEditingWarning,
  releaseConcurrentEditing,
} from '@/utils/edgeCases'

import {
  CallLogPanel,
  type CallLog,
  type CallRecordingPayload,
} from '@/components/admin/CallLogPanel'
import { NegotiationChat } from '@/components/admin/NegotiationChat'
import { SentMessagesCard } from '@/components/admin/SentMessagesCard'
import NotificationPreview from '@/components/NotificationPreview'
import { cn } from '@/lib/utils'
import { bindToast, copyText, handleCall } from '@/utils/adminActions'
import {
  DEFAULT_SENT_BY,
  loadMessages,
  logMessage,
  messageToActivityText,
  openEmail,
  openWhatsApp,
  type SentMessage,
} from '@/utils/messageLog'
import { NOTIFICATION_TEMPLATES, sendPushNotification } from '@/utils/notifications'

type CallOutcome =
  | 'Interested'
  | 'Not Interested'
  | 'Callback Later'
  | 'No Answer'
  | 'Wrong Number'

interface ActivityItem {
  id: string
  type: 'submitted' | 'call' | 'note' | 'status'
  text: string
  at: string
}

interface Note {
  id: string
  text: string
  at: string
}

const STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: 'New',
  responded: 'Responded',
  visit_scheduled: 'Visit Scheduled',
  negotiating: 'Negotiating',
  closed: 'Closed',
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

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

function formatFullDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function StatusBadge({ status }: { status: EnquiryStatus }) {
  const config: Record<
    EnquiryStatus,
    { variant?: 'new' | 'responded' | 'pending' | 'default'; className?: string }
  > = {
    new: { variant: 'new' },
    responded: { variant: 'responded' },
    visit_scheduled: { className: 'bg-purple-100 text-purple-700' },
    negotiating: { variant: 'pending' },
    closed: { variant: 'default' },
  }
  const { variant, className } = config[status]
  return (
    <Badge variant={variant} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

function phoneDigits(phone: string) {
  return phone.replace(/\D/g, '')
}

function buildScheduleVisitUrl(enquiry: BuyEnquiry): string {
  const params = new URLSearchParams({ prefill: '1' })
  if (enquiry.buyerId) params.set('buyerId', enquiry.buyerId)
  params.set('buyerName', enquiry.buyerName)
  if (enquiry.phone.trim()) params.set('phone', enquiry.phone)
  params.set('propertyId', enquiry.propertyId)
  if (enquiry.preferredVisitDate) params.set('date', enquiry.preferredVisitDate)
  if (enquiry.preferredVisitTimeSlot) params.set('time', enquiry.preferredVisitTimeSlot)
  return `/admin/enquiries/visits?${params.toString()}`
}

function buildPropertyDetailsMessage(
  enquiry: BuyEnquiry,
  reraNumber?: string,
  floorPlanNote?: string,
) {
  return (
    `Hi ${enquiry.buyerName},\n\n` +
    `Property details for *${enquiry.propertyTitle}*:\n\n` +
    `Price: ${enquiry.propertyPrice}\n` +
    `Type: ${enquiry.propertyType}\n` +
    `Location: ${enquiry.propertyLocation}\n` +
    `RERA: ${reraNumber ?? 'Available on request'}\n\n` +
    `Photos & listing: Builtglory app\n` +
    `Floor plan: ${floorPlanNote ?? 'Available on request'}\n\n` +
    `Regards,\nTeam Builtglory`
  )
}

function PreferredContactAction({
  contact,
  enquiry,
  hasValidPhone,
  hasEmail,
  onWhatsApp,
  onEmail,
}: {
  contact: PreferredContact
  enquiry: BuyEnquiry
  hasValidPhone: boolean
  hasEmail: boolean
  onWhatsApp: () => void
  onEmail: () => void
}) {
  if (contact === 'whatsapp') {
    return (
      <Button
        variant="outline"
        size="sm"
        className="border-green-300 text-green-700 hover:bg-green-50"
        disabled={!hasValidPhone}
        onClick={onWhatsApp}
      >
        Contact via WhatsApp
      </Button>
    )
  }
  if (contact === 'phone') {
    return (
      <Button
        variant="outline"
        size="sm"
        className="border-blue-300 text-blue-700 hover:bg-blue-50"
        disabled={!hasValidPhone}
        onClick={() => handleCall(enquiry.phone)}
      >
        Call Now
      </Button>
    )
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="border-orange-300 text-orange-700 hover:bg-orange-50"
      disabled={!hasEmail}
      onClick={onEmail}
    >
      Send Email
    </Button>
  )
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[800px] space-y-6 px-4 py-6">
      <div className="h-4 w-64 animate-pulse rounded bg-muted" />
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-4 p-5">
                <div className="h-48 animate-pulse rounded-lg bg-muted" />
                <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="space-y-6 lg:col-span-2">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-4 p-5">
                <div className="size-16 animate-pulse rounded-full bg-muted" />
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

function Breadcrumb({ buyerName, navigate }: { buyerName: string; navigate: ReturnType<typeof useNavigate> }) {
  const items = [
    { label: 'Enquiries', path: '/admin/enquiries/buy' },
    { label: 'Buy Enquiries', path: '/admin/enquiries/buy' },
    { label: buyerName, path: null },
  ]

  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Breadcrumb">
      <Button
        variant="ghost"
        size="icon"
        className="mr-1 size-8 shrink-0"
        onClick={() => navigate(-1)}
        aria-label="Back"
      >
        <ChevronLeft className="size-4" />
      </Button>
      {items.map((item, index) => (
        <span key={item.label} className="flex items-center gap-1">
          {index > 0 && <ChevronRight className="size-4 text-muted-foreground" />}
          {item.path ? (
            <button
              type="button"
              onClick={() => navigate(item.path!)}
              className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </button>
          ) : (
            <span className="font-medium text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function EnquiryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [enquiry, setEnquiry] = useState<BuyEnquiry | null>(null)
  const [salesTeam, setSalesTeam] = useState<SalesPerson[]>([])
  const [status, setStatus] = useState<EnquiryStatus>('new')
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [showCallForm, setShowCallForm] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [callDuration, setCallDuration] = useState('')
  const [callOutcome, setCallOutcome] = useState<CallOutcome>('Interested')
  const [callNotes, setCallNotes] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [noteText, setNoteText] = useState('')
  const [whatsappOpen, setWhatsappOpen] = useState(false)
  const [whatsappBody, setWhatsappBody] = useState('')
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([])
  const [editingWarning, setEditingWarning] = useState<string | null>(null)
  const [editingDismissed, setEditingDismissed] = useState(false)
  const [showNegotiation, setShowNegotiation] = useState(false)
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const [reassignOpen, setReassignOpen] = useState(false)
  const toastApi = useMemo(() => bindToast(setToast), [])

  const duplicateOfId = useMemo(
    () => (enquiry ? enquiry.duplicateOf || findDuplicateEnquiryId(enquiry, []) : null),
    [enquiry],
  )

  const assignedSalesPerson = useMemo(
    () => getSalesPersonById(assignedTo, salesTeam),
    [assignedTo, salesTeam],
  )

  useEffect(() => {
    if (!id || loading) return
    setEditingWarning(getConcurrentEditingWarning('enquiry', id))
    setEditingDismissed(false)
    claimConcurrentEditing('enquiry', id)
    return () => releaseConcurrentEditing('enquiry', id)
  }, [id, loading])

  const loadEnquiry = useCallback(async () => {
    const session = readAdminSession()
    if (!id || !session?.accessToken) {
      setLoadError('Your admin session has expired. Please log in again.')
      setEnquiry(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)
    try {
      const [found, team] = await Promise.all([
        getAdminBuyEnquiry(session.accessToken, id),
        getAdminSalesTeam(session.accessToken),
      ])
      setEnquiry(found)
      setSalesTeam(team)
      setStatus(found.status)
      setAssignedTo(found.assignedTo)
      setReassignOpen(false)
      setActivities([
        {
          id: 'submitted',
          type: 'submitted',
          text: 'Enquiry submitted via app',
          at: found.submittedAt,
        },
      ])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load enquiry.')
      setEnquiry(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadEnquiry()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadEnquiry])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  const addActivity = useCallback((item: Omit<ActivityItem, 'id'> & { id?: string }) => {
    setActivities((prev) => [
      { id: item.id ?? `act-${Date.now()}`, type: item.type, text: item.text, at: item.at },
      ...prev,
    ])
  }, [])

  const handleAssignSalesPerson = useCallback(
    async (salesPersonId: string) => {
      const session = readAdminSession()
      const person = getSalesPersonById(salesPersonId, salesTeam)
      if (!person || !enquiry) return
      if (!session?.accessToken) {
        setToast('Your admin session has expired. Please log in again.')
        return
      }

      setSaving(true)
      try {
        const updated = await updateAdminBuyEnquiry(session.accessToken, enquiry.id, {
          assignedTo: salesPersonId,
        })
        setAssignedTo(updated.assignedTo)
        setEnquiry(updated)
        setReassignOpen(false)
        addActivity({
          type: 'status',
          text: `Assigned to ${person.name} (${getRoleLabel(person.role)})`,
          at: new Date().toISOString(),
        })
        setToast(`Enquiry assigned to ${person.name}`)
      } catch (error) {
        setToast(error instanceof Error ? error.message : 'Unable to assign enquiry')
      } finally {
        setSaving(false)
      }
    },
    [enquiry, salesTeam, addActivity],
  )

  const refreshSentMessages = useCallback(() => {
    if (enquiry) void loadMessages('enquiry', enquiry.id).then(setSentMessages)
  }, [enquiry])

  useEffect(() => {
    refreshSentMessages()
  }, [refreshSentMessages])

  const activityTimeline = useMemo(() => {
    const fromMessages = sentMessages.map((m) => ({
      id: m.id,
      type: 'note' as const,
      text: messageToActivityText(m),
      at: m.sentAt,
    }))
    return [...fromMessages, ...activities].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    )
  }, [activities, sentMessages])

  const logEnquiryMessage = useCallback(
    (msg: Omit<SentMessage, 'id' | 'sentAt' | 'relatedTo' | 'sentBy'>) => {
      if (!enquiry) return
      logMessage({
        ...msg,
        sentBy: DEFAULT_SENT_BY,
        relatedTo: {
          type: 'enquiry',
          id: enquiry.id,
          title: enquiry.propertyTitle,
        },
      })
      refreshSentMessages()
    },
    [enquiry, addActivity, refreshSentMessages],
  )

  const handleStatusChange = useCallback(
    async (next: EnquiryStatus) => {
      const session = readAdminSession()
      if (!enquiry || !session?.accessToken) {
        setToast('Your admin session has expired. Please log in again.')
        return
      }

      setSaving(true)
      try {
        const updated = await updateAdminBuyEnquiry(session.accessToken, enquiry.id, { status: next })
        setStatus(updated.status)
        setEnquiry(updated)
        if (updated.status === 'responded') {
          const template = NOTIFICATION_TEMPLATES.N02_ENQUIRY_RESPONDED(
            updated.buyerName,
            updated.propertyTitle,
          )
          sendPushNotification(updated.buyerName, template, 'N-02', {
            dedupeKey: `N-02:${updated.id}`,
            audience: 'buyer',
            userId: updated.buyerId,
            relatedTo: { type: 'enquiry', id: updated.id },
          })
          setToast('Response recorded. Buyer notified via N-02.')
        }
        addActivity({
          type: 'status',
          text: `Status changed to ${STATUS_LABELS[updated.status]}`,
          at: new Date().toISOString(),
        })
      } catch (error) {
        setToast(error instanceof AdminApiError ? error.message : 'Unable to update enquiry status')
      } finally {
        setSaving(false)
      }
    },
    [enquiry, addActivity],
  )

  const handleMoveToSalesPipeline = useCallback(async () => {
    const session = readAdminSession()
    if (!enquiry || !session?.accessToken) {
      setToast('Your admin session has expired. Please log in again.')
      return
    }

    setSaving(true)
    try {
      const existing = await listAdminSalesDeals(session.accessToken, {
        sourceEnquiryId: enquiry.id,
        limit: 1,
      })
      const existingDeal = existing.data[0]
      if (existingDeal) {
        navigate(`/admin/sales/${existingDeal.id}`)
        return
      }

      const propertyPrice = parseEnquiryPrice(enquiry.propertyPrice)
      const deal = await createAdminSalesDeal(session.accessToken, {
        buyerId: enquiry.buyerId,
        propertyId: enquiry.propertyId,
        sourceEnquiryId: enquiry.id,
        stage: 'active_leads',
        priority: isPreferredVisitTimePassed(enquiry) ? 'high' : 'normal',
        assignedTo,
        buyerSnapshot: {
          name: enquiry.buyerName,
          phone: enquiry.phone,
          email: enquiry.email,
          userType: enquiry.userType,
        },
        propertySnapshot: {
          title: enquiry.propertyTitle,
          type: enquiry.propertyType,
          location: enquiry.propertyLocation,
          price: propertyPrice,
        },
        financials: {
          offeredPrice: propertyPrice || null,
        },
      })
      setToast('Sales deal created.')
      navigate(`/admin/sales/${deal.id}`)
    } catch (error) {
      setToast(error instanceof AdminApiError ? error.message : 'Unable to move enquiry to sales pipeline')
    } finally {
      setSaving(false)
    }
  }, [assignedTo, enquiry, navigate])

  const handleCopyPhone = () => {
    if (!enquiry) return
    void copyText(enquiry.phone, toastApi)
  }

  const handleSaveCall = (recording?: CallRecordingPayload) => {
    const duration = parseInt(callDuration, 10) || 0
    const log: CallLog = {
      id: `call-${Date.now()}`,
      duration,
      outcome: callOutcome,
      notes: callNotes,
      followUpDate: followUpDate || undefined,
      at: new Date().toISOString(),
      ...(recording && {
        recordingUrl: recording.url,
        recordingFileName: recording.fileName,
        recordingSize: recording.size,
      }),
    }
    setCallLogs((prev) => [log, ...prev])
    addActivity({
      id: log.id,
      type: 'call',
      text: `Call logged — ${callOutcome} (${duration} min)`,
      at: log.at,
    })
    setShowCallForm(false)
    setCallDuration('')
    setCallNotes('')
    setFollowUpDate('')
  }

  const handleSaveNote = () => {
    if (!noteText.trim()) return
    const note: Note = {
      id: `note-${Date.now()}`,
      text: noteText.trim(),
      at: new Date().toISOString(),
    }
    setNotes((prev) => [note, ...prev])
    addActivity({
      id: note.id,
      type: 'note',
      text: `Note added: ${note.text.slice(0, 60)}${note.text.length > 60 ? '…' : ''}`,
      at: note.at,
    })
    setNoteText('')
    setShowNoteForm(false)
  }

  const handleDeleteNote = (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
  }

  const handleMarkNotInterested = () => {
    void handleStatusChange('closed')
    setShowConfirmClose(false)
  }

  if (loading) return <DetailSkeleton />

  if (!enquiry || loadError) {
    return (
      <div className="mx-auto flex max-w-[800px] flex-col items-center justify-center px-4 py-24 text-center">
        <AlertCircle className="mb-4 size-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">{loadError ? 'Could not load enquiry' : 'Enquiry not found'}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {loadError ?? 'The enquiry you are looking for does not exist.'}
        </p>
        <div className="mt-6 flex gap-2">
          {loadError && <Button onClick={() => void loadEnquiry()}>Retry</Button>}
          <Button variant="outline" onClick={() => navigate('/admin/enquiries/buy')}>
            Back to Buy Enquiries
          </Button>
        </div>
      </div>
    )
  }

  const hasEmail = Boolean(enquiry.email?.trim())
  const propertySold = false
  const validPhone = isValidPhone(enquiry.phone) && phoneDigits(enquiry.phone).length > 0
  const visitTimePassed = isPreferredVisitTimePassed(enquiry)
  const preferredVisitLabel = formatPreferredVisitTimeDisplay(enquiry)
  const scheduleVisitUrl = buildScheduleVisitUrl(enquiry)
  const whatsappNoPhone =
    enquiry.preferredContact === 'whatsapp' && !validPhone
  const reraNumber = undefined
  const floorPlanNote = 'Available on property page when uploaded'

  const openPreferredWhatsApp = () => {
    setWhatsappBody(
      `Hi ${enquiry.buyerName}, regarding your enquiry for ${enquiry.propertyTitle}.`,
    )
    setWhatsappOpen(true)
  }

  const openPreferredEmail = () => {
    setEmailSubject(`BuiltGlory — ${enquiry.propertyTitle}`)
    setEmailBody(
      `Hi ${enquiry.buyerName},\n\nThank you for your enquiry on ${enquiry.propertyTitle}.`,
    )
    setEmailOpen(true)
  }

  const sendPropertyDetails = () => {
    const body = buildPropertyDetailsMessage(enquiry, reraNumber, floorPlanNote)
    if (enquiry.preferredContact === 'email' && hasEmail) {
      setEmailSubject(`Property details — ${enquiry.propertyTitle}`)
      setEmailBody(body)
      setEmailOpen(true)
      return
    }
    if (validPhone) {
      logEnquiryMessage({
        channel: 'whatsapp',
        to: enquiry.phone,
        toName: enquiry.buyerName,
        message: body,
      })
      openWhatsApp(enquiry.phone, body)
      setToast('Property details sent via WhatsApp')
      return
    }
    if (hasEmail) {
      setEmailSubject(`Property details — ${enquiry.propertyTitle}`)
      setEmailBody(body)
      setEmailOpen(true)
      return
    }
    setToast('No contact method available')
  }
  const outcomeBadgeClass = (outcome: CallOutcome) => {
    if (outcome === 'Interested') return 'bg-green-100 text-green-700'
    if (outcome === 'Not Interested') return 'bg-red-100 text-red-700'
    return 'bg-muted text-muted-foreground'
  }

  const activityDotClass = (type: ActivityItem['type']) => {
    if (type === 'call' || type === 'note' || type === 'status') return 'bg-green-500'
    if (type === 'submitted') return 'bg-primary'
    return 'bg-muted-foreground'
  }

  return (
    <div className="mx-auto max-w-[800px] px-4 py-6">
      {editingWarning && !editingDismissed && (
        <div className="mb-4 flex items-start justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2">
          <p className="text-sm text-amber-900">
            ⚠️ {editingWarning}
            <span className="mt-0.5 block text-xs">Another admin may be viewing this record</span>
          </p>
          <button type="button" onClick={() => setEditingDismissed(true)} aria-label="Dismiss">
            <X className="size-4 text-amber-800" />
          </button>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg bg-foreground px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {showConfirmClose && (
        <>
          <button
            type="button"
            aria-label="Close dialog"
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setShowConfirmClose(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Mark as not interested?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This will close the enquiry. You can change the status later if needed.
            </p>
            <div className="mt-6 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowConfirmClose(false)}>
                Cancel
              </Button>
              <Button variant="destructive" className="flex-1" onClick={handleMarkNotInterested}>
                Confirm
              </Button>
            </div>
          </div>
        </>
      )}

      <Breadcrumb buyerName={enquiry.buyerName} navigate={navigate} />

      {propertySold && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span>⚠️ This property has been sold</span>
          <Button
            size="sm"
            variant="outline"
            className="border-red-300"
            disabled={!validPhone}
            title={validPhone ? undefined : 'Invalid phone'}
            onClick={() => {
              const msg = `Hi ${enquiry.buyerName}, the property you enquired about (${enquiry.propertyTitle}) has been sold. We can suggest similar listings.`
              openWhatsApp(enquiry.phone, msg)
              setToast('WhatsApp opened to notify buyer')
            }}
          >
            Notify Buyer
          </Button>
        </div>
      )}

      <header className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{enquiry.buyerName}</h1>
          <p className="text-sm text-muted-foreground">{enquiry.referenceId}</p>
          {duplicateOfId && (
            <p className="mt-1 text-sm">
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                Duplicate enquiry
              </span>{' '}
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => navigate(`/admin/enquiries/buy/${duplicateOfId}`)}
              >
                View original →
              </button>
            </p>
          )}
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <StatusBadge status={status} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!validPhone}
              title={validPhone ? undefined : 'Invalid phone'}
              onClick={() => handleCall(enquiry.phone)}
            >
              <Phone className="size-4" /> Call
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-green-600 hover:bg-green-50"
              disabled={!validPhone}
              title={validPhone ? undefined : 'Invalid phone'}
              onClick={() => {
                setWhatsappBody(
                  `Hi ${enquiry.buyerName}, regarding your enquiry for ${enquiry.propertyTitle}.`,
                )
                setWhatsappOpen(true)
              }}
            >
              WhatsApp
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasEmail}
              title={hasEmail ? undefined : 'Email not provided'}
              className={cn(!hasEmail && 'opacity-50')}
              onClick={() => {
                setEmailSubject(`BuiltGlory — ${enquiry.propertyTitle}`)
                setEmailBody(
                  `Hi ${enquiry.buyerName},\n\nThank you for your enquiry on ${enquiry.propertyTitle}.`,
                )
                setEmailOpen(true)
              }}
            >
              <Mail className="size-4" /> Email
            </Button>
            <select
              value={status}
              disabled={saving}
              onChange={(e) => void handleStatusChange(e.target.value as EnquiryStatus)}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-primary"
              aria-label="Change status"
            >
              <option value="new">New</option>
              <option value="responded">Responded</option>
              <option value="visit_scheduled">Visit Scheduled</option>
              <option value="negotiating">Negotiating</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
      </header>

      <hr className="my-6 border-border" />

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left column 60% */}
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Property Interested In</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex h-48 items-center justify-center rounded-lg bg-muted">
                <Building2 className="size-12 text-muted-foreground/50" />
              </div>
              <h3 className="text-lg font-semibold">{enquiry.propertyTitle}</h3>
              <p className="text-xl font-bold text-primary">{enquiry.propertyPrice}</p>
              <Badge variant="default">{enquiry.propertyType}</Badge>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="size-4 shrink-0" />
                {enquiry.propertyLocation}
              </p>
              <button
                type="button"
                onClick={() => navigate(`/admin/properties/${enquiry.propertyId}`)}
                className="text-sm font-medium text-primary hover:underline"
              >
                View Property Page →
              </button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Enquiry Details</CardTitle>
              <p className="text-xs text-muted-foreground">📱 App screen: B-10</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  Preferred Contact
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium',
                      PREFERRED_CONTACT_BADGE_CLASS[enquiry.preferredContact],
                    )}
                  >
                    {PREFERRED_CONTACT_LABELS[enquiry.preferredContact]}
                  </span>
                  <PreferredContactAction
                    contact={enquiry.preferredContact}
                    enquiry={enquiry}
                    hasValidPhone={validPhone}
                    hasEmail={hasEmail}
                    onWhatsApp={openPreferredWhatsApp}
                    onEmail={openPreferredEmail}
                  />
                </div>
                {whatsappNoPhone && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    No phone for WhatsApp.{' '}
                    {hasEmail ? (
                      <button
                        type="button"
                        className="font-medium text-primary underline"
                        onClick={openPreferredEmail}
                      >
                        Offer Email instead
                      </button>
                    ) : (
                      'Add buyer phone or use another channel.'
                    )}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  Interested In
                </p>
                <p className="text-sm font-medium">{INTEREST_TYPE_LABELS[enquiry.interestType]}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {enquiry.interestType === 'schedule_visit' && (
                    <>
                      <Button size="sm" onClick={() => navigate(scheduleVisitUrl)}>
                        Create Visit
                      </Button>
                      {propertySold && (
                        <div className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                          ⚠️ Property no longer available
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-2 border-red-300"
                            onClick={() => {
                              const msg = `Hi ${enquiry.buyerName}, ${enquiry.propertyTitle} is no longer available. We can share similar properties on Builtglory.`
                              if (validPhone) openWhatsApp(enquiry.phone, msg)
                              else if (hasEmail) openEmail(enquiry.email!, 'Similar properties', msg)
                            }}
                          >
                            Show similar properties
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                  {enquiry.interestType === 'price_negotiation' && (
                    <Button size="sm" onClick={() => setShowNegotiation(true)}>
                      Start Negotiation
                    </Button>
                  )}
                  {enquiry.interestType === 'more_details' && (
                    <Button size="sm" variant="outline" onClick={sendPropertyDetails}>
                      Send Details
                    </Button>
                  )}
                </div>
              </div>

              {enquiry.interestType === 'schedule_visit' && preferredVisitLabel && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                    Preferred Visit Time
                  </p>
                  <p className="flex items-center gap-2 text-sm">
                    <Calendar className="size-4 text-muted-foreground" />
                    {preferredVisitLabel}
                  </p>
                  {visitTimePassed && (
                    <p className="mt-2 text-sm text-orange-700">
                      Preferred time has passed — ask buyer for new availability.
                    </p>
                  )}
                  <Button className="mt-3" size="sm" onClick={() => navigate(scheduleVisitUrl)}>
                    Schedule Visit
                  </Button>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  Message from Buyer
                </p>
                {enquiry.additionalMessage?.trim() ? (
                  <p className="rounded-lg bg-muted p-3 text-sm italic">
                    {enquiry.additionalMessage}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No additional message</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant="default">Source: App</Badge>
                <span className="text-muted-foreground">
                  Submitted: {formatFullDate(enquiry.submittedAt)}
                </span>
              </div>
            </CardContent>
          </Card>

          {showNegotiation && enquiry.interestType === 'price_negotiation' && (
            <NegotiationChat
              entityType="deal"
              entityId={enquiry.id}
              entityTitle={enquiry.propertyTitle}
              currentPrice={parseEnquiryPrice(enquiry.propertyPrice)}
              otherPartyName={enquiry.buyerName}
              otherPartyPhone={enquiry.phone}
              otherPartyType="buyer"
              toast={setToast}
            />
          )}

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
            followUpDate={followUpDate}
            onFollowUpDateChange={setFollowUpDate}
            onSave={handleSaveCall}
            formatTimestamp={formatFullDate}
            outcomeBadgeClass={(outcome) => outcomeBadgeClass(outcome as CallOutcome)}
          />

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Notes</CardTitle>
              {!showNoteForm && (
                <Button variant="outline" size="sm" onClick={() => setShowNoteForm(true)}>
                  <Plus className="size-3" /> Add Note
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {notes.length === 0 && !showNoteForm && (
                <div className="flex flex-col items-center py-8 text-center">
                  <FileText className="mb-3 size-10 text-muted-foreground/40" />
                  <p className="font-medium">No notes yet</p>
                </div>
              )}
              {notes.map((note) => (
                <div key={note.id} className="flex items-start justify-between gap-2 rounded-lg bg-muted p-3">
                  <div>
                    <p className="text-sm">{note.text}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatFullDate(note.at)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteNote(note.id)}
                    aria-label="Delete note"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              {showNoteForm && (
                <div className="space-y-3">
                  <textarea
                    rows={4}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add a note..."
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveNote}>
                      Save Note
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowNoteForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column 40% */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Assign To</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {assignedSalesPerson && !reassignOpen ? (
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-600 text-sm font-semibold text-white">
                      {getInitials(assignedSalesPerson.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold">{assignedSalesPerson.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {getRoleLabel(assignedSalesPerson.role)}
                      </p>
                      <p className="text-sm text-muted-foreground">{assignedSalesPerson.phone}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleCall(assignedSalesPerson.phone)}
                    >
                      <Phone className="size-4" /> Call {assignedSalesPerson.name.split(' ')[0]}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-green-300 text-green-700 hover:bg-green-50"
                      onClick={() =>
                        window.open(
                          `https://wa.me/${phoneDigits(assignedSalesPerson.phone)}`,
                          '_blank',
                        )
                      }
                    >
                      💬 WhatsApp {assignedSalesPerson.name.split(' ')[0]}
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="mt-3 text-sm font-medium text-primary hover:underline"
                    onClick={() => setReassignOpen(true)}
                  >
                    Reassign
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="block text-sm">
                    Sales team member
                    <select
                      className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) handleAssignSalesPerson(e.target.value)
                      }}
                    >
                      <option value="" disabled>
                        Select sales person…
                      </option>
                      {salesTeam.map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name} · {getRoleLabel(sp.role)} · {sp.activeEnquiries} enquiries
                          {sp.activeEnquiries > 10 ? ' (Busy)' : ''} · {sp.assignedArea.join(', ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  {reassignOpen && (
                    <button
                      type="button"
                      className="text-sm text-muted-foreground hover:underline"
                      onClick={() => setReassignOpen(false)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Buyer Info</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center text-center sm:items-start sm:text-left">
              <div className="mb-4 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-2xl font-semibold text-white">
                {getInitials(enquiry.buyerName)}
              </div>
              <p className="text-lg font-semibold">{enquiry.buyerName}</p>
              <Badge variant="default" className="mt-2">
                {enquiry.userType}
              </Badge>
              <button
                type="button"
                onClick={handleCopyPhone}
                className="mt-4 text-sm text-muted-foreground hover:text-primary"
              >
                {enquiry.phone}
              </button>
              <p className={cn('mt-1 text-sm', !hasEmail && 'italic text-muted-foreground')}>
                {enquiry.email ?? 'Not provided'}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (enquiry.buyerId) navigate(`/admin/users/${enquiry.buyerId}`)
                }}
                className="mt-4 text-sm font-medium text-primary hover:underline"
              >
                View Buyer Profile →
              </button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-4 border-l-2 border-border pl-4">
                {activityTimeline.map((item) => (
                  <li key={item.id} className="relative">
                    <span
                      className={cn(
                        'absolute -left-[21px] top-1.5 size-2.5 rounded-full',
                        activityDotClass(item.type),
                      )}
                    />
                    <p className="text-sm">{item.text}</p>
                    <p className="text-xs text-muted-foreground">{formatTimeAgo(item.at)}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <SentMessagesCard messages={sentMessages} />

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {enquiry.interestType === 'schedule_visit' && (
                <>
                  <Button className="w-full" onClick={() => navigate(scheduleVisitUrl)}>
                    📅 Schedule Visit
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full border-green-300 text-green-700"
                    disabled={!validPhone}
                    onClick={openPreferredWhatsApp}
                  >
                    💬 WhatsApp
                  </Button>
                </>
              )}
              {enquiry.interestType === 'price_negotiation' && (
                <>
                  <Button className="w-full" onClick={() => setShowNegotiation(true)}>
                    💬 Start Negotiation
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!validPhone}
                    onClick={() => handleCall(enquiry.phone)}
                  >
                    📞 Call
                  </Button>
                </>
              )}
              {enquiry.interestType === 'more_details' && (
                <>
                  <Button className="w-full" onClick={sendPropertyDetails}>
                    📧 Send Property Details
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!validPhone}
                    onClick={() => handleCall(enquiry.phone)}
                  >
                    📞 Call
                  </Button>
                </>
              )}
              <Button variant="outline" className="w-full" disabled={saving} onClick={() => void handleMoveToSalesPipeline()}>
                Move to Sales Pipeline
              </Button>
              <Button variant="outline" className="w-full" disabled={saving} onClick={() => void handleStatusChange('responded')}>
                Mark as Responded
              </Button>
              {status !== 'responded' && (
                <NotificationPreview
                  notificationId="N-02"
                  title={NOTIFICATION_TEMPLATES.N02_ENQUIRY_RESPONDED(
                    enquiry.buyerName,
                    enquiry.propertyTitle,
                  ).title}
                  body={NOTIFICATION_TEMPLATES.N02_ENQUIRY_RESPONDED(
                    enquiry.buyerName,
                    enquiry.propertyTitle,
                  ).body}
                  deepLink="P-08"
                  className="mt-2"
                />
              )}
              <Button
                variant="outline"
                className="w-full border-destructive text-destructive hover:bg-destructive/10"
                onClick={() => setShowConfirmClose(true)}
              >
                Mark Not Interested
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {whatsappOpen && enquiry && (
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
                  logEnquiryMessage({
                    channel: 'whatsapp',
                    to: enquiry.phone,
                    toName: enquiry.buyerName,
                    message: whatsappBody.trim(),
                  })
                  openWhatsApp(enquiry.phone, whatsappBody.trim())
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

      {emailOpen && enquiry && (
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
                disabled={!enquiry.email}
                onClick={() => {
                  if (!enquiry.email) return
                  logEnquiryMessage({
                    channel: 'email',
                    to: enquiry.email,
                    toName: enquiry.buyerName,
                    subject: emailSubject,
                    message: emailBody,
                  })
                  openEmail(enquiry.email, emailSubject, emailBody)
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
