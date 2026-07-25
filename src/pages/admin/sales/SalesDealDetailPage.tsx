import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  AlertCircle,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessageCircle,
  Phone,
  Settings,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  closeAdminSalesDeal,
  formatPrice,
  getAdminSalesDeal,
  getSalesStageColor,
  getSalesStageLabel,
  markAdminSalesDealLost,
  type DealPriority,
  type SalesDeal,
  type SalesStage,
  updateAdminSalesDealOffer,
  updateAdminSalesDealPaymentPlan,
  updateAdminSalesDealStage,
  updateAdminSalesDealTokenPayment,
} from '@/api/adminSales'
import { readAdminSession } from '@/api/admin'
import { getAdminSalesTeam, type SalesPerson } from '@/api/adminEnquiries'
import { SentMessagesCard } from '@/components/admin/SentMessagesCard'
import { cn } from '@/lib/utils'
import {
  claimConcurrentEditing,
  getConcurrentEditingWarning,
  releaseConcurrentEditing,
} from '@/utils/edgeCases'
import {
  DEFAULT_SENT_BY,
  formatMessageTimeAgo,
  loadMessages,
  logMessage,
  messageToActivityText,
  openEmail,
  openWhatsApp,
  type SentMessage,
} from '@/utils/messageLog'
import { handleCall } from '@/utils/adminActions'
import { ActiveLeadsStage } from './stages/ActiveLeadsStage'
import { SiteVisitsStage } from './stages/SiteVisitsStage'
import { SalesNegotiationStage } from './stages/SalesNegotiationStage'
import { TokenPaymentStage } from './stages/TokenPaymentStage'
import { FullPaymentStage } from './stages/FullPaymentStage'
import { StagePaymentStage } from './stages/StagePaymentStage'
import { InteriorDesignStage } from './stages/InteriorDesignStage'
import { SalesDocumentationStage } from './stages/SalesDocumentationStage'
import { ClosedDealStage } from './stages/ClosedDealStage'
import { LostDealStage } from './stages/LostDealStage'
import { ReEngagementStage } from './stages/ReEngagementStage'

const STAGE_ROUTE_MAP: Record<SalesStage, string> = {
  active_leads: '/admin/sales/leads',
  site_visits: '/admin/sales/visits',
  negotiation: '/admin/sales/negotiation',
  token_payment: '/admin/sales/token',
  full_payment: '/admin/sales/fullpayment',
  stage_payment: '/admin/sales/stagepayment',
  interior_design: '/admin/sales/interior',
  documentation: '/admin/sales/documentation',
  closed: '/admin/sales/closed',
  lost: '/admin/sales/lost',
  re_engagement: '/admin/sales/reengagement',
}

const LOST_REASONS = [
  'Price too high',
  'Found better property',
  'Financial issues',
  'No response',
  'Changed mind',
  'Other',
] as const

const ALL_STAGES: SalesStage[] = [
  'active_leads',
  'site_visits',
  'negotiation',
  'token_payment',
  'full_payment',
  'stage_payment',
  'interior_design',
  'documentation',
  'closed',
  'lost',
  're_engagement',
]

const PROGRESS_STEPS = [
  { id: 'active_leads', label: 'Active Leads' },
  { id: 'site_visits', label: 'Site Visits' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'token_payment', label: 'Token Payment' },
  { id: 'payment', label: 'Payment' },
  { id: 'interior_design', label: 'Interior Design' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'closed', label: 'Closed' },
] as const

function stageToProgressIndex(stage: SalesStage): number {
  switch (stage) {
    case 'active_leads':
      return 0
    case 'site_visits':
      return 1
    case 'negotiation':
      return 2
    case 'token_payment':
      return 3
    case 'full_payment':
    case 'stage_payment':
      return 4
    case 'interior_design':
      return 5
    case 'documentation':
      return 6
    case 'closed':
      return 7
    default:
      return -1
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

function buyerTypeLabel(type: SalesDeal['buyerType']) {
  if (type === 'nri') return 'NRI'
  if (type === 'pio') return 'PIO'
  return 'Resident'
}

function PriorityBadge({ priority }: { priority: DealPriority }) {
  if (priority === 'urgent') return <Badge variant="red">Urgent</Badge>
  if (priority === 'high') return <Badge variant="orange">High</Badge>
  return null
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1100px] animate-pulse space-y-6 px-4 py-6">
      <div className="h-4 w-72 rounded bg-muted" />
      <div className="h-8 w-96 rounded bg-muted" />
      <div className="h-4 w-64 rounded bg-muted" />
      <div className="h-10 w-full max-w-lg rounded bg-muted" />
      <div className="h-24 rounded-xl bg-muted" />
      <div className="flex gap-6">
        <div className="h-64 flex-1 rounded-xl bg-muted" />
        <div className="h-96 w-[320px] rounded-xl bg-muted" />
      </div>
    </div>
  )
}

