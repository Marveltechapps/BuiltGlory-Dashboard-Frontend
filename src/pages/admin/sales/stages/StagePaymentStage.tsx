import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileText, Phone, Upload, X } from 'lucide-react'
import NotificationPreview from '@/components/NotificationPreview'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatPrice,
  updateAdminSalesDealPaymentPlan,
  type SalesDeal,
  type SalesStage,
} from '@/api/adminSales'
import { readAdminSession } from '@/api/admin'
import { uploadWorkflowProof } from '@/api/adminWorkflow'
import {
  createStageCallLog,
  createStageNoteLog,
  deleteStageWorkflowLog,
  loadStageWorkflowLogs,
  workflowLogToStageCall,
  workflowLogToStageNote,
} from '@/pages/admin/workflowStagePersistence'
import { cn } from '@/lib/utils'
import { get72hrStatus, hoursSince } from '@/utils/timer'
import {
  amountsRoughlyEqual,
  parseRupeeAmount,
  splitAmountEvenly,
  stagePaymentBalance,
} from '@/utils/paymentAmounts'
import { NOTIFICATION_TEMPLATES, sendPushNotification } from '@/utils/notifications'

export interface StagePaymentStageProps {
  deal: SalesDeal
  onStageChange: (stage: SalesStage, patch?: Partial<SalesDeal>) => boolean | Promise<boolean>
}

type PaymentMethod = 'cash' | 'neft' | 'upi' | 'cheque'
type MilestoneStatus = 'pending' | 'in_progress' | 'paid' | 'overdue'

type MilestoneProofStatus = 'none' | 'submitted' | 'verified' | 'rejected'

interface Milestone {
  id: string
  index: number
  name: string
  dueDate: string
  plannedAmount: number
  paidAmount: number | null
  status: MilestoneStatus
  proofStatus: MilestoneProofStatus
  proofSubmittedAt: string | null
  wrongStageProof?: boolean
  payment?: Record<string, unknown>
}

type PlanBuyerStatus = 'none' | 'sent' | 'negotiating' | 'accepted' | 'declined'

interface DraftRow {
  name: string
  dueDate: string
  amount: string
}

interface CallLogEntry {
  id: string
  calledAt: string
  duration: number
  outcome: string
  notes: string
}

interface NoteEntry {
  id: string
  text: string
  at: string
}

const STAGE_COUNTS = [3, 4, 5, 6, 7, 8] as const
const STAGE_CIRCLE_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-green-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-amber-500',
]

const CALL_OUTCOMES = [
  'Interested',
  'Not Interested',
  'Callback Later',
  'No Answer',
  'Wrong Number',
] as const

const OUTCOME_STYLES: Record<string, string> = {
  Interested: 'bg-green-100 text-green-700',
  'Not Interested': 'bg-muted text-muted-foreground',
  'Callback Later': 'bg-blue-100 text-blue-700',
  'No Answer': 'bg-orange-100 text-orange-700',
  'Wrong Number': 'bg-red-100 text-red-700',
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  neft: 'NEFT',
  upi: 'UPI',
  cheque: 'Cheque',
}

const STAGE_PAYMENT_CALL_SUMMARY_PREFIX = 'Sales stage payment call'
const STAGE_PAYMENT_NOTE_SUMMARY = 'Sales stage payment note'
const STAGE_PAYMENT_PROOF_SUMMARY = 'Sales stage payment proof'

const STATUS_DISPLAY: Record<
  MilestoneStatus,
  { label: string; className: string }
