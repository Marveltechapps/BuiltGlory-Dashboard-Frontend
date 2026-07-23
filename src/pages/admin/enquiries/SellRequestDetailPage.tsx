import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Heart,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  X,
} from 'lucide-react'
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import {
  CallLogPanel,
  type CallLog,
  type CallRecordingPayload,
} from '@/components/admin/CallLogPanel'
import { NegotiationChat } from '@/components/admin/NegotiationChat'
import {
  formatPrice,
  getAdminSalesTeam,
  getAdminSellRequest,
  getCompletenessColor,
  getMissingItems,
  getSalesPersonById,
  getSimilarProperties,
  parseSellAskingPrice,
  reviewAdminSellRequest,
  updateAdminSellRequest,
  type SalesPerson,
  type SellRequest,
  type SellRequestStatus,
} from '@/api/adminEnquiries'
import {
  createAdminCommunicationLog,
  listAdminCommunicationTimeline,
  type CommunicationLog as AdminCommunicationLog,
} from '@/api/adminCommunicationLogs'
import { createAdminAcquisitionFromSellRequest } from '@/api/adminAcquisitions'
import { readAdminSession } from '@/api/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import NotificationPreview from '@/components/NotificationPreview'
import { cn } from '@/lib/utils'
import {
  buildRequestDetailsMessage,
  countMissingTypeFields,
  renderFieldGroups,
} from '@/utils/propertyFieldConfig'
import {
  claimConcurrentEditing,
  getConcurrentEditingWarning,
  releaseConcurrentEditing,
} from '@/utils/edgeCases'
import {
  bindToast,
  copyText,
  handleCall,
  handleEmail,
  openWhatsApp as openWhatsAppQuick,
} from '@/utils/adminActions'
import { openWhatsApp } from '@/utils/messageLog'
import {
  NOTIFICATION_TEMPLATES,
  sendPushNotification,
  type NotificationTemplate,
} from '@/utils/notifications'
import { ListingPreviewModal } from './ListingPreviewModal'

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

const REJECT_REASONS = [
  'Price too high',
  'Property condition poor',
  'Location not suitable',
  'Incomplete information',
  'Duplicate listing',
  'Other',
]

const STATUS_LABELS: Record<SellRequestStatus, string> = {
  draft: 'Draft',
  new: 'New',
  under_review: 'Under Review',
  accepted: 'Accepted',
  approved: 'Approved',
  active: 'Active',
  negotiating: 'Negotiating',
  paused: 'Paused',
  sold: 'Sold',
  rejected: 'Rejected',
  changes_requested: 'Changes Requested',
}

const PAUSE_REASONS = [
  'Price review',
  'Property not available temporarily',
  'Seller request',
  'Admin review required',
]

