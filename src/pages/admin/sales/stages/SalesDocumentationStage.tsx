import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, Building2, FileText, Home, Key, Phone, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  createInitialSalesDocuments,
  LegalDocumentChecklist,
  useLegalDocumentStats,
  type LegalDocumentItem,
} from '@/pages/admin/stages/LegalDocumentChecklist'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatPrice,
  updateAdminSalesDealDocumentation,
  type SalesDeal,
  type SalesStage,
} from '@/api/adminSales'
import { readAdminSession } from '@/api/admin'
import { createWorkflowLog, deleteWorkflowLog, listWorkflowLogs, type WorkflowLog } from '@/api/adminWorkflow'
import { cn } from '@/lib/utils'
import { NOTIFICATION_TEMPLATES, sendPushNotification } from '@/utils/notifications'

export interface SalesDocumentationStageProps {
  deal: SalesDeal
  onStageChange: (stage: SalesStage, patch?: Partial<SalesDeal>) => boolean | Promise<boolean>
}

interface RegistrationDetails {
  registrationDate: string
  registrationOffice: string
  subRegistrarName: string
  stampDuty: number
  registrationFee: number
  notes: string
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

const HANDOVER_ITEMS = [
  'Keys handed over to buyer',
  'Property inspection done',
  'Meter readings recorded',
  'Society introduction done',
  'Maintenance docs handed over',
  'Buyer acknowledgment received',
] as const

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

type OwnershipType = 'freehold' | 'leasehold'

type LessorType =
  | 'Government'
  | 'Semi-Government'
  | 'Private'
  | 'Religious Trust'

const LEASEHOLD_REQUIRED_DOCS = [
  { id: 'leasehold_lease_deed', name: 'Lease Deed (Original)' },
  { id: 'leasehold_noc_lessor', name: 'NOC from Lessor for Sale' },
  { id: 'leasehold_lease_period_cert', name: 'Lease Period Certificate' },
] as const

const LEASEHOLD_DOC_IDS = new Set<string>(LEASEHOLD_REQUIRED_DOCS.map((d) => d.id))

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

function formatReceiptDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

function parseRequiredDocIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function parseDocumentItems(value: unknown): LegalDocumentItem[] | null {
  return Array.isArray(value) ? value as LegalDocumentItem[] : null
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

const SALES_DOC_NOTE_SUMMARY = 'Sales documentation note'
const SALES_DOC_CALL_SUMMARY_PREFIX = 'Sales documentation call'

function workflowLogToCallEntry(log: WorkflowLog): CallLogEntry {
  return {
    id: log.id,
    calledAt: log.occurredAt,
    duration: log.durationMinutes ?? 0,
    outcome: log.outcome || CALL_OUTCOMES[0],
    notes: log.body || '',
  }
}

function workflowLogToNoteEntry(log: WorkflowLog): NoteEntry {
  return {
    id: log.id,
    text: log.body || log.summary,
    at: log.occurredAt,
  }
}

export function SalesDocumentationStage({ deal, onStageChange }: SalesDocumentationStageProps) {
  const navigate = useNavigate()

  const agreed = deal.agreedPrice ?? 0
  const token = deal.tokenAmount
  const totalPaid = deal.totalPaid
  const balance = Math.max(0, agreed - totalPaid)
  const fullyPaid = balance <= 0
  const requiredDocIds = parseRequiredDocIds(deal.documentation?.requiredDocIds)

  const [documents, setDocuments] = useState<LegalDocumentItem[]>(() =>
    parseDocumentItems(deal.documentation?.documents) ?? createInitialSalesDocuments(requiredDocIds),
  )
  const [customDocs, setCustomDocs] = useState<LegalDocumentItem[]>(
    () => parseDocumentItems(deal.documentation?.customDocs) ?? [],
  )

  const ownershipCardRef = useRef<HTMLDivElement>(null)
  const [ownershipType, setOwnershipType] = useState<OwnershipType | null>(null)
  const [ownershipSaved, setOwnershipSaved] = useState(false)
  const [leasePeriodYears, setLeasePeriodYears] = useState('')
  const [leaseStartDate, setLeaseStartDate] = useState('')
  const [lessorName, setLessorName] = useState('')
  const [lessorType, setLessorType] = useState<LessorType>('Government')
  const [nocFromLessor, setNocFromLessor] = useState<boolean | null>(null)

  const [registration, setRegistration] = useState<RegistrationDetails | null>(null)
  const [editingRegistration, setEditingRegistration] = useState(true)
  const [regDate, setRegDate] = useState('')
  const [regOffice, setRegOffice] = useState('')
  const [subRegistrar, setSubRegistrar] = useState('')
  const [stampDuty, setStampDuty] = useState('')
  const [regFee, setRegFee] = useState('')
  const [regNotes, setRegNotes] = useState('')

  const [handoverChecks, setHandoverChecks] = useState<boolean[]>(
    () => Array.isArray(deal.documentation?.handoverChecks)
      ? HANDOVER_ITEMS.map((_, index) => Boolean((deal.documentation?.handoverChecks as unknown[])[index]))
      : HANDOVER_ITEMS.map(() => false),
  )
  const [handoverDate, setHandoverDate] = useState(
    () => String(deal.documentation?.handoverDate ?? '').slice(0, 10),
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

  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(
    null,
  )
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  const registrationDaysUntil = useMemo(() => {
    const date = registration?.registrationDate ?? regDate
    if (!date?.trim()) return null
    return Math.floor(
      (new Date(`${date.slice(0, 10)}T12:00:00`).getTime() - Date.now()) / 86400000,
    )
  }, [registration, regDate])

  const { allRequiredVerified, anyUploadedNotVerified } = useLegalDocumentStats(
    documents,
    customDocs,
  )

  const handoverDoneCount = handoverChecks.filter(Boolean).length
  const handoverComplete = handoverDoneCount === HANDOVER_ITEMS.length

  const paymentTypeLabel =
    deal.paymentType === 'full'
      ? 'Full'
      : deal.paymentType === 'stage'
        ? 'Stage'
        : '—'

  const warnings = useMemo(() => {
    const list: { text: string; tone: 'orange' | 'soft' | 'red' }[] = []
    if (balance > 0) {
      list.push({
        text: `Balance pending: ${formatPrice(balance)} — resolve before closing`,
        tone: 'orange',
      })
    }
    if (anyUploadedNotVerified) {
      list.push({ text: 'Verify docs before closing', tone: 'orange' })
    }
    if (!registration) {
      list.push({ text: 'Registration details missing', tone: 'soft' })
    }
    if (!handoverDate) {
      list.push({ text: 'Scheduled handover date not set', tone: 'soft' })
    }
    return list
  }, [balance, anyUploadedNotVerified, registration, handoverDate])

  const leaseYearsRemaining = useMemo(() => {
    const period = Number(leasePeriodYears)
    if (!leaseStartDate || !Number.isFinite(period) || period <= 0) return null
    const start = new Date(`${leaseStartDate.slice(0, 10)}T12:00:00`)
    if (Number.isNaN(start.getTime())) return null
    const elapsedYears =
      (Date.now() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    return Math.max(0, Math.round((period - elapsedYears) * 10) / 10)
  }, [leasePeriodYears, leaseStartDate])

  const isBdaLessor = useMemo(() => {
    const name = lessorName.trim().toUpperCase()
    return name.includes('BDA') || name.includes('KIADB')
  }, [lessorName])

  const hasVerifiedDocs = useMemo(
    () =>
      [...documents, ...customDocs].some((d) =>
        (d.files ?? []).some((f) => f.status === 'verified'),
      ),
    [documents, customDocs],
  )

  useEffect(() => {
    const saved = deal.documentation?.ownershipType
    if (saved === 'freehold' || saved === 'leasehold') {
      setOwnershipType(saved)
      setOwnershipSaved(true)
    } else {
      setOwnershipType(null)
      setOwnershipSaved(false)
    }
  }, [deal.documentation?.ownershipType])

  useEffect(() => {
    const saved = objectOf(deal.documentation?.registration)
    const details: RegistrationDetails | null = saved.registrationDate
      ? {
          registrationDate: String(saved.registrationDate),
          registrationOffice: String(saved.registrationOffice ?? ''),
          subRegistrarName: String(saved.subRegistrarName ?? ''),
          stampDuty: Number(saved.stampDuty) || 0,
          registrationFee: Number(saved.registrationFee) || 0,
          notes: String(saved.notes ?? ''),
        }
      : null
    setRegistration(details)
    setEditingRegistration(!details)
    setRegDate(details?.registrationDate ?? '')
    setRegOffice(details?.registrationOffice ?? '')
    setSubRegistrar(details?.subRegistrarName ?? '')
    setStampDuty(details ? String(details.stampDuty) : '')
    setRegFee(details ? String(details.registrationFee) : '')
    setRegNotes(details?.notes ?? '')
  }, [deal.documentation?.registration])

  useEffect(() => {
    const session = readAdminSession()
    if (!session?.accessToken || !deal.id) {
      setCallLogs([])
      setInternalNotes([])
      return
    }

    let cancelled = false
    void Promise.all([
      listWorkflowLogs(session.accessToken, 'sales-deal', deal.id, 'call').catch(() => ({ data: [] as WorkflowLog[] })),
      listWorkflowLogs(session.accessToken, 'sales-deal', deal.id, 'note').catch(() => ({ data: [] as WorkflowLog[] })),
    ]).then(([callResult, noteResult]) => {
      if (cancelled) return
      setCallLogs(
        callResult.data
          .filter((log) => log.summary.startsWith(SALES_DOC_CALL_SUMMARY_PREFIX))
          .map(workflowLogToCallEntry),
      )
      setInternalNotes(
        noteResult.data
          .filter((log) => log.summary === SALES_DOC_NOTE_SUMMARY)
          .map(workflowLogToNoteEntry),
      )
    })

    return () => {
      cancelled = true
    }
  }, [deal.id])

  useEffect(() => {
    if (ownershipSaved && ownershipType === 'freehold') {
      setPersistedCustomDocs((prev) => prev.filter((d) => !LEASEHOLD_DOC_IDS.has(d.id)))
      return
    }
    if (!ownershipSaved || ownershipType !== 'leasehold') return

    setPersistedCustomDocs((prev) => {
      let next = [...prev]
      let changed = false
      for (const def of LEASEHOLD_REQUIRED_DOCS) {
        const existing = next.find((d) => d.id === def.id)
        if (existing) {
          if (!existing.required || existing.name !== def.name) {
            next = next.map((d) =>
              d.id === def.id
                ? { ...d, required: true, name: def.name, isCustom: true }
                : d,
            )
            changed = true
          }
        } else {
          next.push({
            id: def.id,
            name: def.name,
            required: true,
            files: [],
            isCustom: true,
          })
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [customDocs, ownershipSaved, ownershipType])

  const showToastMsg = (msg: string) => {
    setToast({ message: msg, variant: 'success' })
    setTimeout(() => setToast(null), 2500)
  }

  const showToastError = (msg: string) => {
    setToast({ message: msg, variant: 'error' })
    setTimeout(() => setToast(null), 3000)
  }

  const persistDocumentationPatch = async (patch: Record<string, unknown>) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToastError('Admin session expired. Please sign in again.')
      return
    }
    try {
      const saved = await updateAdminSalesDealDocumentation(session.accessToken, deal.id, {
        ...deal.documentation,
        ...patch,
      })
      onStageChange(saved.stage, { documentation: saved.documentation })
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not save documentation update')
    }
  }

  const setPersistedDocuments: Dispatch<SetStateAction<LegalDocumentItem[]>> = (updater) => {
    setDocuments((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      void persistDocumentationPatch({ documents: next, customDocs })
      return next
    })
  }

  const setPersistedCustomDocs: Dispatch<SetStateAction<LegalDocumentItem[]>> = (updater) => {
    setCustomDocs((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      void persistDocumentationPatch({ documents, customDocs: next })
      return next
    })
  }

  const selectOwnershipType = (type: OwnershipType) => {
    if (ownershipSaved && ownershipType && ownershipType !== type) {
      if (
        hasVerifiedDocs &&
        !window.confirm(
          'Changing ownership type will require additional documents. Verified docs remain verified.',
        )
      ) {
        return
      }
      setOwnershipSaved(false)
    }
    setOwnershipType(type)
  }

  const confirmOwnershipType = () => {
    if (!ownershipType) return
    void persistDocumentationPatch({
      ownershipType,
      leaseDetails:
        ownershipType === 'leasehold'
          ? {
              leasePeriodYears: Number(leasePeriodYears) || null,
              leaseStartDate: leaseStartDate || null,
              lessorName: lessorName.trim(),
              lessorType,
              nocFromLessor,
            }
          : null,
    })
    setOwnershipSaved(true)
    const label =
      ownershipType === 'freehold'
        ? 'Freehold (Ownership Land)'
        : 'Leasehold (Lease Land)'
    showToastMsg(`Ownership type confirmed: ${label}`)
  }

  const scrollToOwnershipCard = () => {
    ownershipCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tryProceedToNextStage = (action: () => void) => {
    if (!ownershipSaved || ownershipType == null) {
      showToastError('Please select and confirm ownership type before proceeding')
      scrollToOwnershipCard()
      return
    }
    action()
  }

  const saveRegistration = () => {
    if (!regDate.trim()) return
    const nextRegistration = {
      registrationDate: regDate,
      registrationOffice: regOffice.trim(),
      subRegistrarName: subRegistrar.trim(),
      stampDuty: Number(stampDuty) || 0,
      registrationFee: Number(regFee) || 0,
      notes: regNotes.trim(),
    }
    setRegistration(nextRegistration)
    void persistDocumentationPatch({ registration: nextRegistration })
    setEditingRegistration(false)
    const template = NOTIFICATION_TEMPLATES.N08_REGISTRATION(deal.buyerName, 'buyer')
    sendPushNotification(deal.buyerName, template, 'N-08', {
      dedupeKey: `N-08:buyer:${deal.id}:${regDate}`,
      audience: 'buyer',
      userId: deal.buyerUserId,
      relatedTo: { type: 'deal', id: deal.id },
    })
  }

  const startEditRegistration = () => {
    if (!registration) return
    setRegDate(registration.registrationDate)
    setRegOffice(registration.registrationOffice)
    setSubRegistrar(registration.subRegistrarName)
    setStampDuty(String(registration.stampDuty))
    setRegFee(String(registration.registrationFee))
    setRegNotes(registration.notes)
    setEditingRegistration(true)
  }

  const saveCall = async () => {
    const duration = Number(callDuration)
    if (!callAt || !duration || duration < 1) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToastError('Admin session expired. Please sign in again.')
      return
    }
    try {
      const log = await createWorkflowLog(session.accessToken, 'sales-deal', deal.id, {
        channel: 'call',
        direction: 'outbound',
        summary: `${SALES_DOC_CALL_SUMMARY_PREFIX}: ${callOutcome}`,
        body: callNotes.trim(),
        outcome: callOutcome,
        durationMinutes: duration,
        occurredAt: new Date(callAt).toISOString(),
      })
      setCallLogs((prev) => [workflowLogToCallEntry(log), ...prev])
      setShowCallForm(false)
      setCallDuration('')
      setCallNotes('')
      setCallAt(toDatetimeLocal())
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not save call log')
    }
  }

  const saveNote = async () => {
    if (!noteText.trim()) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToastError('Admin session expired. Please sign in again.')
      return
    }
    try {
      const log = await createWorkflowLog(session.accessToken, 'sales-deal', deal.id, {
        channel: 'note',
        direction: 'internal',
        summary: SALES_DOC_NOTE_SUMMARY,
        body: noteText.trim(),
      })
      setInternalNotes((prev) => [workflowLogToNoteEntry(log), ...prev])
      setNoteText('')
      setShowNoteForm(false)
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not save internal note')
    }
  }

  const deleteInternalNote = async (noteId: string) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToastError('Admin session expired. Please sign in again.')
      return
    }
    try {
      await deleteWorkflowLog(session.accessToken, noteId)
      setInternalNotes((prev) => prev.filter((n) => n.id !== noteId))
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not delete internal note')
    }
  }

  const closeDeal = async () => {
    const closed = await onStageChange('closed', { closedAt: new Date().toISOString() })
    if (closed) navigate('/admin/sales/closed')
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={cn(
            'fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2 text-sm shadow-lg',
            toast.variant === 'error'
              ? 'bg-red-600 text-white'
              : 'bg-foreground text-background',
          )}
        >
          {toast.message}
        </div>
      )}

      {registrationDaysUntil != null && registrationDaysUntil <= 2 && registrationDaysUntil >= 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          🚨 Registration in {registrationDaysUntil} days! Ensure ALL documents are ready NOW
        </div>
      )}
      {registrationDaysUntil != null && registrationDaysUntil <= 7 && registrationDaysUntil > 2 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          ⚠️ Registration in {registrationDaysUntil} days — check document checklist below
        </div>
      )}
      {registrationDaysUntil != null && registrationDaysUntil < 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          ❌ Registration date passed! Update registration date
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w) => (
            <p
              key={w.text}
              className={cn(
                'rounded-lg px-3 py-2 text-sm',
                w.tone === 'red' && 'bg-red-50 text-red-800',
                w.tone === 'orange' && 'bg-orange-50 text-orange-800',
                w.tone === 'soft' && 'bg-muted text-muted-foreground',
              )}
            >
              {w.tone === 'orange' && balance > 0 && w.text.includes('Balance')
                ? `⚠️ ${w.text}`
                : w.text}
            </p>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Payment Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Agreed Price</p>
              <p className="font-medium">{formatPrice(agreed)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Token Paid</p>
              <p className="font-medium">
                {token != null ? formatPrice(token) : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Total Received</p>
              <p className="font-medium">{formatPrice(totalPaid)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Payment Type</p>
              <p className="font-medium">{paymentTypeLabel}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Balance</p>
              <p
                className={cn(
                  'font-semibold',
                  fullyPaid ? 'text-green-700' : 'text-foreground',
                )}
              >
                {fullyPaid ? 'Fully paid' : formatPrice(balance)}
              </p>
            </div>
          </div>
          {balance > 0 && (
            <p className="mt-3 text-sm text-orange-700">
              ⚠️ Balance pending: {formatPrice(balance)}
            </p>
          )}
        </CardContent>
      </Card>

      <div
        ref={ownershipCardRef}
        className="mb-6 rounded-xl border border-border bg-card p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="size-5 text-blue-600" />
            <h3 className="font-semibold text-foreground">Property Ownership Type</h3>
            {!ownershipSaved ? (
              <Badge variant="red">Required</Badge>
            ) : (
              <Badge variant="responded">✅ Confirmed</Badge>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Select ownership type — this determines the documentation required for this property
        </p>

        <hr className="my-4 border-border" />

        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => selectOwnershipType('freehold')}
            className={cn(
              'relative cursor-pointer rounded-xl border-2 p-5 text-left transition-colors',
              ownershipType === 'freehold'
                ? 'border-primary bg-blue-50'
                : 'border-border bg-card',
            )}
          >
            <span
              className={cn(
                'absolute right-4 top-4 size-4 rounded-full border-2',
                ownershipType === 'freehold'
                  ? 'border-primary bg-primary'
                  : 'border-muted-foreground bg-transparent',
              )}
            />
            <Home
              className={cn(
                'size-10',
                ownershipType === 'freehold' ? 'text-blue-600' : 'text-muted-foreground',
              )}
            />
            <p className="mt-3 text-base font-semibold text-foreground">
              Freehold / Ownership Land
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Seller owns the land outright. No lease or time limit. Most common type.
            </p>
            <div className="mt-3 flex flex-wrap gap-1">
              {['Permanent Ownership', 'Transferable', 'Bank Loan Easy'].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </button>

          <button
            type="button"
            onClick={() => selectOwnershipType('leasehold')}
            className={cn(
              'relative cursor-pointer rounded-xl border-2 p-5 text-left transition-colors',
              ownershipType === 'leasehold'
                ? 'border-orange-400 bg-orange-50'
                : 'border-border bg-card',
            )}
          >
            <span
              className={cn(
                'absolute right-4 top-4 size-4 rounded-full border-2',
                ownershipType === 'leasehold'
                  ? 'border-orange-500 bg-orange-500'
                  : 'border-muted-foreground bg-transparent',
              )}
            />
            <Key
              className={cn(
                'size-10',
                ownershipType === 'leasehold' ? 'text-orange-600' : 'text-muted-foreground',
              )}
            />
            <p className="mt-3 text-base font-semibold text-foreground">
              Leasehold / Lease Land
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Property is on leased land. Lease period applies. Requires additional documents.
            </p>
            <div className="mt-3 flex flex-wrap gap-1">
              {[
                'Lease Period Applicable',
                'Government / Private Lease',
                'Additional Docs Required',
              ].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </button>
        </div>

        {ownershipType === 'leasehold' && (
          <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-orange-600" />
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-sm font-medium text-orange-900">
                  Additional requirements for Leasehold property:
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-orange-800">
                  <li>Lease deed (original)</li>
                  <li>Lease period remaining</li>
                  <li>Lessor details (Govt/Private)</li>
                  <li>NOC from lessor for sale</li>
                  <li>Sub-lease permission (if applicable)</li>
                </ul>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">Lease Period (years)</label>
                    <input
                      type="number"
                      min={0}
                      value={leasePeriodYears}
                      onChange={(e) => setLeasePeriodYears(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Lease Start Date</label>
                    <input
                      type="date"
                      value={leaseStartDate}
                      onChange={(e) => setLeaseStartDate(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Lessor Name</label>
                    <input
                      type="text"
                      value={lessorName}
                      onChange={(e) => setLessorName(e.target.value)}
                      placeholder="e.g. BDA / KIADB / Private Party"
                      className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Lessor Type</label>
                    <select
                      value={lessorType}
                      onChange={(e) => setLessorType(e.target.value as LessorType)}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    >
                      <option value="Government">Government</option>
                      <option value="Semi-Government">Semi-Government</option>
                      <option value="Private">Private</option>
                      <option value="Religious Trust">Religious Trust</option>
                    </select>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium">NOC from Lessor</p>
                  <div className="mt-1 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={nocFromLessor === true ? 'default' : 'outline'}
                      onClick={() => setNocFromLessor(true)}
                    >
                      Yes
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={nocFromLessor === false ? 'default' : 'outline'}
                      onClick={() => setNocFromLessor(false)}
                    >
                      No
                    </Button>
                  </div>
                </div>

                {leaseYearsRemaining != null && (
                  <div>
                    <p className="text-sm font-medium">Lease Remaining</p>
                    <p
                      className={cn(
                        'mt-1 text-sm font-semibold',
                        leaseYearsRemaining > 30 && 'text-green-700',
                        leaseYearsRemaining >= 10 &&
                          leaseYearsRemaining <= 30 &&
                          'text-orange-700',
                        leaseYearsRemaining < 10 && 'text-red-700',
                      )}
                    >
                      {leaseYearsRemaining} years remaining
                    </p>
                    {leaseYearsRemaining < 10 && (
                      <p className="mt-2 text-sm font-medium text-red-700">
                        ⚠️ Less than 10 years remaining. Banks may not approve loans. Buyer should
                        be informed.
                      </p>
                    )}
                  </div>
                )}

                {isBdaLessor && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                    BDA lease properties require BDA NOC — processing takes 30-90 days
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4">
          {ownershipSaved ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-green-700">
                ✅ Confirmed as{' '}
                {ownershipType === 'freehold'
                  ? 'Freehold / Ownership Land'
                  : 'Leasehold / Lease Land'}
              </span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setOwnershipSaved(false)}
              >
                Change
              </button>
            </div>
          ) : ownershipType == null ? (
            <Button type="button" disabled className="bg-muted text-muted-foreground">
              Select ownership type to continue
            </Button>
          ) : (
            <Button type="button" onClick={confirmOwnershipType}>
              Confirm —{' '}
              {ownershipType === 'freehold' ? 'Freehold' : 'Leasehold'} Property
            </Button>
          )}
        </div>
      </div>

      {ownershipSaved && ownershipType === 'freehold' && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Showing standard freehold documents checklist
        </div>
      )}

      {ownershipSaved && ownershipType === 'leasehold' && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          Showing leasehold documents. Additional lease-related documents are required.
        </div>
      )}

      <LegalDocumentChecklist
        dealId={deal.id}
        relatedToType="deal"
        propertyType={deal.propertyType || 'apartment'}
        partyName={deal.buyerName}
        partyPhone={deal.buyerPhone}
        partyEmail={deal.buyerEmail}
        partyType="buyer"
        partyUserId={deal.buyerUserId}
        propertyTitle={deal.propertyTitle}
        documents={documents}
        setDocuments={setPersistedDocuments}
        customDocs={customDocs}
        setCustomDocs={setPersistedCustomDocs}
        onToast={showToastMsg}
        requiredDocIds={requiredDocIds}
        onRequiredDocIdsChange={(ids) => persistDocumentationPatch({ requiredDocIds: ids })}
        mode="send"
        sectionTitle="Sale Documents"
        sectionBanner={
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            📤 These documents are prepared by Builtglory and sent to the buyer. Upload each
            document and send to buyer.
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Property Registration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {registration && !editingRegistration ? (
            <div className="space-y-2 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Registration date</p>
                  <p className="font-medium">
                    {formatReceiptDate(registration.registrationDate)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Office</p>
                  <p className="font-medium">
                    {registration.registrationOffice || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Sub-registrar</p>
                  <p className="font-medium">
                    {registration.subRegistrarName || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Stamp duty</p>
                  <p className="font-medium">{formatPrice(registration.stampDuty)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Registration fee</p>
                  <p className="font-medium">{formatPrice(registration.registrationFee)}</p>
                </div>
              </div>
              {registration.notes && (
                <p className="rounded-lg bg-muted p-3 text-muted-foreground">
                  {registration.notes}
                </p>
              )}
              <button
                type="button"
                className="text-sm text-primary hover:underline"
                onClick={startEditRegistration}
              >
                Edit
              </button>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Registration date</label>
                  <input
                    type="date"
                    value={regDate}
                    onChange={(e) => setRegDate(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Registration office</label>
                  <input
                    value={regOffice}
                    onChange={(e) => setRegOffice(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Sub-registrar name</label>
                  <input
                    value={subRegistrar}
                    onChange={(e) => setSubRegistrar(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Stamp duty paid (₹)</label>
                  <input
                    type="number"
                    value={stampDuty}
                    onChange={(e) => setStampDuty(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Registration fee (₹)</label>
                  <input
                    type="number"
                    value={regFee}
                    onChange={(e) => setRegFee(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </div>
              </div>
              <textarea
                rows={2}
                value={regNotes}
                onChange={(e) => setRegNotes(e.target.value)}
                placeholder="Notes"
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
              />
              <Button
                type="button"
                disabled={!regDate}
                onClick={saveRegistration}
              >
                Save Registration Details
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Property Handover</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {handoverDoneCount} of {HANDOVER_ITEMS.length} completed
          </p>
          <div className="space-y-2">
            {HANDOVER_ITEMS.map((label, i) => (
              <label key={label} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={handoverChecks[i]}
                  onChange={(e) => {
                    setHandoverChecks((prev) => {
                      const next = [...prev]
                      next[i] = e.target.checked
                      void persistDocumentationPatch({ handoverChecks: next })
                      return next
                    })
                  }}
                  className="size-4"
                />
                {label}
              </label>
            ))}
          </div>
          <div>
            <label className="text-sm font-medium">Scheduled handover date</label>
            <input
              type="date"
              value={handoverDate}
              onChange={(e) => {
                setHandoverDate(e.target.value)
                void persistDocumentationPatch({ handoverDate: e.target.value || null })
              }}
              className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
            />
          </div>
        </CardContent>
      </Card>

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
                onClick={() => void deleteInternalNote(note.id)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-t-4 border-indigo-500">
        <CardContent className="space-y-3 p-6">
          <h3 className="font-semibold text-foreground">Next Action</h3>

          {!handoverComplete && (
            <p className="text-sm text-orange-700">
              ⚠️ Handover checklist incomplete
            </p>
          )}

          {showCloseConfirm ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
              <p className="font-semibold text-green-900">Congratulations! 🎉</p>
              <p className="mt-2 text-green-800">Close this deal?</p>
              <ul className="mt-2 space-y-1 text-green-800">
                <li>Buyer: {deal.buyerName}</li>
                <li>Property: {deal.propertyTitle}</li>
                <li>Total Value: {formatPrice(agreed)}</li>
              </ul>
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => tryProceedToNextStage(closeDeal)}
                >
                  ✅ Close Deal
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCloseConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="group relative">
              <Button
                type="button"
                className="w-full bg-green-600 hover:bg-green-700"
                disabled={!allRequiredVerified}
                onClick={() =>
                  tryProceedToNextStage(() => setShowCloseConfirm(true))
                }
              >
                🎉 Mark Deal as Closed
              </Button>
              {!allRequiredVerified && (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Verify all required documents
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