function StageProgressBar({ stage }: { stage: SalesStage }) {
  if (stage === 'lost') {
    return (
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <Badge variant="red" className="text-sm">
          Lost
        </Badge>
      </div>
    )
  }

  const progressIndex =
    stage === 're_engagement' ? stageToProgressIndex('negotiation') : stageToProgressIndex(stage)

  return (
    <div className="mt-4 space-y-3">
      {stage === 're_engagement' && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-800">
          Re-engagement
        </div>
      )}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between">
          {PROGRESS_STEPS.map((step, index) => {
            const isCompleted = progressIndex >= 0 && index < progressIndex
            const isCurrent = index === progressIndex
            const isLast = index === PROGRESS_STEPS.length - 1

            return (
              <div key={step.id} className={cn('flex flex-1 items-start', !isLast && 'min-w-0')}>
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full border-2',
                      isCompleted && 'border-green-600 bg-green-600 text-white',
                      isCurrent && 'border-yellow-500 bg-yellow-400 text-yellow-950 ring-2 ring-yellow-400/30',
                      !isCompleted && !isCurrent && 'border-border bg-muted',
                    )}
                  >
                    {isCompleted && <Check className="size-3.5" strokeWidth={3} />}
                    {isCurrent && <span className="size-2 rounded-full bg-yellow-950" />}
                  </div>
                  <span
                    className={cn(
                      'mt-1.5 max-w-[56px] text-center text-[10px] leading-tight sm:max-w-none sm:text-xs',
                      isCurrent && 'font-medium text-yellow-700',
                      (isCompleted || !isCurrent) && 'text-muted-foreground',
                    )}
                  >
                    {step.label}
                  </span>
                </div>
                {!isLast && (
                  <div
                    className={cn(
                      'mx-1 mt-3 h-0.5 flex-1 min-w-[6px]',
                      isCompleted ? 'bg-green-600' : 'bg-muted',
                    )}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SalesDealRightColumn({
  deal,
  onUpdate,
  toast,
  onToast,
  messageRefresh,
}: {
  deal: SalesDeal
  onUpdate: (patch: Partial<SalesDeal>) => void | Promise<void> | Promise<boolean>
  toast: string | null
  onToast: (msg: string | null) => void
  messageRefresh: number
}) {
  const navigate = useNavigate()
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([])

  useEffect(() => {
    void loadMessages('deal', deal.id).then(setSentMessages)
  }, [deal.id, messageRefresh])
  const [moveStage, setMoveStage] = useState<SalesStage | ''>('')
  const [showMoveConfirm, setShowMoveConfirm] = useState(false)
  const [showLostForm, setShowLostForm] = useState(false)
  const [lostReason, setLostReason] = useState('')
  const [lostNotes, setLostNotes] = useState('')

  const hideQuickActions = deal.stage === 'closed' || deal.stage === 'lost'

  const copyPhone = () => {
    void navigator.clipboard.writeText(deal.buyerPhone)
    onToast('Copied!')
  }

  const confirmMoveStage = () => {
    if (!moveStage) return
    onUpdate({ stage: moveStage })
    setShowMoveConfirm(false)
    setMoveStage('')
    navigate(STAGE_ROUTE_MAP[moveStage])
  }

  const confirmLost = () => {
    if (!lostReason || !lostNotes.trim()) return
    onUpdate({
      stage: 'lost',
      lostReason: `${lostReason}${lostNotes ? `: ${lostNotes}` : ''}`,
    })
    setShowLostForm(false)
    navigate('/admin/sales/lost')
  }

  return (
    <div className="w-[320px] shrink-0 space-y-4">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Buyer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-semibold text-white">
              {getInitials(deal.buyerName)}
            </span>
            <div>
              <p className="font-semibold">{deal.buyerName}</p>
              <Badge variant="blue" className="mt-0.5">
                {buyerTypeLabel(deal.buyerType)}
              </Badge>
            </div>
          </div>
          <button
            type="button"
            onClick={copyPhone}
            className="flex w-full items-center gap-2 text-left text-sm hover:text-primary"
          >
            <Phone className="size-3.5 shrink-0 text-muted-foreground" />
            {deal.buyerPhone}
          </button>
          {deal.buyerEmail ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-3.5 shrink-0" />
              {deal.buyerEmail}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">Not provided</p>
          )}
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => navigate(`/admin/users/${deal.buyerUserId}`)}
          >
            View Buyer Profile →
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Property</CardTitle>
        </CardHeader>
        <CardContent>
          {deal.photos[0] ? (
            <img
              src={deal.photos[0]}
              alt=""
              className="h-32 w-full rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-32 items-center justify-center rounded-lg bg-muted">
              <Building2 className="size-8 text-muted-foreground" />
            </div>
          )}
          <p className="mt-2 text-sm font-medium">{deal.propertyTitle}</p>
          <p className="font-bold text-primary">{formatPrice(deal.propertyPrice)}</p>
          {deal.agreedPrice != null && (
            <p className="text-sm font-medium text-green-700">
              Agreed: {formatPrice(deal.agreedPrice)}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="default" className="capitalize">
              {deal.propertyType}
            </Badge>
            <span className="text-xs text-muted-foreground">{deal.propertyLocation}</span>
          </div>
          <button
            type="button"
            className="mt-2 text-sm text-primary hover:underline"
            onClick={() => navigate(`/admin/properties/${deal.propertyId}`)}
          >
            View Property →
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Deal Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Listed Price</span>
            <span className="font-medium">{formatPrice(deal.propertyPrice)}</span>
          </div>
          {deal.offeredPrice != null && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Offered</span>
              <span className="font-medium">{formatPrice(deal.offeredPrice)}</span>
            </div>
          )}
          {deal.agreedPrice != null && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Agreed</span>
              <span className="font-medium text-green-700">{formatPrice(deal.agreedPrice)}</span>
            </div>
          )}
          {deal.tokenPaid && deal.tokenAmount != null && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Token Paid</span>
              <span className="font-medium">{formatPrice(deal.tokenAmount)}</span>
            </div>
          )}
          {deal.totalPaid > 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Total Paid</span>
              <span className="font-medium">{formatPrice(deal.totalPaid)}</span>
            </div>
          )}
          {deal.paymentType != null && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Payment Type</span>
              <span className="font-medium capitalize">{deal.paymentType}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {!hideQuickActions && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <select
              value={moveStage}
              onChange={(e) => {
                const val = e.target.value as SalesStage | ''
                setMoveStage(val)
                setShowMoveConfirm(Boolean(val))
                setShowLostForm(false)
              }}
              className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
            >
              <option value="">📋 Move Stage…</option>
              {ALL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {getSalesStageLabel(s)}
                </option>
              ))}
            </select>

            {showMoveConfirm && moveStage && (
              <div className="rounded-lg border border-border bg-muted p-3 text-sm">
                <p>Move deal to {getSalesStageLabel(moveStage)}?</p>
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" onClick={confirmMoveStage}>
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowMoveConfirm(false)
                      setMoveStage('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {!showLostForm ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-destructive text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setShowLostForm(true)
                  setShowMoveConfirm(false)
                  setMoveStage('')
                }}
              >
                ❌ Mark as Lost
              </Button>
            ) : (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/30 p-3">
                <select
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                >
                  <option value="">Select reason *</option>
                  {LOST_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={3}
                  value={lostNotes}
                  onChange={(e) => setLostNotes(e.target.value)}
                  placeholder="Notes *"
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={!lostReason || !lostNotes.trim()}
                    onClick={confirmLost}
                  >
                    Confirm
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowLostForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <SentMessagesCard messages={sentMessages} />

      {sentMessages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 border-l-2 border-border pl-4">
              {sentMessages.map((m) => (
                <li key={m.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" />
                  <p className="text-sm">{messageToActivityText(m)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMessageTimeAgo(m.sentAt)}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function SalesDealDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deal, setDeal] = useState<SalesDeal | null>(null)
  const [salesTeam, setSalesTeam] = useState<SalesPerson[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [whatsappOpen, setWhatsappOpen] = useState(false)
  const [whatsappBody, setWhatsappBody] = useState('')
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [messageRefresh, setMessageRefresh] = useState(0)
  const [editingWarning, setEditingWarning] = useState<string | null>(null)
  const [editingDismissed, setEditingDismissed] = useState(false)

  const logDealMessage = useCallback(
    (msg: Omit<SentMessage, 'id' | 'sentAt' | 'relatedTo' | 'sentBy'>) => {
      if (!deal) return
      logMessage({
        ...msg,
        sentBy: DEFAULT_SENT_BY,
        relatedTo: {
          type: 'deal',
          id: deal.id,
          title: deal.propertyTitle,
        },
      })
      setMessageRefresh((n) => n + 1)
    },
    [deal],
  )

  useEffect(() => {
    if (!id || loading) return
    setEditingWarning(getConcurrentEditingWarning('sales-deal', id))
    setEditingDismissed(false)
    claimConcurrentEditing('sales-deal', id)
    return () => releaseConcurrentEditing('sales-deal', id)
  }, [id, loading])

  const loadDeal = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    setLoadError(null)
    const session = readAdminSession()
    if (!session?.accessToken) {
      setDeal(null)
      setLoadError('Admin session expired. Please sign in again.')
      setLoading(false)
      return
    }
    try {
      const [loadedDeal, team] = await Promise.all([
        getAdminSalesDeal(session.accessToken, id),
        getAdminSalesTeam(session.accessToken),
      ])
      setDeal(loadedDeal)
      setSalesTeam(team)
    } catch (error) {
      setDeal(null)
      if (error instanceof Error && /not found/i.test(error.message)) {
        setNotFound(true)
      } else {
        setLoadError(error instanceof Error ? error.message : 'Unable to load sales deal.')
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadDeal()
  }, [loadDeal])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  const updateDeal = useCallback(
    async (patch: Partial<SalesDeal>): Promise<boolean> => {
      if (!deal) return false
      const session = readAdminSession()
      if (!session?.accessToken) {
        setToast('Admin session expired. Please sign in again.')
        return false
      }

      const hasOfferPatch = patch.offeredPrice !== undefined || patch.agreedPrice !== undefined
      const hasTokenPatch = patch.tokenAmount !== undefined || patch.tokenPaid !== undefined
      const hasPaymentPatch =
        patch.paymentType !== undefined ||
        patch.totalPaid !== undefined ||
        patch.fullPayment !== undefined ||
        patch.stagePayment !== undefined ||
        patch.interiorDesign !== undefined
      const stageChanged = Boolean(patch.stage && patch.stage !== deal.stage)
      const hasSupportedPatch = hasOfferPatch || hasTokenPatch || hasPaymentPatch || stageChanged
      if (!hasSupportedPatch) {
        setToast('This action needs a sales deal update endpoint from backend.')
        return false
      }

      setSaving(true)
      try {
        let saved = deal
        if (hasOfferPatch) {
          saved = await updateAdminSalesDealOffer(session.accessToken, deal.id, {
            ...(patch.offeredPrice !== undefined && { offeredPrice: patch.offeredPrice }),
            ...(patch.agreedPrice !== undefined && { agreedPrice: patch.agreedPrice }),
          })
        }
        if (hasTokenPatch) {
          saved = await updateAdminSalesDealTokenPayment(session.accessToken, deal.id, {
            ...(patch.tokenAmount !== undefined && { tokenAmount: patch.tokenAmount }),
            ...(patch.tokenPaid !== undefined && { tokenPaid: patch.tokenPaid }),
          })
        }
        if (hasPaymentPatch) {
          saved = await updateAdminSalesDealPaymentPlan(session.accessToken, deal.id, {
            ...(patch.paymentType !== undefined && { paymentType: patch.paymentType }),
            ...(patch.totalPaid !== undefined && { totalPaid: patch.totalPaid }),
            ...(patch.fullPayment !== undefined && { fullPayment: patch.fullPayment }),
            ...(patch.stagePayment !== undefined && { stagePayment: patch.stagePayment }),
            ...(patch.interiorDesign !== undefined && { interiorDesign: patch.interiorDesign }),
          })
        }
        if (patch.stage && patch.stage !== saved.stage) {
          if (patch.stage === 'closed') {
            saved = await closeAdminSalesDeal(session.accessToken, deal.id, {
              notes: 'Closed from admin sales workspace.',
            })
          } else if (patch.stage === 'lost') {
            saved = await markAdminSalesDealLost(session.accessToken, deal.id, {
              lostReason: patch.lostReason || 'Marked lost from admin sales workspace.',
            })
          } else {
            const body: Record<string, unknown> = {}
            if (patch.reengagementFollowUpAt || patch.reengagementLastContactAt || patch.reengagementAttempts !== undefined) {
              body.reengagement = {
                ...(patch.reengagementFollowUpAt && { followUpAt: patch.reengagementFollowUpAt }),
                ...(patch.reengagementLastContactAt && { lastContactAt: patch.reengagementLastContactAt }),
                ...(patch.reengagementAttempts !== undefined && { attempts: patch.reengagementAttempts }),
              }
            }
            saved = await updateAdminSalesDealStage(session.accessToken, deal.id, patch.stage, body)
          }
        }
        setDeal(saved)
        setToast('Deal updated')
        return true
      } catch (error) {
        setToast(error instanceof Error ? error.message : 'Unable to update deal.')
        return false
      } finally {
        setSaving(false)
      }
    },
    [deal],
  )

  const stageRoute = useMemo(
    () => (deal ? STAGE_ROUTE_MAP[deal.stage] : '/admin/sales/all'),
    [deal],
  )

  if (loading) {
    return <DetailSkeleton />
  }

  if (loadError || notFound || !deal) {
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-center gap-4 px-4 py-24">
        <AlertCircle className="size-16 text-muted-foreground" />
        <p className="text-lg font-medium text-foreground">
          {loadError ?? 'Deal not found'}
        </p>
        {loadError && (
          <Button type="button" variant="outline" onClick={() => void loadDeal()}>
            Retry
          </Button>
        )}
        <Button type="button" onClick={() => navigate('/admin/sales/all')}>
          Back to Sales Pipeline
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
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
      <nav className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 font-medium text-foreground shadow-sm backdrop-blur transition-all hover:-translate-x-0.5 hover:border-primary/30 hover:bg-background hover:text-primary hover:shadow"
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-muted">
            <ChevronLeft className="size-3.5" />
          </span>
          Back
        </button>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => navigate('/admin/sales/all')}
            className="text-muted-foreground hover:text-foreground"
          >
            Sales Pipeline
          </button>
          <ChevronRight className="size-4 text-muted-foreground" />
          <button
            type="button"
            onClick={() => navigate(stageRoute)}
            className="text-muted-foreground hover:text-foreground"
          >
            {getSalesStageLabel(deal.stage)}
          </button>
          <ChevronRight className="size-4 text-muted-foreground" />
          <span className="max-w-[200px] truncate font-medium text-foreground sm:max-w-md">
            {deal.buyerName}
          </span>
        </div>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold">{deal.buyerName}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm">
            <span className={cn('size-2.5 rounded-full', getSalesStageColor(deal.stage))} />
            {getSalesStageLabel(deal.stage)}
          </span>
          <PriorityBadge priority={deal.priority} />
          {saving && (
            <Badge variant="default" className="bg-muted text-muted-foreground">
              Saving...
            </Badge>
          )}
        </div>
      </div>

      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <span>{deal.referenceId}</span>
        <span>•</span>
        <span>Property: {deal.propertyTitle}</span>
        <span>•</span>
        <span>{deal.daysInStage} days in current stage</span>
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => handleCall(deal.buyerPhone)}
        >
          <Phone className="size-4" /> Call Buyer
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-green-600 hover:text-green-700"
          onClick={() => {
            setWhatsappBody(
              `Hi ${deal.buyerName}, regarding ${deal.propertyTitle} on BuiltGlory.`,
            )
            setWhatsappOpen(true)
          }}
        >
          <MessageCircle className="size-4" /> WhatsApp
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!deal.buyerEmail}
          onClick={() => {
            setEmailSubject(`BuiltGlory — ${deal.propertyTitle}`)
            setEmailBody(`Hi ${deal.buyerName},\n\nRegarding your interest in ${deal.propertyTitle}.`)
            setEmailOpen(true)
          }}
        >
          <Mail className="size-4" /> Email
        </Button>

        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setAssignOpen((v) => !v)
              setPriorityOpen(false)
            }}
          >
            👤 Assign To
          </Button>
          {assignOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 min-w-[160px] rounded-md border border-border bg-card py-1 shadow-md">
              {salesTeam.length > 0 ? (
                salesTeam.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      void updateDeal({ assignedTo: person.name, assignedToId: person.id })
                      setAssignOpen(false)
                    }}
                  >
                    {person.name}
                  </button>
                ))
              ) : (
                <span className="block px-3 py-2 text-sm text-muted-foreground">
                  No sales team found
                </span>
              )}
            </div>
          )}
        </div>

        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setPriorityOpen((v) => !v)
              setAssignOpen(false)
            }}
          >
            ⚑ Priority
          </Button>
          {priorityOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 min-w-[120px] rounded-md border border-border bg-card py-1 shadow-md">
              {(['urgent', 'high', 'normal'] as DealPriority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm capitalize hover:bg-muted"
                  onClick={() => {
                    updateDeal({ priority: p })
                    setPriorityOpen(false)
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <StageProgressBar stage={deal.stage} />

      <div className="mt-6 flex flex-col items-start gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          {deal.stage === 'active_leads' ? (
            <ActiveLeadsStage
              deal={deal}
              onStageChange={(newStage) => updateDeal({ stage: newStage })}
            />
          ) : deal.stage === 'site_visits' ? (
            <SiteVisitsStage
              deal={deal}
              onStageChange={(newStage) => updateDeal({ stage: newStage })}
            />
          ) : deal.stage === 'negotiation' ? (
            <SalesNegotiationStage
              deal={deal}
              onStageChange={(newStage, patch) => updateDeal({ stage: newStage, ...patch })}
            />
          ) : deal.stage === 'token_payment' ? (
            <TokenPaymentStage
              deal={deal}
              onStageChange={(newStage, patch) => updateDeal({ stage: newStage, ...patch })}
            />
          ) : deal.stage === 'full_payment' ? (
            <FullPaymentStage
              deal={deal}
              onStageChange={(newStage, patch) => updateDeal({ stage: newStage, ...patch })}
            />
          ) : deal.stage === 'stage_payment' ? (
            <StagePaymentStage
              deal={deal}
              onStageChange={(newStage, patch) => updateDeal({ stage: newStage, ...patch })}
            />
          ) : deal.stage === 'interior_design' ? (
            <InteriorDesignStage
              deal={deal}
              onStageChange={(newStage, patch) => updateDeal({ stage: newStage, ...patch })}
            />
          ) : deal.stage === 'documentation' ? (
            <SalesDocumentationStage
              deal={deal}
              onStageChange={(newStage, patch) => updateDeal({ stage: newStage, ...patch })}
            />
          ) : deal.stage === 'closed' ? (
            <ClosedDealStage
              deal={deal}
              onStageChange={(newStage, patch) => updateDeal({ stage: newStage, ...patch })}
            />
          ) : deal.stage === 'lost' ? (
            <LostDealStage
              deal={deal}
              onStageChange={(newStage, patch) => updateDeal({ stage: newStage, ...patch })}
            />
          ) : deal.stage === 're_engagement' ? (
            <ReEngagementStage
              deal={deal}
              onStageChange={(newStage, patch) => updateDeal({ stage: newStage, ...patch })}
            />
          ) : (
            <div className="rounded-xl bg-muted/50 p-8 text-center">
              <Settings className="mx-auto size-12 text-muted-foreground" />
              <p className="mt-3 font-medium text-foreground">Stage details coming soon</p>
              <p className="mt-1 text-sm text-muted-foreground">{getSalesStageLabel(deal.stage)}</p>
            </div>
          )}
        </div>
        <SalesDealRightColumn
          deal={deal}
          onUpdate={updateDeal}
          toast={toast}
          onToast={setToast}
          messageRefresh={messageRefresh}
        />
      </div>

      {whatsappOpen && (
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
                  logDealMessage({
                    channel: 'whatsapp',
                    to: deal.buyerPhone,
                    toName: deal.buyerName,
                    message: whatsappBody.trim(),
                  })
                  openWhatsApp(deal.buyerPhone, whatsappBody.trim())
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

      {emailOpen && deal.buyerEmail && (
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
                  logDealMessage({
                    channel: 'email',
                    to: deal.buyerEmail!,
                    toName: deal.buyerName,
                    subject: emailSubject,
                    message: emailBody,
                  })
                  openEmail(deal.buyerEmail!, emailSubject, emailBody)
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