function renderStaticFieldGrid(
  screenId: string,
  title: string,
  rows: { label: string; value: string | null | undefined }[],
) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          📱 {screenId}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/30 p-3">
        {rows.map((row) => (
          <div key={row.label}>
            <p className="text-xs text-muted-foreground">{row.label}</p>
            <p className="mt-0.5 text-sm font-medium">
              {row.value?.trim() ? (
                row.value
              ) : (
                <span className="text-xs italic text-muted-foreground">Not provided</span>
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

const AMENITY_OPTIONS = [
  'Parking',
  'Lift',
  'Security',
  'Power Backup',
  'Swimming Pool',
  'Garden',
  'Clubhouse',
  'Gym',
]

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
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  return `${Math.floor(hours / 24)} days ago`
}

function formatFullDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function callLogFromCommunication(log: AdminCommunicationLog): CallLog {
  const attachment = log.attachments[0]
  return {
    id: log.id,
    duration: log.durationMinutes ?? 0,
    outcome: log.outcome || log.summary || 'Logged call',
    notes: log.body || '',
    at: log.occurredAt,
    followUpDate: log.followUpAt?.slice(0, 10),
    ...(attachment && {
      recordingUrl: attachment.url,
      recordingFileName: attachment.fileName,
      recordingSize: attachment.sizeBytes,
    }),
  }
}

function noteFromCommunication(log: AdminCommunicationLog): Note {
  return {
    id: log.id,
    text: log.body || log.summary,
    at: log.occurredAt,
  }
}

function StatusBadge({ status }: { status: SellRequestStatus }) {
  const styles: Record<SellRequestStatus, { variant?: 'new' | 'default' | 'red'; className?: string }> = {
    draft: { className: 'bg-orange-100 text-orange-800' },
    new: { variant: 'new' },
    under_review: { className: 'bg-purple-100 text-purple-700' },
    accepted: { className: 'bg-green-100 text-green-700' },
    approved: { className: 'bg-green-100 text-green-700' },
    active: { className: 'bg-green-100 text-green-700' },
    negotiating: { className: 'bg-blue-100 text-blue-800' },
    paused: { className: 'bg-orange-100 text-orange-800' },
    sold: { className: 'bg-gray-800 text-white' },
    rejected: { variant: 'red' },
    changes_requested: { className: 'bg-orange-100 text-orange-700' },
  }
  const s = styles[status]
  return (
    <Badge variant={s.variant} className={s.className}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

function Breadcrumb({ title, navigate }: { title: string; navigate: ReturnType<typeof useNavigate> }) {
  const items = [
    { label: 'Enquiries', path: '/admin/enquiries/sell' },
    { label: 'Sell Requests', path: '/admin/enquiries/sell' },
    { label: title, path: null },
  ]
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Breadcrumb">
      <Button
        variant="ghost"
        size="icon"
        className="mr-1 size-8"
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
              className="text-muted-foreground hover:text-foreground"
            >
              {item.label}
            </button>
          ) : (
            <span className="line-clamp-1 max-w-[200px] font-medium text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

function ListingAnalyticsCard({
  request,
  navigate,
}: {
  request: SellRequest
  navigate: ReturnType<typeof useNavigate>
}) {
  const views = request.views ?? 0
  const chartData = (request.viewsThisWeek ?? [12, 8, 15, 22, 18, 9, 14]).map((v, i) => ({
    day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
    views: v,
  }))
  const perf =
    views > 100 ? '🔥 High Interest' : views >= 50 ? '📈 Good Interest' : '👀 Low Visibility'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Listing Analytics</CardTitle>
        <p className="text-xs text-muted-foreground">📱 App screen: SL-13</p>
        <p className="text-xs text-muted-foreground">
          Stats visible to seller in their app dashboard
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Badge variant="default" className="bg-blue-50 text-blue-800">
          {perf}
        </Badge>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-blue-600">
              <Eye className="size-4" />
              <span className="text-xs font-medium uppercase text-muted-foreground">Total Views</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{views}</p>
            <p className="text-[10px] text-muted-foreground">Views in last 30 days</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-green-600">
              <MessageSquare className="size-4" />
              <span className="text-xs font-medium uppercase text-muted-foreground">Enquiries</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{request.enquiryCount ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-purple-600">
              <Calendar className="size-4" />
              <span className="text-xs font-medium uppercase text-muted-foreground">Visits</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{request.visitCount ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-red-600">
              <Heart className="size-4" />
              <span className="text-xs font-medium uppercase text-muted-foreground">Saves</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{request.saveCount ?? 0}</p>
          </div>
        </div>
        <div className="h-[150px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={28} />
              <Bar dataKey="views" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2 text-sm">
          {views < 50 && (
            <div className="rounded-lg bg-muted/50 p-3">
              <p>💡 Consider boosting this listing</p>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-primary"
                onClick={() => navigate('/admin/tools/pricing')}
              >
                Boost Listing →
              </Button>
            </div>
          )}
          {request.photosCount === 0 && (
            <p className="text-muted-foreground">📸 Add photos to increase views by 3x</p>
          )}
          {parseSellAskingPrice(request.askingPrice) === 0 && (
            <p className="text-muted-foreground">💰 Add price to attract more buyers</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function isImageUrl(url: string) {
  return /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(url)
}

function sellDocStatusLabel(status: SellRequest['documents'][number]['status']): string {
  if (status === 'uploaded') return '✅ Uploaded'
  if (status === 'missing') return '❌ Missing'
  return '⏳ Pending'
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[900px] animate-pulse space-y-6 px-4 py-6">
      <div className="h-4 w-64 rounded bg-muted" />
      <div className="h-10 w-1/2 rounded bg-muted" />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <div className="h-64 rounded-xl bg-muted" />
          <div className="h-40 rounded-xl bg-muted" />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <div className="h-48 rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  )
}

export function SellRequestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [request, setRequest] = useState<SellRequest | null>(null)
  const [status, setStatus] = useState<SellRequestStatus>('new')
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const [adminTeam, setAdminTeam] = useState<SalesPerson[]>([])
  const [photoIndex, setPhotoIndex] = useState(0)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [showCallForm, setShowCallForm] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false)
  const [showAcceptAnyway, setShowAcceptAnyway] = useState(false)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [showChangesForm, setShowChangesForm] = useState(false)
  const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0])
  const [rejectNotes, setRejectNotes] = useState('')
  const [notifySellerReject, setNotifySellerReject] = useState(true)
  const [changesMessage, setChangesMessage] = useState('')
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [sendEmail, setSendEmail] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<{
    name: string
    url: string | null
    statusLabel: string
    uploadedAt: string
  } | null>(null)
  const [callDuration, setCallDuration] = useState('')
  const [callOutcome, setCallOutcome] = useState<CallOutcome>('Interested')
  const [callNotes, setCallNotes] = useState('')
  const [noteText, setNoteText] = useState('')
  const [pushSentBanner, setPushSentBanner] = useState<{
    notificationId: string
    template: NotificationTemplate
  } | null>(null)
  const [showPauseModal, setShowPauseModal] = useState(false)
  const [pauseReason, setPauseReason] = useState(PAUSE_REASONS[0])
  const [showSoldModal, setShowSoldModal] = useState(false)
  const [salePriceInput, setSalePriceInput] = useState('')
  const [saleDateInput, setSaleDateInput] = useState('')
  const [editingWarning, setEditingWarning] = useState<string | null>(null)
  const [editingDismissed, setEditingDismissed] = useState(false)
  const [saleBuyerInput, setSaleBuyerInput] = useState('')
  const [matchingAcq, setMatchingAcq] = useState<{ id: string; referenceId: string } | null>(null)
  const [showEditListing, setShowEditListing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editAmenities, setEditAmenities] = useState<string[]>([])
  const [editPhotos, setEditPhotos] = useState<string[]>([])
  const [editContactPref, setEditContactPref] = useState('WhatsApp')
  const [notifySellerPriceChange, setNotifySellerPriceChange] = useState(true)
  const [newPhotoUrl, setNewPhotoUrl] = useState('')
  const showToast = useCallback((msg: string) => setToast(msg), [])
  const toastApi = useMemo(() => bindToast(setToast), [])

  const dispatchPush = useCallback(
    (
      userName: string,
      template: NotificationTemplate,
      notificationId: string,
      dedupeKey?: string,
    ) => {
      let msg = sendPushNotification(userName, template, notificationId, {
        dedupeKey,
        audience: template.audience || 'seller',
        userId: request?.sellerId,
        relatedTo: request ? { type: 'sell-request', id: request.id } : undefined,
      })
      if (msg.includes('recently') && window.confirm(`${msg}\n\nSend again anyway?`)) {
        msg = sendPushNotification(userName, template, notificationId, {
          skipDuplicateCheck: true,
          dedupeKey,
          audience: template.audience || 'seller',
          userId: request?.sellerId,
          relatedTo: request ? { type: 'sell-request', id: request.id } : undefined,
        })
      }
      showToast(msg.includes('recently') ? msg : `Push ${notificationId} sent to ${userName}`)
      if (!msg.includes('recently')) {
        setPushSentBanner({ notificationId, template })
      }
      return !msg.includes('recently')
    },
    [request, showToast],
  )

  useEffect(() => {
    if (!id || loading) return
    setEditingWarning(getConcurrentEditingWarning('sell-request', id))
    setEditingDismissed(false)
    claimConcurrentEditing('sell-request', id)
    return () => releaseConcurrentEditing('sell-request', id)
  }, [id, loading])

  const loadRequest = useCallback(async () => {
    const session = readAdminSession()
    if (!id || !session?.accessToken) {
      setLoadError('Your admin session has expired. Please log in again.')
      setRequest(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)
    try {
      const [found, timeline, team] = await Promise.all([
        getAdminSellRequest(session.accessToken, id),
        listAdminCommunicationTimeline(session.accessToken, 'sell_request', id, { limit: 50 }),
        getAdminSalesTeam(session.accessToken).catch(() => [] as SalesPerson[]),
      ])
      const timelineLogs = timeline.data
      setRequest(found)
      setStatus(found.status)
      setAssignedTo(found.assignedTo)
      const availableTeam = team.filter((member) => member.isAvailable)
      const assignedMember = found.assignedTo
        ? team.find((member) => member.id === found.assignedTo)
        : undefined
      setAdminTeam(
        assignedMember && !availableTeam.some((member) => member.id === assignedMember.id)
          ? [assignedMember, ...availableTeam]
          : availableTeam,
      )
      setActivities([
        ...timelineLogs.map((log) => ({
          id: log.id,
          type: log.channel === 'call' ? 'call' as const : log.channel === 'note' ? 'note' as const : 'status' as const,
          text: log.summary,
          at: log.occurredAt,
        })),
        { id: 'sub', type: 'submitted', text: 'Listing submitted via app', at: found.submittedAt },
      ])
      setCallLogs(timelineLogs.filter((log) => log.channel === 'call').map(callLogFromCommunication))
      setNotes(timelineLogs.filter((log) => log.channel === 'note').map(noteFromCommunication))
      if (found.status === 'changes_requested') {
        setChangesMessage(
          `Please upload missing documents and add more photos.\n\nMissing: ${getMissingItems(found).join(', ')}`,
        )
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load sell request.')
      setRequest(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadRequest()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadRequest])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  const addActivity = useCallback((item: Omit<ActivityItem, 'id'> & { id?: string }) => {
    setActivities((prev) => [
      { id: item.id ?? `a-${Date.now()}`, type: item.type, text: item.text, at: item.at },
      ...prev,
    ])
  }, [])

  const handleAssignSalesPerson = useCallback(
    async (salesPersonId: string) => {
      const session = readAdminSession()
      const person = getSalesPersonById(salesPersonId, adminTeam)
      if (!person || !request || !id) return
      if (!session?.accessToken) {
        showToast('Your admin session has expired. Please log in again.')
        return
      }

      try {
        const updated = await updateAdminSellRequest(session.accessToken, id, {
          assignedTo: salesPersonId,
        })
        setAssignedTo(updated.assignedTo)
        setRequest(updated)
        addActivity({
          type: 'status',
          text: `Assigned to ${person.name}`,
          at: new Date().toISOString(),
        })
        showToast(`Assigned to ${person.name}`)
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Unable to assign sell request')
      }
    },
    [adminTeam, request, id, addActivity, showToast],
  )

  const updateStatus = useCallback(
    (next: SellRequestStatus, extra?: Partial<SellRequest>) => {
      setStatus(next)
      setRequest((prev) => (prev ? { ...prev, status: next, ...extra } : prev))
      addActivity({
        type: 'status',
        text: `Status changed to ${STATUS_LABELS[next]}`,
        at: new Date().toISOString(),
      })
    },
    [addActivity],
  )

  const canAccept = useMemo(() => {
    if (!request) return false
    if (request.isDraft || request.status === 'draft') return false
    if (
      request.status === 'accepted' ||
      request.status === 'rejected' ||
      request.status === 'sold' ||
      request.status === 'paused'
    ) {
      return false
    }
    return true
  }, [request])

  const showListingActions = useMemo(() => {
    if (!request) return false
    const s = status
    return s === 'approved' || s === 'active' || s === 'accepted'
  }, [request, status])

  const showNegotiation = useMemo(() => {
    if (!request) return false
    return (
      status === 'negotiating' ||
      status === 'active' ||
      status === 'approved' ||
      request.id === 'SELL-008'
    )
  }, [request, status])

  const confirmMarkSold = useCallback(() => {
    if (!request) return
    const price = Number(salePriceInput.replace(/,/g, ''))
    if (!Number.isFinite(price) || price <= 0) {
      showToast('Enter valid sale price')
      return
    }
    updateStatus('sold', {
      salePrice: price,
      saleDate: saleDateInput || new Date().toISOString().split('T')[0],
      saleBuyerName: saleBuyerInput.trim() || null,
    })
    setShowSoldModal(false)
    showToast('Marked as sold')
  }, [request, salePriceInput, saleDateInput, saleBuyerInput, updateStatus, showToast])

  const confirmPause = useCallback(() => {
    if (!request) return
    updateStatus('paused', { pauseReason })
    setShowPauseModal(false)
    showToast('Listing paused. Seller notified via app (SL-18)')
    dispatchPush(
      request.sellerName,
      {
        title: 'Listing Paused',
        body: `Your listing "${request.propertyTitle}" has been paused. Reason: ${pauseReason}`,
        deepLink: 'P-05',
        audience: 'seller',
      },
      'N-02',
      `N-02:pause:${request.id}`,
    )
  }, [request, pauseReason, updateStatus, showToast, dispatchPush])

  const acceptDisabledReason = useMemo(() => {
    if (!request) return ''
    if (request.photosCount === 0) return 'Cannot accept — no photos uploaded'
    if (request.completenessPercent < 50) return 'Listing too incomplete to accept'
    if (request.documentsCount === 0 && request.documents.every((d) => d.status === 'missing'))
      return 'No documents uploaded'
    return ''
  }, [request])

  const handleAccept = () => {
    if (!request) return
    if (acceptDisabledReason && request.completenessPercent < 50) return
    if (request.documentsCount === 0 || request.documents.filter((d) => d.status === 'uploaded').length === 0) {
      setShowAcceptAnyway(true)
      return
    }
    setShowAcceptConfirm(true)
  }

  const confirmAccept = async () => {
    if (!request) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Your admin session has expired. Please log in again.')
      return
    }

    const template = NOTIFICATION_TEMPLATES.N02_LISTING_APPROVED(
      request.sellerName,
      request.propertyTitle,
    )
    try {
      let reviewed = request
      if (reviewed.status === 'new') {
        reviewed = await reviewAdminSellRequest(session.accessToken, reviewed.id, 'under_review')
      }
      if (reviewed.status !== 'accepted') {
        reviewed = await reviewAdminSellRequest(session.accessToken, reviewed.id, 'accepted')
      }
      const acquisition = await createAdminAcquisitionFromSellRequest(session.accessToken, reviewed.id)
      dispatchPush(request.sellerName, template, 'N-02', `N-02:approved:${request.id}`)
      updateStatus('accepted')
      setMatchingAcq({ id: acquisition.id, referenceId: acquisition.referenceId })
      setShowAcceptConfirm(false)
      setShowAcceptAnyway(false)
      showToast('Listing accepted and acquisition created')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create acquisition.')
    }
  }

  const confirmReject = () => {
    if (!request) return
    const rejectionReason = rejectNotes.trim()
      ? `${rejectReason}. ${rejectNotes}`.trim()
      : rejectReason
    if (!rejectionReason.trim()) {
      showToast('Rejection reason required')
      return
    }
    const template = NOTIFICATION_TEMPLATES.N06_REUPLOAD_REQUIRED(
      request.sellerName,
      request.propertyTitle,
      rejectionReason,
    )
    if (notifySellerReject) {
      dispatchPush(request.sellerName, template, 'N-06', `N-06:reject:${request.id}`)
      if (request.email) {
        window.open(`mailto:${request.email}?subject=Listing%20Rejected`)
      }
    }
    updateStatus('rejected', { rejectionReason })
    setShowRejectForm(false)
  }

  const rejectPreviewTemplate = request
    ? NOTIFICATION_TEMPLATES.N06_REUPLOAD_REQUIRED(
        request.sellerName,
        request.propertyTitle,
        `${rejectReason}. ${rejectNotes}`.trim() || rejectReason,
      )
    : null

  const completenessChecklist = useMemo(() => {
    if (!request) return []
    const uploadedDocs = request.documents.filter((d) => d.status === 'uploaded').length
    return [
      {
        ok: (() => {
          const stats = countMissingTypeFields(request.propertyType, request.propertyDetails)
          if (stats.total > 0) return stats.missing === 0
          return Boolean(
            request.propertyDetails && Object.keys(request.propertyDetails).length > 0,
          )
        })(),
        label: 'Property details filled',
      },
      { ok: request.photosCount > 0, label: `Photos uploaded (${request.photosCount})` },
      { ok: Boolean(request.askingPrice), label: 'Price set' },
      { ok: uploadedDocs > 0, label: `Documents (${uploadedDocs} of ${request.documents.length})` },
      { ok: Boolean(request.description?.trim()), label: 'Description' },
      { ok: Boolean(request.location), label: 'Location set' },
      { ok: request.amenities.length > 0, label: 'Amenities selected' },
    ]
  }, [request])

  if (loading) return <DetailSkeleton />

  if (!request) {
    return (
      <div className="mx-auto flex max-w-[900px] flex-col items-center px-4 py-24 text-center">
        <AlertCircle className="mb-4 size-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">
          {loadError ? 'Could not load sell request' : 'Sell request not found'}
        </h2>
        {loadError && <p className="mt-2 max-w-md text-sm text-muted-foreground">{loadError}</p>}
        <div className="mt-6 flex gap-2">
          {loadError && <Button onClick={() => void loadRequest()}>Retry</Button>}
          <Button variant="outline" onClick={() => navigate('/admin/enquiries/sell')}>
            Back to Sell Requests
          </Button>
        </div>
      </div>
    )
  }

  const missing = getMissingItems(request)
  const similar = getSimilarProperties(request)
  const isFinal =
    status === 'accepted' ||
    status === 'rejected' ||
    status === 'sold' ||
    status === 'paused' ||
    status === 'draft'
  const fieldStats = countMissingTypeFields(request.propertyType, request.propertyDetails)
  const possessionDisplay =
    request.possessionStatus ??
    (request.propertyDetails?.possessionStatus as string | undefined) ??
    null
  const ownershipDisplay =
    request.ownershipType ??
    (request.propertyDetails?.ownershipType as string | undefined) ??
    null
  const loanDisplay =
    request.loanOnProperty ??
    (request.propertyDetails?.loanOnProperty as boolean | undefined)

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6">
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

      {previewDoc && (
        <div
          className="fixed inset-0 z-[60] bg-black/70"
          onClick={() => setPreviewDoc(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="mx-auto mt-20 max-w-[600px] rounded-xl bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative mb-4">
              <div className="pr-10">
                <h3 className="text-lg font-semibold text-foreground">{previewDoc.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{previewDoc.statusLabel}</p>
              </div>
              <button
                type="button"
                className="absolute right-0 top-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
                onClick={() => setPreviewDoc(null)}
                aria-label="Close preview"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mb-6">
              {previewDoc.url && isImageUrl(previewDoc.url) ? (
                <img
                  src={previewDoc.url}
                  alt={previewDoc.name}
                  className="max-h-[400px] w-full rounded-lg object-contain bg-muted"
                />
              ) : previewDoc.url ? (
                <a
                  href={previewDoc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary underline"
                >
                  Open document in new tab
                </a>
              ) : (
                <>
                  <div className="flex flex-col items-center justify-center rounded-lg bg-muted py-12">
                    <FileText className="size-16 text-muted-foreground" strokeWidth={1.25} />
                    <p className="mt-3 font-medium text-foreground">Document Preview</p>
                  </div>
                  <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                    📄 In production, the actual document uploaded by the buyer/seller appears here.
                    Files are stored in cloud storage (S3/Cloudinary) and displayed via secure URL.
                  </div>
                  <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                    <p>Document: {previewDoc.name}</p>
                    <p>Status: {previewDoc.statusLabel}</p>
                    <p>Uploaded: {previewDoc.uploadedAt}</p>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (previewDoc.url) {
                    window.open(previewDoc.url, '_blank', 'noopener,noreferrer')
                  } else {
                    showToast('Download available when backend is connected')
                    setTimeout(() => setToast(null), 2500)
                  }
                }}
              >
                📥 Download
              </Button>
              {previewDoc.statusLabel === '✅ Uploaded' && (
                <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm text-green-700">
                  ✅ Verified
                </span>
              )}
              <Button type="button" onClick={() => setPreviewDoc(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <ListingPreviewModal
        request={request}
        open={showPreview}
        onClose={() => setShowPreview(false)}
        showAccept={canAccept && !acceptDisabledReason}
        onAccept={() => {
          setShowPreview(false)
          handleAccept()
        }}
      />

      {showAcceptConfirm && request && (
        <ModalShell onClose={() => setShowAcceptConfirm(false)}>
          <h3 className="text-lg font-semibold">Accept this property for acquisition review?</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            The listing will move to the Acquisition Pipeline pending queue.
          </p>
          <NotificationPreview
            notificationId="N-02"
            title={NOTIFICATION_TEMPLATES.N02_LISTING_APPROVED(
              request.sellerName,
              request.propertyTitle,
            ).title}
            body={NOTIFICATION_TEMPLATES.N02_LISTING_APPROVED(
              request.sellerName,
              request.propertyTitle,
            ).body}
            deepLink="P-05"
            recipientLabel="seller"
          />
          <div className="mt-6 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowAcceptConfirm(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={confirmAccept}>
              Confirm
            </Button>
          </div>
        </ModalShell>
      )}

      {showAcceptAnyway && (
        <ModalShell onClose={() => setShowAcceptAnyway(false)}>
          <h3 className="text-lg font-semibold">No documents uploaded</h3>
          <p className="mt-2 text-sm text-muted-foreground">Accept anyway and proceed to acquisition review?</p>
          <div className="mt-6 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowAcceptAnyway(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={confirmAccept}>
              Accept anyway
            </Button>
          </div>
        </ModalShell>
      )}

      {showRejectForm && (
        <ModalShell onClose={() => setShowRejectForm(false)}>
          <h3 className="text-lg font-semibold">Reject listing</h3>
          <select
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="mt-3 h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
          >
            {REJECT_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <textarea
            rows={3}
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            placeholder="Additional notes..."
            className="mt-3 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notifySellerReject}
              onChange={(e) => setNotifySellerReject(e.target.checked)}
            />
            Send rejection to seller
          </label>
          {notifySellerReject && rejectPreviewTemplate && (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-medium">📱 Notification that will be sent:</p>
              <NotificationPreview
                notificationId="N-06"
                title={rejectPreviewTemplate.title}
                body={rejectPreviewTemplate.body}
                deepLink={rejectPreviewTemplate.deepLink}
                recipientLabel="seller"
              />
            </div>
          )}
          <Button variant="destructive" className="mt-4 w-full" onClick={confirmReject}>
            Confirm Reject
          </Button>
        </ModalShell>
      )}

      {showChangesForm && (
        <ModalShell onClose={() => setShowChangesForm(false)}>
          <h3 className="text-lg font-semibold">Request changes</h3>
          <textarea
            rows={5}
            value={changesMessage}
            onChange={(e) => setChangesMessage(e.target.value)}
            className="mt-3 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
          <div className="mt-3 flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={sendWhatsApp} onChange={(e) => setSendWhatsApp(e.target.checked)} />
              WhatsApp
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              Email
            </label>
          </div>
          <Button
            className="mt-4 w-full"
            onClick={() => {
              if (sendWhatsApp) openWhatsAppQuick(request.phone, request.sellerName)
              if (sendEmail && request.email) handleEmail(request.email)
              updateStatus('changes_requested')
              setShowChangesForm(false)
            }}
          >
            Send
          </Button>
        </ModalShell>
      )}

      {showPauseModal && (
        <ModalShell onClose={() => setShowPauseModal(false)}>
          <h3 className="text-lg font-semibold">Pause {request.propertyTitle}?</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Listing will be hidden from app. Seller will be notified.
          </p>
          <select
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            className="mt-3 h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
          >
            {PAUSE_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <NotificationPreview
            notificationId="N-02"
            title="Listing Paused"
            body={`Your listing "${request.propertyTitle}" has been paused.`}
            deepLink="P-05"
            recipientLabel="seller"
          />
          <div className="mt-4 flex gap-2">
            <Button
              className="flex-1 bg-orange-600 hover:bg-orange-700"
              onClick={confirmPause}
            >
              Confirm
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setShowPauseModal(false)}>
              Cancel
            </Button>
          </div>
        </ModalShell>
      )}

      {showSoldModal && (
        <ModalShell onClose={() => setShowSoldModal(false)}>
          <h3 className="text-lg font-semibold">Mark {request.propertyTitle} as Sold?</h3>
          <label className="mt-3 block text-sm">
            Final sale price (₹)
            <input
              type="number"
              value={salePriceInput}
              onChange={(e) => setSalePriceInput(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
            />
          </label>
          <label className="mt-2 block text-sm">
            Sale date
            <input
              type="date"
              value={saleDateInput}
              onChange={(e) => setSaleDateInput(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
            />
          </label>
          <label className="mt-2 block text-sm">
            Buyer name
            <input
              value={saleBuyerInput}
              onChange={(e) => setSaleBuyerInput(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
            />
          </label>
          <div className="mt-4 flex gap-2">
            <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={confirmMarkSold}>
              Confirm
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setShowSoldModal(false)}>
              Cancel
            </Button>
          </div>
        </ModalShell>
      )}

      <Breadcrumb title={request.propertyTitle} navigate={navigate} />

      {request.hasPreviousRejection && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <AlertTriangle className="size-4" />
          Previous rejection on file for this seller
        </div>
      )}

      {request.completenessPercent < 80 && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <span>
            This listing is {request.completenessPercent}% complete.
            {missing.length > 0 && <> Missing: {missing.join(', ')}.</>}
          </span>
        </div>
      )}

      <header className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{request.propertyTitle}</h1>
          <p className="text-sm text-muted-foreground">
            {request.referenceId}
            {request.isDraft || request.status === 'draft'
              ? request.draftSavedAt
                ? ` · Draft saved ${formatFullDate(request.draftSavedAt)}`
                : ' · Draft'
              : ` · Submitted ${formatFullDate(request.submittedAt)}`}
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <StatusBadge status={status} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => handleCall(request.phone, toastApi)}>
              <Phone className="size-4" /> Call Seller
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-green-600"
              onClick={() => openWhatsAppQuick(request.phone, request.sellerName)}
            >
              WhatsApp
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!request.email}
              onClick={() => request.email && handleEmail(request.email)}
            >
              <Mail className="size-4" /> Email
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowPreview(true)}>
              Preview Listing
            </Button>
            <select
              value={assignedTo ?? ''}
              onChange={(e) => {
                const nextId = e.target.value
                if (!nextId) return
                void handleAssignSalesPerson(nextId)
              }}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs"
              disabled={isFinal}
            >
              <option value="">Assign to...</option>
              {adminTeam.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {status === 'rejected' && request.rejectionReason && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800">
          Rejection reason: {request.rejectionReason}
        </p>
      )}

      <hr className="my-6 border-border" />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {request.photos.length === 0 && (
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm font-medium text-orange-800">📸 No photos uploaded</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-orange-300"
                  onClick={() => {
                    window.open(
                      `https://wa.me/${request.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${request.sellerName}, please upload photos for your listing "${request.propertyTitle}".`)}`,
                      '_blank',
                    )
                    showToast('WhatsApp opened — photo request')
                  }}
                >
                  Request Photos
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Property Photos ({request.photosCount})</CardTitle>
            </CardHeader>
            <CardContent>
              {request.photos.length > 0 ? (
                <>
                  <img
                    src={request.photos[photoIndex]}
                    alt=""
                    className="h-64 w-full rounded-lg object-cover"
                  />
                  <div className="mt-3 flex gap-2 overflow-x-auto">
                    {request.photos.map((src, i) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() => setPhotoIndex(i)}
                        className={cn(
                          'size-16 shrink-0 overflow-hidden rounded border-2',
                          i === photoIndex ? 'border-primary' : 'border-transparent',
                        )}
                      >
                        <img src={src} alt="" className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-48 flex-col items-center justify-center rounded-lg bg-muted">
                  <Camera className="mb-2 size-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No photos uploaded</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Property Details</CardTitle>
              <Badge variant="default" className="mt-1 w-fit capitalize">
                {request.propertyType.replace(/_/g, ' ')}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">{request.propertyTitle}</h3>
                <p className="mt-1 text-xl font-bold text-primary">{request.askingPrice}</p>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="size-4 shrink-0" />
                  {request.location}, {request.city} — {request.pincode}
                </p>
              </div>

              <hr className="border-border" />

              <div>
                <h3 className="text-base font-semibold">Seller Submitted Details</h3>
                <p className="text-xs text-muted-foreground">📱 App screens: SL-02A to SL-02M</p>
                <div className="mt-4">
                  {renderFieldGroups(request.propertyType, request.propertyDetails) ?? (
                    <p className="text-sm text-muted-foreground">
                      No type-specific field configuration for &quot;{request.propertyType}&quot;.
                    </p>
                  )}
                </div>
              </div>

              {renderStaticFieldGrid('SL-03', 'Location Details', [
                { label: 'Address', value: request.address ?? request.location },
                { label: 'Locality', value: request.location },
                { label: 'City', value: request.city },
                { label: 'Pincode', value: request.pincode },
                { label: 'Landmark', value: request.landmark },
              ])}

              {renderStaticFieldGrid('SL-04', 'Pricing & Ownership', [
                { label: 'Asking Price', value: request.askingPrice },
                {
                  label: 'Negotiable',
                  value:
                    request.negotiable === undefined
                      ? null
                      : request.negotiable
                        ? 'Yes'
                        : 'No',
                },
                { label: 'Ownership Type', value: ownershipDisplay },
                { label: 'Possession Status', value: possessionDisplay },
                {
                  label: 'Loan on Property',
                  value:
                    loanDisplay === undefined
                      ? null
                      : loanDisplay
                        ? 'Yes'
                        : 'No',
                },
              ])}

              {fieldStats.total > 0 && (
                <div className="mt-2">
                  {fieldStats.missing > 3 ? (
                    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950/40">
                      <p className="text-sm font-medium text-orange-900 dark:text-orange-200">
                        ⚠️ {fieldStats.missing} fields not filled by seller
                      </p>
                      <p className="mt-1 text-sm text-orange-800 dark:text-orange-300">
                        Consider requesting more details before accepting this listing.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-3 border-orange-300"
                        onClick={() => {
                          const msg = buildRequestDetailsMessage(
                            request.sellerName,
                            request.propertyTitle,
                            request.propertyType,
                            request.propertyDetails,
                          )
                          if (request.email) {
                            window.open(
                              `mailto:${request.email}?subject=${encodeURIComponent(`Details needed — ${request.propertyTitle}`)}&body=${encodeURIComponent(msg)}`,
                            )
                          } else {
                            openWhatsApp(request.phone, msg)
                          }
                          showToast('Request details message opened')
                        }}
                      >
                        Request Details
                      </Button>
                    </div>
                  ) : fieldStats.missing === 0 ? (
                    <div className="rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/40">
                      <p className="text-sm font-medium text-green-800 dark:text-green-200">
                        ✅ All required fields submitted
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {fieldStats.missing} optional field{fieldStats.missing > 1 ? 's' : ''} not
                      provided
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Amenities ({request.amenities.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {request.amenities.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {request.amenities.map((a) => (
                    <span key={a} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                      <Check className="size-3" /> {a}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No amenities selected</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Documents</CardTitle>
              <Button variant="outline" size="sm" disabled={isFinal}>
                Request Documents
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {request.documents.map((doc) => (
                <div
                  key={doc.name}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span>{doc.name}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-xs font-medium',
                        doc.status === 'uploaded' && 'text-green-700',
                        doc.status === 'missing' && 'text-red-700',
                        doc.status === 'pending' && 'text-orange-700',
                      )}
                    >
                      {sellDocStatusLabel(doc.status)}
                    </span>
                    {doc.status !== 'missing' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          setPreviewDoc({
                            name: doc.name,
                            url: null,
                            statusLabel: sellDocStatusLabel(doc.status),
                            uploadedAt: new Date(request.submittedAt).toLocaleDateString('en-IN', {
                              dateStyle: 'medium',
                            }),
                          })
                        }
                      >
                        View
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={() => {
                  const msg = `Missing documents for ${request.propertyTitle}: ${request.documents.filter((d) => d.status === 'missing').map((d) => d.name).join(', ')}`
                  openWhatsApp(request.phone, msg)
                }}
              >
                Request Missing Documents
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Seller&apos;s Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={cn('text-sm', !request.description?.trim() && 'italic text-muted-foreground')}>
                {request.description?.trim() || 'No description provided'}
              </p>
            </CardContent>
          </Card>

          {request && !request.isDraft && status !== 'draft' && (
            <ListingAnalyticsCard request={request} navigate={navigate} />
          )}

          {request && showNegotiation && (
            <NegotiationChat
              entityType="sell_request"
              entityId={request.id}
              entityTitle={request.propertyTitle}
              currentPrice={parseSellAskingPrice(request.askingPrice)}
              otherPartyName={request.sellerName}
              otherPartyPhone={request.phone}
              otherPartyType="seller"
              minimumTargetPrice={parseSellAskingPrice(request.askingPrice) * 0.88}
              negotiationStartedAt={request.submittedAt}
              toast={showToast}
              onOfferAccepted={(amount) => {
                addActivity({
                  type: 'status',
                  text: `Offer accepted at ${formatPrice(amount)}`,
                  at: new Date().toISOString(),
                })
              }}
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
            formatTimestamp={formatFullDate}
            onSave={async (recording?: CallRecordingPayload) => {
              const session = readAdminSession()
              if (!id || !session?.accessToken) {
                showToast('Your admin session has expired. Please log in again.')
                return false
              }
              try {
                const saved = await createAdminCommunicationLog(session.accessToken, {
                  entityType: 'sell_request',
                  entityId: id,
                  channel: 'call',
                  direction: 'outbound',
                  summary: `Call logged — ${callOutcome}`,
                  body: callNotes.trim() || null,
                  outcome: callOutcome,
                  durationMinutes: parseInt(callDuration, 10) || 0,
                  attachments: recording
                    ? [
                        {
                          url: recording.url,
                          fileName: recording.fileName,
                          sizeBytes: recording.size,
                        },
                      ]
                    : [],
                })
                const log = callLogFromCommunication(saved)
                setCallLogs((p) => [log, ...p])
                addActivity({ id: saved.id, type: 'call', text: saved.summary, at: saved.occurredAt })
                setShowCallForm(false)
                setCallDuration('')
                setCallNotes('')
                return true
              } catch (error) {
                showToast(error instanceof Error ? error.message : 'Unable to save call log.')
                return false
              }
            }}
          />

          <NotesSection
            notes={notes}
            showForm={showNoteForm}
            setShowForm={setShowNoteForm}
            noteText={noteText}
            setNoteText={setNoteText}
            onSave={async () => {
              if (!noteText.trim()) return
              const session = readAdminSession()
              if (!id || !session?.accessToken) {
                showToast('Your admin session has expired. Please log in again.')
                return
              }
              try {
                const saved = await createAdminCommunicationLog(session.accessToken, {
                  entityType: 'sell_request',
                  entityId: id,
                  channel: 'note',
                  direction: 'internal',
                  summary: 'Note added',
                  body: noteText.trim(),
                })
                const note = noteFromCommunication(saved)
                setNotes((p) => [note, ...p])
                addActivity({ id: saved.id, type: 'note', text: saved.summary, at: saved.occurredAt })
                setNoteText('')
                setShowNoteForm(false)
              } catch (error) {
                showToast(error instanceof Error ? error.message : 'Unable to save note.')
              }
            }}
            onDelete={(nid) => setNotes((p) => p.filter((n) => n.id !== nid))}
          />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Seller Info</CardTitle>
            </CardHeader>
            <CardContent className="text-center sm:text-left">
              <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-2xl font-bold text-white sm:mx-0">
                {getInitials(request.sellerName)}
              </div>
              <p className="text-lg font-semibold">{request.sellerName}</p>
              <Badge variant="default" className="mt-2 capitalize">
                {request.userType}
              </Badge>
              <button
                type="button"
                className="mt-4 block text-sm hover:text-primary"
                onClick={() => void copyText(request.phone, toastApi)}
              >
                {request.phone}
              </button>
              <p className={cn('text-sm', !request.email && 'italic text-muted-foreground')}>
                {request.email ?? 'Not provided'}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">Member since {request.memberSince}</p>
              <p className="text-sm text-muted-foreground">
                {request.previousListings === 0
                  ? '0 previous listings'
                  : `${request.previousListings} previous listings`}
              </p>
              <button
                type="button"
                onClick={() => navigate(`/admin/users/${request.sellerId}`)}
                className="mt-4 text-sm font-medium text-primary hover:underline"
              >
                View Seller Profile →
              </button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Listing Completeness</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 text-center">
                <p className={cn('text-4xl font-bold', request.completenessPercent < 50 ? 'text-red-600' : request.completenessPercent < 80 ? 'text-orange-600' : 'text-green-600')}>
                  {request.completenessPercent}%
                </p>
                <div className="mx-auto mt-2 h-3 max-w-xs overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', getCompletenessColor(request.completenessPercent))}
                    style={{ width: `${request.completenessPercent}%` }}
                  />
                </div>
              </div>
              <ul className="space-y-2 text-sm">
                {completenessChecklist.map((item) => (
                  <li key={item.label} className="flex items-center gap-2">
                    {item.ok ? (
                      <Check className="size-4 text-green-600" />
                    ) : (
                      <X className="size-4 text-red-600" />
                    )}
                    <span className={!item.ok ? 'text-muted-foreground' : ''}>{item.label}</span>
                  </li>
                ))}
              </ul>
              {missing.length > 0 && (
                <div className="mt-4 rounded-lg bg-muted p-3 text-sm">
                  <p className="font-medium">Improve completeness</p>
                  <p className="text-muted-foreground">Add: {missing.join(', ')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Similar in Area</CardTitle>
              <p className="text-xs text-muted-foreground">Properties Builtglory already has</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {similar.length === 0 ? (
                <p className="text-sm text-muted-foreground">No similar properties in this area</p>
              ) : (
                similar.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(`/admin/properties/${p.id}`)}
                    className="flex w-full gap-3 rounded-lg border border-border p-2 text-left hover:bg-sidebar-accent"
                  >
                    <img src={p.image} alt="" className="size-14 rounded object-cover" />
                    <div>
                      <p className="text-sm font-medium">{p.title}</p>
                      <p className="text-sm text-primary">{p.price}</p>
                      <Badge variant="default" className="text-xs">
                        {p.status}
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 border-l-2 border-border pl-4">
                {activities.map((a) => (
                  <li key={a.id} className="relative">
                    <span
                      className={cn(
                        'absolute -left-[21px] top-1.5 size-2.5 rounded-full',
                        a.type === 'submitted' ? 'bg-primary' : 'bg-green-500',
                      )}
                    />
                    <p className="text-sm">{a.text}</p>
                    <p className="text-xs text-muted-foreground">{formatTimeAgo(a.at)}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {matchingAcq && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="space-y-3 p-4 text-sm text-blue-900">
                <p className="font-semibold">🔗 Related Acquisition Found</p>
                <p>
                  {matchingAcq.referenceId} is linked to this listing
                </p>
                <p>Update acquisition to &apos;Acquired&apos; stage?</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => navigate(`/admin/acquisition/${matchingAcq.id}`)}
                  >
                    Yes, update now
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setMatchingAcq(null)}>
                    Skip for now
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <p className="text-xs text-muted-foreground">📱 SL-15, SL-17, SL-18</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {!request.isDraft && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setEditTitle(request.propertyTitle)
                    setEditPrice(request.askingPrice.replace(/[^\d]/g, ''))
                    setEditDescription(request.description)
                    setEditAmenities([...request.amenities])
                    setEditPhotos([...request.photos])
                    setShowEditListing(true)
                  }}
                >
                  ✏️ Edit Listing Details
                </Button>
              )}
              {showListingActions && status !== 'paused' && (
                <Button
                  variant="outline"
                  className="w-full border-orange-300 text-orange-800"
                  onClick={() => setShowPauseModal(true)}
                >
                  ⏸ Pause Listing
                </Button>
              )}
              {status === 'paused' && (
                <Button
                  variant="outline"
                  className="w-full border-green-300 text-green-800"
                  onClick={() => {
                    updateStatus('active')
                    showToast('Listing resumed')
                  }}
                >
                  ▶ Resume Listing
                </Button>
              )}
              {showListingActions && status !== 'sold' && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSalePriceInput(String(parseSellAskingPrice(request.askingPrice)))
                    setSaleDateInput(new Date().toISOString().split('T')[0])
                    setShowSoldModal(true)
                  }}
                >
                  ✅ Mark as Sold
                </Button>
              )}
            </CardContent>
          </Card>

          {showEditListing && (
            <Card>
              <CardHeader>
                <CardTitle>Edit Listing</CardTitle>
                <p className="text-xs text-muted-foreground">📱 App screen: SL-15</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="block text-sm">
                  Property Title
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  Price (₹)
                  <input
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  Description
                  <textarea
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                  />
                </label>
                <div>
                  <p className="text-sm font-medium">Amenities</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {AMENITY_OPTIONS.map((a) => (
                      <label key={a} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={editAmenities.includes(a)}
                          onChange={() =>
                            setEditAmenities((p) =>
                              p.includes(a) ? p.filter((x) => x !== a) : [...p, a],
                            )
                          }
                        />
                        {a}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium">Photos</p>
                  {editPhotos.map((url, i) => (
                    <div key={i} className="mt-1 flex gap-2">
                      <input
                        value={url}
                        onChange={(e) => {
                          const next = [...editPhotos]
                          next[i] = e.target.value
                          setEditPhotos(next)
                        }}
                        className="h-8 flex-1 rounded border px-2 text-xs"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditPhotos((p) => p.filter((_, j) => j !== i))}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newPhotoUrl}
                      onChange={(e) => setNewPhotoUrl(e.target.value)}
                      placeholder="Photo URL"
                      className="h-8 flex-1 rounded border px-2 text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (newPhotoUrl.trim()) {
                          setEditPhotos((p) => [...p, newPhotoUrl.trim()])
                          setNewPhotoUrl('')
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
                <label className="block text-sm">
                  Contact preference
                  <select
                    value={editContactPref}
                    onChange={(e) => setEditContactPref(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
                  >
                    <option>WhatsApp</option>
                    <option>Phone</option>
                    <option>Email</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={notifySellerPriceChange}
                    onChange={(e) => setNotifySellerPriceChange(e.target.checked)}
                  />
                  Notify seller of price change?
                </label>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      const oldPrice = parseSellAskingPrice(request.askingPrice)
                      const newPrice = Number(editPrice.replace(/,/g, ''))
                      const priceStr =
                        Number.isFinite(newPrice) && newPrice > 0
                          ? `₹${newPrice.toLocaleString('en-IN')}`
                          : request.askingPrice
                      setRequest((p) =>
                        p
                          ? {
                              ...p,
                              propertyTitle: editTitle,
                              askingPrice: priceStr,
                              description: editDescription,
                              amenities: editAmenities,
                              photos: editPhotos,
                              photosCount: editPhotos.length,
                            }
                          : p,
                      )
                      if (oldPrice !== newPrice && Number.isFinite(newPrice)) {
                        addActivity({
                          type: 'note',
                          text: `Admin updated price from ${formatPrice(oldPrice)} to ${formatPrice(newPrice)}`,
                          at: new Date().toISOString(),
                        })
                      }
                      if (editDescription !== request.description) {
                        addActivity({
                          type: 'note',
                          text: 'Admin updated description',
                          at: new Date().toISOString(),
                        })
                      }
                      if (notifySellerPriceChange && oldPrice !== newPrice) {
                        openWhatsApp(
                          request.phone,
                          `Hi ${request.sellerName}, your listing price for ${editTitle} was updated to ${priceStr} by BuiltGlory admin.`,
                        )
                      }
                      setShowEditListing(false)
                      showToast('Listing updated. Changes visible on app (SL-15)')
                    }}
                  >
                    Save Changes
                  </Button>
                  <Button variant="outline" onClick={() => setShowEditListing(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Review Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {status === 'accepted' && pushSentBanner?.notificationId === 'N-02' && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                  <p className="font-medium">✅ Push notification N-02 sent to seller</p>
                  <p className="mt-1 font-medium">{pushSentBanner.template.title}</p>
                  <p className="text-xs text-green-800">{pushSentBanner.template.body}</p>
                </div>
              )}
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
                disabled={!canAccept || Boolean(acceptDisabledReason && request.completenessPercent < 50)}
                title={acceptDisabledReason}
                onClick={handleAccept}
              >
                ✅ Accept for Acquisition
              </Button>
              <Button
                variant="outline"
                className="w-full border-destructive text-destructive"
                disabled={isFinal}
                onClick={() => setShowRejectForm(true)}
              >
                ❌ Reject Listing
              </Button>
              <Button
                variant="outline"
                className="w-full border-orange-300 text-orange-700"
                disabled={isFinal}
                onClick={() => setShowChangesForm(true)}
              >
                📝 Request Changes
              </Button>
              <Button
                variant="outline"
                className="w-full text-purple-700"
                disabled={isFinal || status === 'under_review'}
                onClick={() => updateStatus('under_review')}
              >
                🔍 Mark Under Review
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <button type="button" className="fixed inset-0 z-50 bg-black/50" aria-label="Close" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-xl">
        {children}
      </div>
    </>
  )
}

function NotesSection({
  notes,
  showForm,
  setShowForm,
  noteText,
  setNoteText,
  onSave,
  onDelete,
}: {
  notes: Note[]
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
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive"
              onClick={() => onDelete(note.id)}
            >
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