> = {
  pending: { label: '⏳ Pending', className: 'text-muted-foreground' },
  in_progress: { label: '🔄 In Progress', className: 'text-blue-700' },
  paid: { label: '✅ Paid', className: 'text-green-700' },
  overdue: { label: '⚠️ Overdue', className: 'text-red-700' },
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function toDatetimeLocal(date = new Date()) {
  const d = new Date(date)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatCallDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatNoteTime(iso: string) {
  return formatCallDate(iso)
}

function formatShortDate(isoDate: string) {
  if (!isoDate) return '—'
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

function phoneForTel(phone: string) {
  return phone.replace(/\D/g, '')
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringOf(value: unknown, fallback = '') {
  if (value === null || value === undefined) return fallback
  return String(value)
}

function numberOf(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isMilestoneStatus(value: unknown): value is MilestoneStatus {
  return value === 'pending' || value === 'in_progress' || value === 'paid' || value === 'overdue'
}

function isMilestoneProofStatus(value: unknown): value is MilestoneProofStatus {
  return value === 'none' || value === 'submitted' || value === 'verified' || value === 'rejected'
}

function isPlanBuyerStatus(value: unknown): value is PlanBuyerStatus {
  return value === 'none' || value === 'sent' || value === 'negotiating' || value === 'accepted' || value === 'declined'
}

function milestonesFromRecord(value: unknown): Milestone[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const record = objectOf(item)
    return {
      id: stringOf(record.id, `ms-${index + 1}`),
      index: numberOf(record.index, index + 1),
      name: stringOf(record.name, `Milestone ${index + 1}`),
      dueDate: stringOf(record.dueDate),
      plannedAmount: numberOf(record.plannedAmount),
      paidAmount: record.paidAmount == null ? null : numberOf(record.paidAmount),
      status: isMilestoneStatus(record.status) ? record.status : index === 0 ? 'in_progress' : 'pending',
      proofStatus: isMilestoneProofStatus(record.proofStatus) ? record.proofStatus : 'none',
      proofSubmittedAt: record.proofSubmittedAt == null ? null : stringOf(record.proofSubmittedAt),
      wrongStageProof: Boolean(record.wrongStageProof),
    }
  })
}

function isOverdue(dueDate: string) {
  if (!dueDate) return false
  return new Date(`${dueDate}T12:00:00`) < new Date(`${todayIsoDate()}T12:00:00`)
}

function daysOverdue(dueDate: string) {
  if (!isOverdue(dueDate)) return 0
  const due = new Date(`${dueDate}T12:00:00`).getTime()
  const now = new Date(`${todayIsoDate()}T12:00:00`).getTime()
  return Math.max(1, Math.floor((now - due) / 86400000))
}

function emptyDraftRows(count: number, balance = 0): DraftRow[] {
  const amounts = splitAmountEvenly(balance, count)
  return Array.from({ length: count }, (_, index) => ({
    name: '',
    dueDate: '',
    amount: amounts[index] ? String(amounts[index]) : '',
  }))
}

function resolveDisplayStatus(m: Milestone): MilestoneStatus {
  if (m.status === 'paid') return 'paid'
  if (isOverdue(m.dueDate)) return 'overdue'
  if (m.status === 'in_progress') return 'in_progress'
  return 'pending'
}

export function StagePaymentStage({ deal, onStageChange }: StagePaymentStageProps) {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const agreed = deal.agreedPrice ?? 0
  const token = deal.tokenAmount ?? 0
  const balance = stagePaymentBalance(agreed, deal.tokenAmount)
  const hasToken = token > 0

  const [stageCount, setStageCount] = useState<number>(4)
  const [draftRows, setDraftRows] = useState<DraftRow[]>(() => emptyDraftRows(4, stagePaymentBalance(deal.agreedPrice ?? 0, deal.tokenAmount)))
  const [plan, setPlan] = useState<Milestone[] | null>(null)
  const [editingPlan, setEditingPlan] = useState(false)

  const [selectedMilestoneId, setSelectedMilestoneId] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null)
  const [payDate, setPayDate] = useState(todayIsoDate())
  const [payReference, setPayReference] = useState('')
  const [payProofUrl, setPayProofUrl] = useState<string | null>(null)
  const [payProofFile, setPayProofFile] = useState<File | null>(null)
  const [proofUploading, setProofUploading] = useState(false)
  const [payNotes, setPayNotes] = useState('')
  const [partialWarn, setPartialWarn] = useState(false)

  const [planSentAt, setPlanSentAt] = useState<string | null>(null)
  const [planBuyerStatus, setPlanBuyerStatus] = useState<PlanBuyerStatus>('none')
  const [showPlanSendModal, setShowPlanSendModal] = useState(false)
  const [showReminderModal, setShowReminderModal] = useState(false)
  const [showDocConfirm, setShowDocConfirm] = useState(false)
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [sendEmail, setSendEmail] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [rejectMilestoneId, setRejectMilestoneId] = useState<string | null>(null)
  const [milestoneRejectReason, setMilestoneRejectReason] = useState('')
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }, [])

  const dispatchPush = useCallback(
    async (
      template: { title: string; body: string; deepLink: string },
      notificationId: string,
      dedupeKey?: string,
    ) => {
      let msg = await sendPushNotification(deal.buyerName, template, notificationId, {
        dedupeKey,
        audience: 'buyer',
        userId: deal.buyerUserId,
        relatedTo: { type: 'deal', id: deal.id },
      })
      if (msg.includes('recently') && window.confirm(`${msg}\n\nSend again?`)) {
        msg = await sendPushNotification(deal.buyerName, template, notificationId, {
          skipDuplicateCheck: true,
          dedupeKey,
          audience: 'buyer',
          userId: deal.buyerUserId,
          relatedTo: { type: 'deal', id: deal.id },
        })
      }
      showToast(msg)
      return !msg.includes('recently')
    },
    [deal.buyerName, deal.buyerUserId, deal.id, showToast],
  )

  const [callLogs, setCallLogs] = useState<CallLogEntry[]>([])
  const [internalNotes, setInternalNotes] = useState<NoteEntry[]>([])
  const [showCallForm, setShowCallForm] = useState(false)
  const [callAt, setCallAt] = useState(toDatetimeLocal())
  const [callDuration, setCallDuration] = useState('')
  const [callOutcome, setCallOutcome] = useState<string>(CALL_OUTCOMES[0])
  const [callNotes, setCallNotes] = useState('')
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteText, setNoteText] = useState('')

  useEffect(() => {
    const saved = objectOf(deal.stagePayment)
    const savedPlan = milestonesFromRecord(saved.milestones)
    if (savedPlan.length > 0) {
      setPlan(savedPlan)
      setEditingPlan(false)
      setStageCount(savedPlan.length)
      setDraftRows(
        savedPlan.map((m) => ({
          name: m.name,
          dueDate: m.dueDate,
          amount: String(m.plannedAmount),
        })),
      )
      setSelectedMilestoneId(savedPlan.find((m) => m.status !== 'paid')?.id ?? '')
    }
    if (saved.planSentAt != null) setPlanSentAt(stringOf(saved.planSentAt) || null)
    if (isPlanBuyerStatus(saved.planBuyerStatus)) setPlanBuyerStatus(saved.planBuyerStatus)
  }, [deal.stagePayment])

  useEffect(() => {
    let cancelled = false
    void loadStageWorkflowLogs(
      'sales-deal',
      deal.id,
      STAGE_PAYMENT_CALL_SUMMARY_PREFIX,
      STAGE_PAYMENT_NOTE_SUMMARY,
    ).then(({ calls, notes }) => {
      if (cancelled) return
      setCallLogs(calls.map((log) => workflowLogToStageCall(log, CALL_OUTCOMES[0])))
      setInternalNotes(notes.map(workflowLogToStageNote))
    })
    return () => {
      cancelled = true
    }
  }, [deal.id])

  const draftTotal = useMemo(
    () => draftRows.reduce((sum, row) => sum + parseRupeeAmount(row.amount), 0),
    [draftRows],
  )

  const planTotal = useMemo(
    () => (plan ?? []).reduce((sum, milestone) => sum + milestone.plannedAmount, 0),
    [plan],
  )

  const planTotalMismatch = !amountsRoughlyEqual(draftTotal, balance)
  const savedPlanMismatch = plan != null && plan.length > 0 && !amountsRoughlyEqual(planTotal, balance)
  const canCreatePlan =
    !planTotalMismatch &&
    balance > 0 &&
    draftRows.every((r) => r.name.trim() && r.dueDate && parseRupeeAmount(r.amount) > 0)

  const milestones = useMemo(() => {
    if (!plan) return []
    return plan.map((m) => ({
      ...m,
      displayStatus: resolveDisplayStatus(m),
    }))
  }, [plan])

  const proofWaiting24hCount = useMemo(
    () =>
      milestones.filter(
        (m) =>
          m.proofStatus === 'submitted' &&
          m.proofSubmittedAt &&
          hoursSince(m.proofSubmittedAt) > 24,
      ).length,
    [milestones],
  )

  const paidReceived = useMemo(
    () => milestones.reduce((sum, m) => sum + (m.paidAmount ?? 0), 0),
    [milestones],
  )

  const persistStagePayment = useCallback(
    async (
      nextPlan: Milestone[],
      override: Partial<{
        planSentAt: string | null
        planBuyerStatus: PlanBuyerStatus
      }> = {},
    ) => {
      const session = readAdminSession()
      if (!session?.accessToken) throw new Error('Admin session expired. Please sign in again.')
      const nextPaid = nextPlan.reduce((sum, m) => sum + (m.paidAmount ?? 0), 0)
      const saved = await updateAdminSalesDealPaymentPlan(session.accessToken, deal.id, {
        paymentType: 'stage',
        totalPaid: token + nextPaid,
        stagePayment: {
          milestones: nextPlan,
          planSentAt: override.planSentAt !== undefined ? override.planSentAt : planSentAt,
          planBuyerStatus: override.planBuyerStatus ?? planBuyerStatus,
        },
      })
      onStageChange(deal.stage, {
        paymentType: saved.paymentType,
        totalPaid: saved.totalPaid,
        stagePayment: saved.stagePayment,
      })
    },
    [deal.id, deal.stage, onStageChange, planBuyerStatus, planSentAt, token],
  )

  const progressPct = balance > 0 ? Math.min(100, Math.round((paidReceived / balance) * 100)) : 0
  const allPaid = plan != null && plan.length > 0 && plan.every((m) => m.status === 'paid')

  const advanceToDocumentation = useCallback(
    async (collectedBalance: number) => {
      const advanced = await onStageChange('documentation', {
        totalPaid: token + collectedBalance,
        tokenPaid: true,
      })
      if (advanced) {
        navigate('/admin/sales/documentation')
      }
      return advanced
    },
    [navigate, onStageChange, token],
  )

  const selectableMilestones = milestones.filter(
    (m) => m.status === 'pending' || m.status === 'in_progress',
  )

  const selectedMilestone = milestones.find((m) => m.id === selectedMilestoneId)

  const payAmountNum = parseRupeeAmount(payAmount)
  const needsReference = payMethod === 'neft' || payMethod === 'upi'

  const futurePayDate = useMemo(() => {
    if (!payDate) return false
    return new Date(`${payDate}T12:00:00`) > new Date()
  }, [payDate])

  const canRecordPayment =
    selectedMilestone != null &&
    Number.isFinite(payAmountNum) &&
    payAmountNum > 0 &&
    payMethod != null &&
    payDate &&
    payProofUrl != null &&
    (!needsReference || payReference.trim())

  const reminderTarget = useMemo(() => {
    const overdue = milestones.filter(
      (m) => m.displayStatus === 'overdue' && m.status !== 'paid',
    )
    if (overdue.length > 0) return overdue[0]
    return milestones.find((m) => m.status === 'in_progress' || m.status === 'pending')
  }, [milestones])

  const planMessage = useMemo(() => {
    if (!plan) return ''
    const lines = plan.map(
      (m, i) =>
        `${i + 1}. ${m.name} — ${formatPrice(m.plannedAmount)} due ${formatShortDate(m.dueDate)}`,
    )
    return `Hi ${deal.buyerName}, here is the payment plan for ${deal.propertyTitle}:\n\n${lines.join('\n')}\n\nTotal balance: ${formatPrice(balance)}. Thank you!`
  }, [plan, deal, balance])

  const reminderMessage = useMemo(() => {
    if (!reminderTarget) return ''
    const status =
      reminderTarget.displayStatus === 'overdue' ? 'overdue' : 'upcoming'
    return `Hi ${deal.buyerName}, reminder: ${status} payment for "${reminderTarget.name}" (${formatPrice(reminderTarget.plannedAmount)}) due ${formatShortDate(reminderTarget.dueDate)} for ${deal.propertyTitle}. Please arrange payment at your earliest. Thank you!`
  }, [reminderTarget, deal])

  const handleStageCountChange = (count: number) => {
    setStageCount(count)
    setDraftRows((prev) => {
      const amounts = splitAmountEvenly(balance, count)
      return Array.from({ length: count }, (_, index) => ({
        name: prev[index]?.name ?? '',
        dueDate: prev[index]?.dueDate ?? '',
        amount: amounts[index] ? String(amounts[index]) : '',
      }))
    })
  }

  const splitDraftEvenly = () => {
    const amounts = splitAmountEvenly(balance, draftRows.length)
    setDraftRows((prev) =>
      prev.map((row, index) => ({
        ...row,
        amount: amounts[index] ? String(amounts[index]) : '',
      })),
    )
  }

  const updateDraftRow = (index: number, field: keyof DraftRow, value: string) => {
    setDraftRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    )
  }

  const planTimerStatus = planSentAt ? get72hrStatus(planSentAt) : null
  const planExpired = planTimerStatus?.status === 'expired'
  const negotiationExpired =
    planExpired && (planBuyerStatus === 'negotiating' || planBuyerStatus === 'sent')

  const allPaidPendingVerification = useMemo(() => {
    if (!plan?.length) return false
    const allHavePayment = plan.every((m) => m.paidAmount != null && m.paidAmount > 0)
    const anyUnverified = plan.some((m) => m.proofStatus !== 'verified')
    return allHavePayment && anyUnverified
  }, [plan])

  const planNotifyTemplate = NOTIFICATION_TEMPLATES.N10_STAGE_PAYMENT_PLAN(
    deal.buyerName,
    deal.propertyTitle,
  )

  const createPlan = () => {
    if (!canCreatePlan) return
    const created: Milestone[] = draftRows.map((row, i) => ({
      id: `ms-${i + 1}`,
      index: i + 1,
      name: row.name.trim(),
      dueDate: row.dueDate,
      plannedAmount: parseRupeeAmount(row.amount),
      paidAmount: null,
      status: i === 0 ? 'in_progress' : 'pending',
      proofStatus: 'none',
      proofSubmittedAt: null,
      wrongStageProof: false,
    }))
    setPlan(created)
    setEditingPlan(false)
    setPlanSentAt(null)
    setPlanBuyerStatus('none')
    setSelectedMilestoneId(created[0]?.id ?? '')
    setPayAmount(String(created[0]?.plannedAmount ?? ''))
    void persistStagePayment(created, { planSentAt: null, planBuyerStatus: 'none' }).catch((error) =>
      showToast(error instanceof Error ? error.message : 'Could not save payment plan'),
    )
  }

  const startEditPlan = () => {
    if (!plan) return
    setStageCount(plan.length)
    setDraftRows(
      plan.map((m) => ({
        name: m.name,
        dueDate: m.dueDate,
        amount: String(m.plannedAmount),
      })),
    )
    setEditingPlan(true)
    setPlan(null)
    setPlanSentAt(null)
    setPlanBuyerStatus('none')
  }

  const createNewPlanAfterExpiry = () => {
    setPlan(null)
    setEditingPlan(true)
    setPlanSentAt(null)
    setPlanBuyerStatus('none')
    setDraftRows(emptyDraftRows(stageCount, balance))
    showToast('Create a new payment plan for the buyer')
  }

  const sendPlanToBuyer = () => {
    if (!plan) return
    const now = new Date().toISOString()
    setPlanSentAt(now)
    setPlanBuyerStatus('sent')
    setPlan((prev) =>
      prev?.map((m, i) =>
        i === 0
          ? {
              ...m,
              proofStatus: 'submitted' as MilestoneProofStatus,
              proofSubmittedAt: now,
            }
          : m,
      ) ?? null,
    )
    if (plan) {
      const nextPlan = plan.map((m, i) =>
        i === 0
          ? {
              ...m,
              proofStatus: 'submitted' as MilestoneProofStatus,
              proofSubmittedAt: now,
            }
          : m,
      )
      void persistStagePayment(nextPlan, { planSentAt: now, planBuyerStatus: 'sent' }).catch((error) =>
        showToast(error instanceof Error ? error.message : 'Could not save buyer plan status'),
      )
    }
    dispatchPush(planNotifyTemplate, 'N-07', `N-07:plan:${deal.id}`)
    const tel = phoneForTel(deal.buyerPhone)
    if (sendWhatsApp) {
      window.open(
        `https://wa.me/${tel}?text=${encodeURIComponent(planMessage)}`,
        '_blank',
      )
    }
    if (sendEmail && deal.buyerEmail) {
      window.open(
        `mailto:${deal.buyerEmail}?subject=${encodeURIComponent('Payment plan')}&body=${encodeURIComponent(planMessage)}`,
        '_self',
      )
    }
    setShowPlanSendModal(false)
  }

  const updatePlanBuyerStatus = (status: PlanBuyerStatus) => {
    if (!plan) return
    setPlanBuyerStatus(status)
    void persistStagePayment(plan, { planBuyerStatus: status }).catch((error) =>
      showToast(error instanceof Error ? error.message : 'Could not save buyer plan status'),
    )
  }

  const [verifyPreviewMilestoneId, setVerifyPreviewMilestoneId] = useState<string | null>(
    null,
  )

  const verifyMilestoneProof = (milestoneId: string) => {
    const ms = plan?.find((m) => m.id === milestoneId)
    if (!ms) return
    if (verifyPreviewMilestoneId !== milestoneId) {
      setVerifyPreviewMilestoneId(milestoneId)
      return
    }
    setVerifyPreviewMilestoneId(null)
    let nextPlanForSave: Milestone[] | null = null
    setPlan((prev) => {
      if (!prev) return prev
      const updated = prev.map((m) =>
        m.id === milestoneId
          ? { ...m, proofStatus: 'verified' as MilestoneProofStatus }
          : m,
      )
      const nextIdx = updated.findIndex((m) => m.proofStatus !== 'verified' && m.status !== 'paid')
      if (nextIdx >= 0 && updated[nextIdx].status === 'pending') {
        nextPlanForSave = updated.map((m, i) =>
          i === nextIdx ? { ...m, status: 'in_progress' as MilestoneStatus } : m,
        )
        return nextPlanForSave
      }
      nextPlanForSave = updated
      return updated
    })
    if (nextPlanForSave) {
      void persistStagePayment(nextPlanForSave).catch((error) =>
        showToast(error instanceof Error ? error.message : 'Could not save proof verification'),
      )
    }
    const template = NOTIFICATION_TEMPLATES.N07_PAYMENT_BUYER(deal.buyerName, deal.propertyTitle)
    dispatchPush(template, 'N-07', `N-07:milestone:${deal.id}:${milestoneId}`)
    setRejectMilestoneId(null)
  }

  const rejectMilestoneProof = (milestoneId: string) => {
    if (!milestoneRejectReason.trim()) {
      showToast('Rejection reason required')
      return
    }
    if (!plan) return
    const ms = plan?.find((m) => m.id === milestoneId)
    if (!ms) return
    const nextPlan = plan.map((m) =>
      m.id === milestoneId
        ? {
            ...m,
            proofStatus: 'rejected' as MilestoneProofStatus,
            proofSubmittedAt: null,
          }
        : m,
    )
    setPlan(nextPlan)
    void persistStagePayment(nextPlan).catch((error) =>
      showToast(error instanceof Error ? error.message : 'Could not save proof rejection'),
    )
    const template = NOTIFICATION_TEMPLATES.N07_PAYMENT_BUYER(deal.buyerName, deal.propertyTitle)
    dispatchPush(
      {
        ...template,
        title: 'Proof Needs Resubmission',
        body: `${ms.name} proof rejected: ${milestoneRejectReason.trim()}. Please reupload.`,
      },
      'N-07',
      `N-07:milestone-reject:${deal.id}:${milestoneId}`,
    )
    setRejectMilestoneId(null)
    setMilestoneRejectReason('')
  }

  const recordStagePayment = async () => {
    if (!canRecordPayment || !selectedMilestone || !plan || !payMethod) return

    const planned = selectedMilestone.plannedAmount
    setPartialWarn(payAmountNum < planned)

    setProofUploading(true)
    try {
      const session = readAdminSession()
      if (!session?.accessToken) throw new Error('Admin session expired. Please sign in again.')
      let proofLogId: string | null = null
      let uploadedProofUrl = payProofUrl
      if (payProofFile) {
        const proofLog = await uploadWorkflowProof(session.accessToken, 'sales-deal', deal.id, payProofFile, {
          summary: STAGE_PAYMENT_PROOF_SUMMARY,
          notes: `${selectedMilestone.name}: ${payNotes.trim()}`,
        })
        proofLogId = proofLog.id
        uploadedProofUrl = proofLog.attachments[0]?.url || uploadedProofUrl
      }
      const updated = plan.map((m) => {
        if (m.id !== selectedMilestoneId) return m
        return {
          ...m,
          status: 'paid' as MilestoneStatus,
          paidAmount: payAmountNum,
          proofStatus: 'submitted' as MilestoneProofStatus,
          proofSubmittedAt: new Date(`${payDate}T12:00:00`).toISOString(),
          payment: {
            method: payMethod,
            paidAt: payDate,
            reference: needsReference ? payReference.trim() : null,
            notes: payNotes.trim(),
            proofUrl: uploadedProofUrl,
            proofLogId,
          },
        }
      })
      const nextIdx = updated.findIndex((m) => m.status !== 'paid')
      const nextPlan =
        nextIdx >= 0
          ? updated.map((m, i) =>
          i === nextIdx ? { ...m, status: 'in_progress' as MilestoneStatus } : m,
        )
          : updated
      setPlan(nextPlan)
      await persistStagePayment(nextPlan)
      setSelectedMilestoneId('')
      setPayAmount('')
      setPayMethod(null)
      setPayReference('')
      setPayProofUrl(null)
      setPayProofFile(null)
      setPayNotes('')
      setPartialWarn(false)
      const allNowPaid = nextPlan.length > 0 && nextPlan.every((m) => m.status === 'paid')
      if (allNowPaid) {
        const collectedBalance = nextPlan.reduce((sum, m) => sum + (m.paidAmount ?? 0), 0)
        await advanceToDocumentation(collectedBalance)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not record stage payment')
    } finally {
      setProofUploading(false)
    }
  }

  const saveCall = async () => {
    const duration = Number(callDuration)
    if (!callAt || !duration || duration < 1) return
    try {
      const log = await createStageCallLog(
        'sales-deal',
        deal.id,
        STAGE_PAYMENT_CALL_SUMMARY_PREFIX,
        new Date(callAt).toISOString(),
        duration,
        callOutcome,
        callNotes.trim(),
      )
      setCallLogs((prev) => [workflowLogToStageCall(log, CALL_OUTCOMES[0]), ...prev])
      setShowCallForm(false)
      setCallDuration('')
      setCallNotes('')
      setCallAt(toDatetimeLocal())
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save call')
    }
  }

  const saveNote = async () => {
    if (!noteText.trim()) return
    try {
      const log = await createStageNoteLog('sales-deal', deal.id, STAGE_PAYMENT_NOTE_SUMMARY, noteText.trim())
      setInternalNotes((prev) => [workflowLogToStageNote(log), ...prev])
      setNoteText('')
      setShowNoteForm(false)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save note')
    }
  }

  const deleteInternalNote = async (id: string) => {
    try {
      await deleteStageWorkflowLog(id)
      setInternalNotes((prev) => prev.filter((n) => n.id !== id))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not delete note')
    }
  }

  const showPlanBuilder = !plan || editingPlan

  const sendOverdueReminder = (m: Milestone) => {
    const msg = `Your stage payment of ${formatPrice(m.plannedAmount)} was due on ${formatShortDate(m.dueDate)}. Please complete payment.`
    const tel = phoneForTel(deal.buyerPhone)
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')
    showToast(`Reminder sent to ${deal.buyerName}`)
  }

  return (
    <div className="space-y-4">
      {proofWaiting24hCount > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          ⚠️ {proofWaiting24hCount} milestone proof
          {proofWaiting24hCount > 1 ? 's' : ''} waiting verification for over 24 hours
        </div>
      )}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      {planExpired && planSentAt && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">❌ Payment plan expired (72hrs).</p>
          <p className="mt-1">Buyer must request a new plan.</p>
          <Button type="button" size="sm" className="mt-2" onClick={createNewPlanAfterExpiry}>
            Create New Plan
          </Button>
        </div>
      )}

      {negotiationExpired && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          Negotiation expired — both parties must restart the payment plan.
        </div>
      )}

      {allPaidPendingVerification && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          All paid — pending admin verification
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Stage Payment Plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Agreed price</p>
                <p className="font-medium text-foreground">{formatPrice(agreed)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Token {hasToken ? 'paid' : 'not set'}</p>
                <p className="font-medium text-foreground">{hasToken ? formatPrice(token) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Balance to schedule</p>
                <p className="font-medium text-foreground">{formatPrice(balance)}</p>
              </div>
            </div>
          </div>

          {savedPlanMismatch && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
              Plan total {formatPrice(planTotal)} does not match balance due {formatPrice(balance)}.
              Edit the plan and rebalance milestone amounts.
            </div>
          )}

          {showPlanBuilder ? (
            <>
              <div>
                <p className="mb-2 text-sm font-medium">Number of stages</p>
                <div className="flex flex-wrap gap-2">
                  {STAGE_COUNTS.map((n) => (
                    <Button
                      key={n}
                      type="button"
                      size="sm"
                      variant={stageCount === n ? 'default' : 'outline'}
                      onClick={() => handleStageCountChange(n)}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {draftRows.map((row, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border p-3 space-y-2"
                  >
                    <p className="text-sm font-medium text-muted-foreground">
                      Stage {i + 1}
                    </p>
                    <input
                      value={row.name}
                      onChange={(e) => updateDraftRow(i, 'name', e.target.value)}
                      placeholder="e.g. Foundation Complete"
                      className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Due date</label>
                        <input
                          type="date"
                          value={row.dueDate}
                          onChange={(e) => updateDraftRow(i, 'dueDate', e.target.value)}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Amount (₹)</label>
                        <input
                          type="number"
                          min={0}
                          value={row.amount}
                          onChange={(e) => updateDraftRow(i, 'amount', e.target.value)}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                        />
                        {parseRupeeAmount(row.amount) > 0 && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {formatPrice(parseRupeeAmount(row.amount))}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Total: {formatPrice(draftTotal)}
                </p>
                <Button type="button" size="sm" variant="outline" onClick={splitDraftEvenly}>
                  Split balance evenly
                </Button>
              </div>
              {planTotalMismatch ? (
                <p className="text-sm text-red-700">
                  ❌ Must equal {formatPrice(balance)} · Difference:{' '}
                  {formatPrice(Math.abs(balance - draftTotal))}
                </p>
              ) : (
                <p className="text-sm text-green-700">✅ Amounts match</p>
              )}

              <Button
                type="button"
                className="w-full"
                disabled={!canCreatePlan}
                onClick={createPlan}
              >
                Send Plan
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-foreground">Payment Milestones</h4>
                  <p className="text-xs text-muted-foreground">
                    Plan total {formatPrice(planTotal)} · Balance due {formatPrice(balance)}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-sm text-primary hover:underline"
                  onClick={startEditPlan}
                >
                  Edit Plan
                </button>
              </div>

              {planSentAt && planTimerStatus && (
                <p
                  className={cn(
                    'text-sm font-medium',
                    planTimerStatus.status === 'valid' && 'text-green-700',
                    planTimerStatus.status === 'expiring' && 'text-amber-700',
                    planTimerStatus.status === 'expired' && 'text-red-700',
                  )}
                >
                  {planTimerStatus.status === 'valid' &&
                    `Plan valid for ${planTimerStatus.hoursRemaining}hrs`}
                  {planTimerStatus.status === 'expiring' &&
                    `Expires in ${planTimerStatus.hoursRemaining}hrs`}
                  {planTimerStatus.status === 'expired' && 'Plan expired'}
                </p>
              )}

              {planBuyerStatus === 'sent' && !planExpired && (
                <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/30 p-3">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => updatePlanBuyerStatus('accepted')}
                  >
                    ✅ Buyer Accepted Plan
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => updatePlanBuyerStatus('negotiating')}
                  >
                    💬 Negotiating
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={planExpired}
                    onClick={() => updatePlanBuyerStatus('declined')}
                  >
                    ❌ Declined
                  </Button>
                </div>
              )}

              <div className="space-y-3">
                {milestones.map((m) => {
                  const display = m.displayStatus
                  const meta = STATUS_DISPLAY[display]
                  const rejectPreview =
                    rejectMilestoneId === m.id
                      ? NOTIFICATION_TEMPLATES.N12_MILESTONE_REJECTED(
                          deal.buyerName,
                          m.name,
                          milestoneRejectReason.trim() || '…',
                        )
                      : null
                  return (
                    <div key={m.id} className="rounded-lg border border-border p-3">
                      <div className="flex gap-3">
                        <div
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
                            STAGE_CIRCLE_COLORS[(m.index - 1) % STAGE_CIRCLE_COLORS.length],
                          )}
                        >
                          {m.index}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">{m.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Due {formatShortDate(m.dueDate)} · {formatPrice(m.plannedAmount)}
                            {m.paidAmount != null && ` (paid ${formatPrice(m.paidAmount)})`}
                          </p>
                          <p className={cn('mt-1 text-xs font-medium', meta.className)}>
                            {meta.label}
                          </p>
                          {display === 'overdue' && m.status !== 'paid' && (
                            <>
                              <span className="mt-1 inline-flex rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                                Overdue
                              </span>
                              <p className="mt-1 text-xs font-medium text-red-700">
                                Due {daysOverdue(m.dueDate)} days ago
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-2"
                                onClick={() => sendOverdueReminder(m)}
                              >
                                Send Reminder
                              </Button>
                            </>
                          )}
                          {m.proofStatus === 'submitted' &&
                            m.proofSubmittedAt &&
                            hoursSince(m.proofSubmittedAt) > 24 && (
                              <span className="mt-1 inline-flex rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
                                Verify now ⚠️
                              </span>
                            )}
                          {m.wrongStageProof && m.proofStatus === 'submitted' && (
                            <p className="mt-1 text-xs text-orange-700">
                              Proof submitted for wrong stage
                            </p>
                          )}
                        </div>
                      </div>

                      {m.proofStatus === 'submitted' && !planExpired && (
                        <div className="mt-3 space-y-2 border-t border-border pt-3">
                          <p className="text-xs text-muted-foreground">
                            Buyer proof pending verification
                          </p>
                          {rejectMilestoneId === m.id ? (
                            <>
                              <input
                                value={milestoneRejectReason}
                                onChange={(e) => setMilestoneRejectReason(e.target.value)}
                                placeholder="Rejection reason (required)"
                                className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                              />
                              {rejectPreview && (
                                <NotificationPreview
                                  notificationId="N-07"
                                  title={rejectPreview.title}
                                  body={rejectPreview.body}
                                  deepLink="B-15"
                                />
                              )}
                              <p className="text-xs text-muted-foreground">
                                📱 Buyer will receive rejection notice
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => rejectMilestoneProof(m.id)}
                                >
                                  Reject & Notify Buyer
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setRejectMilestoneId(null)
                                    setMilestoneRejectReason('')
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </>
                          ) : (
                            <div className="space-y-2">
                              {verifyPreviewMilestoneId === m.id && (
                                <NotificationPreview
                                  notificationId="N-07"
                                  title="Milestone Verified! ✅"
                                  body={`${m.name} has been verified. Next payment stage is now active.`}
                                  deepLink="B-15"
                                />
                              )}
                              <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                className="bg-green-600 hover:bg-green-700"
                                onClick={() => verifyMilestoneProof(m.id)}
                              >
                                {verifyPreviewMilestoneId === m.id
                                  ? 'Confirm & Send N-07'
                                  : 'Verify milestone'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setRejectMilestoneId(m.id)
                                  setVerifyPreviewMilestoneId(null)
                                }}
                              >
                                Reject proof
                              </Button>
                            </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {formatPrice(paidReceived)} of {formatPrice(balance)} received
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={planExpired && planSentAt != null}
                onClick={() => setShowPlanSendModal(true)}
              >
                {planSentAt ? 'Resend Plan to Buyer' : 'Send Plan to Buyer'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {plan && !editingPlan && (
        <Card>
          <CardHeader>
            <CardTitle>Record Stage Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Which stage?</label>
              <select
                value={selectedMilestoneId}
                onChange={(e) => {
                  const id = e.target.value
                  setSelectedMilestoneId(id)
                  const ms = plan.find((m) => m.id === id)
                  if (ms) setPayAmount(String(ms.plannedAmount))
                  setPartialWarn(false)
                }}
                className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              >
                <option value="">Select milestone…</option>
                {selectableMilestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    Stage {m.index}: {m.name} ({formatPrice(m.plannedAmount)})
                  </option>
                ))}
              </select>
            </div>

            {selectedMilestoneId && (
              <>
                <div>
                  <label className="text-sm font-medium">Amount (₹) *</label>
                  <input
                    type="number"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  {partialWarn && (
                    <p className="mt-1 text-sm text-orange-700">
                      Amount less than milestone amount
                    </p>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium">Payment method *</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(['cash', 'neft', 'upi', 'cheque'] as PaymentMethod[]).map((m) => (
                      <Button
                        key={m}
                        type="button"
                        variant={payMethod === m ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setPayMethod(m)
                          setPayReference('')
                        }}
                      >
                        {METHOD_LABELS[m]}
                      </Button>
                    ))}
                  </div>
                </div>

                {needsReference && (
                  <div>
                    <label className="text-sm font-medium">UTR / Reference *</label>
                    <input
                      value={payReference}
                      onChange={(e) => setPayReference(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium">Payment date *</label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  {futurePayDate && (
                    <p className="mt-1 text-xs text-orange-700">Payment date is in the future</p>
                  )}
                </div>

                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        if (payProofUrl?.startsWith('blob:')) URL.revokeObjectURL(payProofUrl)
                        setPayProofUrl(URL.createObjectURL(file))
                        setPayProofFile(file)
                      }
                      e.target.value = ''
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border py-6 text-sm text-muted-foreground hover:bg-muted/50"
                  >
                    <Upload className="size-6" />
                    Upload proof *
                  </button>
                  {payProofUrl && (
                    <img
                      src={payProofUrl}
                      alt="Payment proof"
                      className="mt-2 h-24 rounded-lg object-cover"
                    />
                  )}
                  {!payProofUrl && (
                    <p className="mt-1 text-xs text-orange-700">Payment proof required</p>
                  )}
                </div>

                <textarea
                  rows={2}
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                />

                <Button
                  type="button"
                  className="w-full"
                  disabled={!canRecordPayment || proofUploading}
                  onClick={() => {
                    if (
                      selectedMilestone &&
                      payAmountNum < selectedMilestone.plannedAmount
                    ) {
                      setPartialWarn(true)
                    }
                    recordStagePayment()
                  }}
                >
                  {proofUploading ? 'Recording...' : 'Record Payment'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {showPlanSendModal && plan && (
        <PlanSendModal
          message={planMessage}
          buyerPhone={deal.buyerPhone}
          buyerEmail={deal.buyerEmail}
          sendWhatsApp={sendWhatsApp}
          sendEmail={sendEmail}
          onToggleWhatsApp={setSendWhatsApp}
          onToggleEmail={setSendEmail}
          onClose={() => setShowPlanSendModal(false)}
          onSend={sendPlanToBuyer}
          notifyTemplate={planNotifyTemplate}
          planExpired={planExpired}
          planBuyerStatus={planBuyerStatus}
        />
      )}

      {showReminderModal && reminderTarget && (
        <SendModal
          title="Send payment reminder"
          message={reminderMessage}
          buyerPhone={deal.buyerPhone}
          buyerEmail={deal.buyerEmail}
          sendWhatsApp={sendWhatsApp}
          sendEmail={sendEmail}
          onToggleWhatsApp={setSendWhatsApp}
          onToggleEmail={setSendEmail}
          onClose={() => setShowReminderModal(false)}
        />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Call Log</CardTitle>
          {!showCallForm && (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCallForm(true)}>
              + Log Call
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {showCallForm && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <input
                type="datetime-local"
                value={callAt}
                onChange={(e) => setCallAt(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              />
              <div className="flex items-end gap-2">
                <input
                  type="number"
                  min={1}
                  value={callDuration}
                  onChange={(e) => setCallDuration(e.target.value)}
                  className="h-9 flex-1 rounded-md border border-border bg-input px-3 text-sm"
                />
                <span className="pb-2 text-sm text-muted-foreground">minutes</span>
              </div>
              <select
                value={callOutcome}
                onChange={(e) => setCallOutcome(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              >
                {CALL_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <textarea
                rows={3}
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={saveCall}>
                  Save
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCallForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {callLogs.length === 0 && !showCallForm && (
            <div className="py-6 text-center">
              <Phone className="mx-auto size-10 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">No calls logged yet</p>
            </div>
          )}
          {callLogs.map((log) => (
            <div key={log.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLES[log.outcome] ?? 'bg-muted text-muted-foreground'}`}
                >
                  {log.outcome}
                </span>
                <span className="text-xs text-muted-foreground">
                  {log.duration} min · {formatCallDate(log.calledAt)}
                </span>
              </div>
              {log.notes && <p className="mt-2 text-sm text-muted-foreground">{log.notes}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Internal Notes</CardTitle>
          {!showNoteForm && (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowNoteForm(true)}>
              + Add Note
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {showNoteForm && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <textarea
                rows={3}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={saveNote}>
                  Save
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowNoteForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {internalNotes.length === 0 && !showNoteForm && (
            <div className="py-6 text-center">
              <FileText className="mx-auto size-10 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">No notes yet</p>
            </div>
          )}
          {internalNotes.map((note) => (
            <div
              key={note.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{note.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatNoteTime(note.at)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => deleteInternalNote(note.id)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-t-4 border-primary">
        <CardContent className="space-y-3 p-6">
          <h3 className="font-semibold text-foreground">Next Action</h3>
          {!plan || editingPlan ? (
            <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
              Create payment plan first
            </p>
          ) : allPaid ? (
            showDocConfirm ? (
              <div className="rounded-lg border border-border bg-muted p-4 text-sm">
                <p>Move deal to documentation stage?</p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      void advanceToDocumentation(paidReceived).then((advanced) => {
                        if (advanced) setShowDocConfirm(false)
                      })
                    }}
                  >
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDocConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={() => setShowDocConfirm(true)}
              >
                📄 Move to Documentation
              </Button>
            )
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {formatPrice(paidReceived)} of {formatPrice(balance)} collected —{' '}
                {milestones.filter((m) => m.status === 'paid').length} of {plan.length} stages paid
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setShowReminderModal(true)}
                disabled={!reminderTarget}
              >
                📤 Send Payment Reminder
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PlanSendModal(props: {
  message: string
  buyerPhone: string
  buyerEmail: string
  sendWhatsApp: boolean
  sendEmail: boolean
  onToggleWhatsApp: (v: boolean) => void
  onToggleEmail: (v: boolean) => void
  onClose: () => void
  onSend: () => void
  notifyTemplate: { title: string; body: string; deepLink: string }
  planExpired: boolean
  planBuyerStatus: PlanBuyerStatus
}) {
  const {
    message,
    sendWhatsApp,
    sendEmail,
    onToggleWhatsApp,
    onToggleEmail,
    onClose,
    onSend,
    notifyTemplate,
    planExpired,
    planBuyerStatus,
  } = props

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lg">
        <h4 className="font-semibold">Send payment plan to buyer</h4>
        <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
          {message}
        </p>
        <div className="mt-3 space-y-1">
          <p className="text-sm font-medium">📱 Buyer will receive:</p>
          <NotificationPreview
            notificationId="N-07"
            title={notifyTemplate.title}
            body={notifyTemplate.body}
            deepLink={notifyTemplate.deepLink || 'B-15'}
          />
        </div>
        {planExpired && planBuyerStatus === 'negotiating' && (
          <p className="mt-2 text-sm text-orange-700">Negotiation expired — restart required.</p>
        )}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendWhatsApp}
            onChange={(e) => onToggleWhatsApp(e.target.checked)}
          />
          WhatsApp
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => onToggleEmail(e.target.checked)}
          />
          Email
        </label>
        <div className="mt-4 flex gap-2">
          <Button type="button" size="sm" onClick={onSend}>
            Send Plan & Notify Buyer
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

function SendModal(props: {
  title: string
  message: string
  buyerPhone: string
  buyerEmail: string
  sendWhatsApp: boolean
  sendEmail: boolean
  onToggleWhatsApp: (v: boolean) => void
  onToggleEmail: (v: boolean) => void
  onClose: () => void
}) {
  const {
    title,
    message,
    buyerPhone,
    buyerEmail,
    sendWhatsApp,
    sendEmail,
    onToggleWhatsApp,
    onToggleEmail,
    onClose,
  } = props

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
        <h4 className="font-semibold">{title}</h4>
        <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
          {message}
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendWhatsApp}
            onChange={(e) => onToggleWhatsApp(e.target.checked)}
          />
          WhatsApp
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => onToggleEmail(e.target.checked)}
          />
          Email
        </label>
        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const tel = phoneForTel(buyerPhone)
              if (sendWhatsApp) {
                window.open(
                  `https://wa.me/${tel}?text=${encodeURIComponent(message)}`,
                  '_blank',
                )
              }
              if (sendEmail && buyerEmail) {
                window.open(
                  `mailto:${buyerEmail}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`,
                  '_self',
                )
              }
              onClose()
            }}
          >
            Send
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
