import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle,
  Building2,
  CheckCircle,
  FileText,
  Home,
  Key,
  Phone,
  Scale,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  formatPrice,
  updateAdminAcquisitionSection,
  type Acquisition,
  type AcquisitionStage,
} from '@/api/adminAcquisitions'
import { readAdminSession } from '@/api/admin'
import {
  createWorkflowLog,
  deleteWorkflowLog,
  listWorkflowLogs,
  uploadWorkflowProof,
  type WorkflowLog,
} from '@/api/adminWorkflow'
import {
  createInitialDocuments,
  LegalDocumentChecklist,
  useLegalDocumentStats,
  type LegalDocumentItem,
} from '@/pages/admin/stages/LegalDocumentChecklist'

export interface DocumentationStageProps {
  acquisition: Acquisition
  onStageChange: (newStage: AcquisitionStage, patch?: Partial<Acquisition>) => void
}

interface LegalNote {
  id: string
  text: string
  at: string
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
type LessorType = 'Government' | 'Semi-Government' | 'Private' | 'Religious Trust'

interface LeaseholdDetails {
  leasePeriodYears: string
  leaseStartDate: string
  lessorName: string
  lessorType: LessorType
  nocFromLessor: boolean | null
}

const LEASEHOLD_REQUIRED_DOCS = [
  { id: 'leasehold_lease_deed', name: 'Lease Deed (Original)' },
  { id: 'leasehold_noc_lessor', name: 'NOC from Lessor for Sale' },
  { id: 'leasehold_lease_period_cert', name: 'Lease Period Certificate' },
  { id: 'leasehold_sub_lease', name: 'Sub-lease Permission (if applicable)' },
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

interface LegalAdvocate {
  name: string
  phone: string
  email: string
  barCouncilNumber: string
  firm: string
  verificationFee?: string
}

type VerificationStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'issues_found'

interface AdvocateVerification {
  advocateAssigned: boolean
  advocate: LegalAdvocate | null
  verificationStatus: VerificationStatus
  verificationDate: string | null
  certificateUploaded: boolean
  certificateUrl: string | null
  certificateLogId: string | null
  certificateFileName: string | null
  advocateNotes: string
  issuesFound: string[]
  verifiedBy: string | null
  categoryChecklist: Record<string, boolean>
}

const BAR_COUNCIL_PATTERN = /^[A-Z]{2,4}\/\d+\/\d{4}$/i

const REVIEW_CATEGORIES = [
  { id: 'registration', label: 'Registration Records verified' },
  { id: 'revenue', label: 'Revenue Records verified' },
  { id: 'approvals', label: 'Approvals & Planning verified' },
  { id: 'tax_utility', label: 'Tax & Utility Records verified' },
  { id: 'loan_encumbrance', label: 'Loan & Encumbrance verified' },
  { id: 'court_records', label: 'Court Records verified' },
  { id: 'govt_acquisition', label: 'Government Acquisition Records verified' },
  { id: 'ownership', label: 'Ownership type documents verified' },
] as const

const DEFAULT_VERIFICATION: AdvocateVerification = {
  advocateAssigned: false,
  advocate: null,
  verificationStatus: 'not_started',
  verificationDate: null,
  certificateUploaded: false,
  certificateUrl: null,
  certificateLogId: null,
  certificateFileName: null,
  advocateNotes: '',
  issuesFound: [],
  verifiedBy: null,
  categoryChecklist: {},
}

function currentAdminName() {
  const session = readAdminSession()
  return session?.admin?.name || session?.admin?.email || 'Current Admin'
}

const LEGAL_NOTE_SUMMARY = 'Legal documentation note'
const INTERNAL_NOTE_SUMMARY = 'Internal documentation note'
const CALL_SUMMARY_PREFIX = 'Documentation call'
const LEGAL_CERTIFICATE_SUMMARY = 'Legal verification certificate'

function workflowLogToLegalNote(log: WorkflowLog): LegalNote {
  return {
    id: log.id,
    text: log.body || log.summary,
    at: log.occurredAt,
  }
}

function workflowLogToCallEntry(log: WorkflowLog): CallLogEntry {
  return {
    id: log.id,
    calledAt: log.occurredAt,
    duration: log.durationMinutes ?? 0,
    outcome: log.outcome || CALL_OUTCOMES[0],
    notes: log.body || '',
  }
}

function workflowLogToInternalNote(log: WorkflowLog): NoteEntry {
  return {
    id: log.id,
    text: log.body || log.summary,
    at: log.occurredAt,
  }
}

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

function formatVerificationDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

function parseSavedVerification(raw: string): AdvocateVerification {
  try {
    const parsed = JSON.parse(raw) as Partial<AdvocateVerification>
    return {
      ...DEFAULT_VERIFICATION,
      ...parsed,
      categoryChecklist: parsed.categoryChecklist ?? {},
      issuesFound: Array.isArray(parsed.issuesFound) ? parsed.issuesFound : [],
    }
  } catch {
    return DEFAULT_VERIFICATION
  }
}

function parseVerificationValue(value: unknown): AdvocateVerification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_VERIFICATION
  return parseSavedVerification(JSON.stringify(value))
}

function parseRequiredDocIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function parseDocumentItems(value: unknown): LegalDocumentItem[] | null {
  return Array.isArray(value) ? value as LegalDocumentItem[] : null
}

function isLessorType(value: unknown): value is LessorType {
  return value === 'Government' || value === 'Semi-Government' || value === 'Private' || value === 'Religious Trust'
}

function parseLeaseholdDetails(value: unknown): LeaseholdDetails {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    leasePeriodYears: record.leasePeriodYears == null ? '' : String(record.leasePeriodYears),
    leaseStartDate: record.leaseStartDate == null ? '' : String(record.leaseStartDate).slice(0, 10),
    lessorName: record.lessorName == null ? '' : String(record.lessorName),
    lessorType: isLessorType(record.lessorType) ? record.lessorType : 'Government',
    nocFromLessor: typeof record.nocFromLessor === 'boolean' ? record.nocFromLessor : null,
  }
}

export function DocumentationStage({ acquisition, onStageChange }: DocumentationStageProps) {
  const navigate = useNavigate()
  const agreed = acquisition.agreedPrice
  const token = acquisition.token?.payment as { amount?: number; method?: string } | undefined
  const requiredDocIds = parseRequiredDocIds(acquisition.documentation?.requiredDocIds)

  const [documents, setDocuments] = useState<LegalDocumentItem[]>(() =>
    parseDocumentItems(acquisition.documentation?.documents) ?? createInitialDocuments(requiredDocIds),
  )
  const [customDocs, setCustomDocs] = useState<LegalDocumentItem[]>(
    () => parseDocumentItems(acquisition.documentation?.customDocs) ?? [],
  )

  const ownershipCardRef = useRef<HTMLDivElement>(null)
  const [ownershipType, setOwnershipType] = useState<OwnershipType | null>(null)
  const [ownershipSaved, setOwnershipSaved] = useState(false)
  const [leasePeriodYears, setLeasePeriodYears] = useState('')
  const [leaseStartDate, setLeaseStartDate] = useState('')
  const [lessorName, setLessorName] = useState('')
  const [lessorType, setLessorType] = useState<LessorType>('Government')
  const [nocFromLessor, setNocFromLessor] = useState<boolean | null>(null)

  const [legalNotes, setLegalNotes] = useState<LegalNote[]>([])
  const [showLegalForm, setShowLegalForm] = useState(false)
  const [legalText, setLegalText] = useState('')

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
  const [showPayoutConfirm, setShowPayoutConfirm] = useState(false)
  const certificateInputRef = useRef<HTMLInputElement>(null)

  const [verification, setVerification] = useState<AdvocateVerification>(DEFAULT_VERIFICATION)
  const [advocateForm, setAdvocateForm] = useState({
    name: '',
    phone: '',
    email: '',
    barCouncilNumber: '',
    firm: '',
    verificationFee: '',
  })
  const [barCouncilError, setBarCouncilError] = useState('')
  const [issuesToggle, setIssuesToggle] = useState(false)
  const [issueDraft, setIssueDraft] = useState('')
  const [showProceedDespiteIssues, setShowProceedDespiteIssues] = useState(false)
  const [showCertificatePreview, setShowCertificatePreview] = useState(false)
  const [certificateUploading, setCertificateUploading] = useState(false)

  const { allRequiredVerified, anyUploadedNotVerified, optionalMissing } =
    useLegalDocumentStats(documents, customDocs)

  useEffect(() => {
    const saved = acquisition.documentation?.ownershipType
    if (saved === 'freehold' || saved === 'leasehold') {
      setOwnershipType(saved)
      setOwnershipSaved(true)
    } else {
      setOwnershipType(null)
      setOwnershipSaved(false)
    }
  }, [acquisition.documentation?.ownershipType])

  useEffect(() => {
    const details = parseLeaseholdDetails(acquisition.documentation?.leaseholdDetails)
    setLeasePeriodYears(details.leasePeriodYears)
    setLeaseStartDate(details.leaseStartDate)
    setLessorName(details.lessorName)
    setLessorType(details.lessorType)
    setNocFromLessor(details.nocFromLessor)
  }, [acquisition.documentation?.leaseholdDetails])

  useEffect(() => {
    const parsed = parseVerificationValue(acquisition.documentation?.legalVerification)
    setVerification(parsed)
    setIssuesToggle(parsed.issuesFound.length > 0)
    if (parsed.advocate) {
      setAdvocateForm({
        name: parsed.advocate.name,
        phone: parsed.advocate.phone,
        email: parsed.advocate.email,
        barCouncilNumber: parsed.advocate.barCouncilNumber,
        firm: parsed.advocate.firm,
        verificationFee: parsed.advocate.verificationFee ?? '',
      })
    }
  }, [acquisition.documentation?.legalVerification])

  useEffect(() => {
    const session = readAdminSession()
    if (!session?.accessToken || !acquisition.id) {
      setLegalNotes([])
      setCallLogs([])
      setInternalNotes([])
      return
    }

    let cancelled = false
    void Promise.all([
      listWorkflowLogs(session.accessToken, 'acquisition', acquisition.id, 'note').catch(() => ({ data: [] as WorkflowLog[] })),
      listWorkflowLogs(session.accessToken, 'acquisition', acquisition.id, 'call').catch(() => ({ data: [] as WorkflowLog[] })),
    ]).then(([noteResult, callResult]) => {
      if (cancelled) return
      const notes = noteResult.data
      setLegalNotes(
        notes
          .filter((log) => log.summary === LEGAL_NOTE_SUMMARY)
          .map(workflowLogToLegalNote),
      )
      setInternalNotes(
        notes
          .filter((log) => log.summary === INTERNAL_NOTE_SUMMARY)
          .map(workflowLogToInternalNote),
      )
      setCallLogs(
        callResult.data
          .filter((log) => log.summary.startsWith(CALL_SUMMARY_PREFIX))
          .map(workflowLogToCallEntry),
      )
    })

    return () => {
      cancelled = true
    }
  }, [acquisition.id])

  const persistDocumentationPatch = async (patch: Record<string, unknown>) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToastError('Admin session expired. Please sign in again.')
      return
    }
    try {
      const saved = await updateAdminAcquisitionSection(session.accessToken, acquisition.id, 'documentation', {
        ...acquisition.documentation,
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

  const saveVerification = (updates: Partial<AdvocateVerification>) => {
    setVerification((prev) => {
      const updated = { ...prev, ...updates }
      void persistDocumentationPatch({ legalVerification: updated })
      return updated
    })
  }

  const checklistReviewedCount = useMemo(
    () => REVIEW_CATEGORIES.filter((c) => verification.categoryChecklist[c.id]).length,
    [verification.categoryChecklist],
  )

  const allChecklistChecked = checklistReviewedCount === REVIEW_CATEGORIES.length

  const checklistStarted = checklistReviewedCount > 0

  const verificationAgeMonths = useMemo(() => {
    if (!verification.verificationDate) return null
    const diff = Date.now() - new Date(verification.verificationDate).getTime()
    return Math.floor(diff / (30 * 24 * 60 * 60 * 1000))
  }, [verification.verificationDate])

  const showCompleteButton =
    verification.advocateAssigned &&
    allChecklistChecked &&
    verification.certificateUploaded

  const scrollToVerificationCard = () => {
    document.getElementById('legal-verification-card')?.scrollIntoView({ behavior: 'smooth' })
  }

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

  const selectOwnershipType = (type: OwnershipType) => {
    if (ownershipSaved && ownershipType && ownershipType !== type) {
      if (
        hasVerifiedDocs &&
        !window.confirm('Changing type may require additional documents')
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
      leaseholdDetails:
        ownershipType === 'leasehold'
          ? {
              leasePeriodYears: leasePeriodYears.trim(),
              leaseStartDate: leaseStartDate || null,
              lessorName: lessorName.trim(),
              lessorType,
              nocFromLessor,
              leaseYearsRemaining,
            }
          : null,
    })
    setOwnershipSaved(true)
    showToastMsg('Ownership type confirmed')
  }

  const scrollToOwnershipCard = () => {
    ownershipCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tryProceedToPayout = (action: () => void) => {
    if (!ownershipSaved || ownershipType == null) {
      showToastError('Select ownership type first')
      scrollToOwnershipCard()
      return
    }
    if (verification.verificationStatus !== 'completed') {
      showToastError('Legal advocate verification required before Seller Payout')
      scrollToVerificationCard()
      return
    }
    action()
  }

  const assignAdvocate = () => {
    if (!advocateForm.name.trim() || !advocateForm.phone.trim() || !advocateForm.barCouncilNumber.trim()) {
      showToastError('Name, phone, and Bar Council number are required')
      return
    }
    if (!BAR_COUNCIL_PATTERN.test(advocateForm.barCouncilNumber.trim())) {
      setBarCouncilError('Format: STATE/NUMBERS/YEAR (e.g. KAR/1234/2010)')
      showToastError('Invalid Bar Council number format')
      return
    }
    setBarCouncilError('')
    const wasCompleted = verification.verificationStatus === 'completed'
    const advocate: LegalAdvocate = {
      name: advocateForm.name.trim(),
      phone: advocateForm.phone.trim(),
      email: advocateForm.email.trim(),
      barCouncilNumber: advocateForm.barCouncilNumber.trim().toUpperCase(),
      firm: advocateForm.firm.trim(),
      verificationFee: advocateForm.verificationFee.trim() || undefined,
    }
    saveVerification({
      advocateAssigned: true,
      advocate,
      verificationStatus: 'in_progress',
      verifiedBy: null,
      verificationDate: null,
      certificateUploaded: false,
      certificateUrl: null,
      certificateLogId: null,
      certificateFileName: null,
      categoryChecklist: {},
      issuesFound: [],
    })
    setIssuesToggle(false)
    if (wasCompleted) {
      showToastMsg('Advocate changed. Re-verification required.')
    } else {
      showToastMsg('Legal advocate assigned')
    }
  }

  const changeAdvocate = () => {
    const wasCompleted = verification.verificationStatus === 'completed'
    saveVerification({
      advocateAssigned: false,
      advocate: null,
      verificationStatus: 'not_started',
      verifiedBy: null,
      verificationDate: null,
      certificateUploaded: false,
      certificateUrl: null,
      certificateLogId: null,
      certificateFileName: null,
      categoryChecklist: {},
      issuesFound: [],
    })
    setIssuesToggle(false)
    setIssueDraft('')
    if (wasCompleted) {
      showToastMsg('Advocate changed. Re-verification required.')
    }
  }

  const toggleCategoryReview = (categoryId: string, checked: boolean) => {
    setVerification((prev) => {
      const nextChecklist = { ...prev.categoryChecklist, [categoryId]: checked }
      const updated: AdvocateVerification = {
        ...prev,
        categoryChecklist: nextChecklist,
        verificationStatus:
          prev.verificationStatus === 'not_started' && checked
            ? 'in_progress'
            : prev.verificationStatus,
      }
      void persistDocumentationPatch({ legalVerification: updated })
      return updated
    })
  }

  const addIssue = () => {
    const text = issueDraft.trim()
    if (!text) return
    setVerification((prev) => {
      const updated: AdvocateVerification = {
        ...prev,
        issuesFound: [...prev.issuesFound, text],
        verificationStatus: 'issues_found',
      }
      void persistDocumentationPatch({ legalVerification: updated })
      return updated
    })
    setIssueDraft('')
    setIssuesToggle(true)
  }

  const removeIssue = (index: number) => {
    setVerification((prev) => {
      const nextIssues = prev.issuesFound.filter((_, i) => i !== index)
      const updated: AdvocateVerification = {
        ...prev,
        issuesFound: nextIssues,
        verificationStatus: nextIssues.length > 0 ? 'issues_found' : 'in_progress',
      }
      void persistDocumentationPatch({ legalVerification: updated })
      return updated
    })
    if (verification.issuesFound.length <= 1) setIssuesToggle(false)
  }

  const uploadCertificate = async (file: File) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToastError('Admin session expired. Please sign in again.')
      return
    }
    setCertificateUploading(true)
    try {
      const log = await uploadWorkflowProof(session.accessToken, 'acquisition', acquisition.id, file, {
        summary: LEGAL_CERTIFICATE_SUMMARY,
        notes: verification.advocate
          ? `Certificate from Adv. ${verification.advocate.name}`
          : 'Legal verification certificate',
      })
      const certificateUrl = log.attachments[0]?.url
      if (!certificateUrl) throw new Error('Certificate upload did not return a file URL.')
      saveVerification({
        certificateUploaded: true,
        certificateUrl,
        certificateLogId: log.id,
        certificateFileName: log.attachments[0]?.fileName || file.name,
        verificationDate: new Date().toISOString(),
      })
      showToastMsg('Certificate uploaded')
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not upload certificate')
    } finally {
      setCertificateUploading(false)
      if (certificateInputRef.current) certificateInputRef.current.value = ''
    }
  }

  const replaceCertificate = () => {
    saveVerification({
      certificateUploaded: false,
      certificateUrl: null,
      certificateLogId: null,
      certificateFileName: null,
    })
  }

  const markVerificationComplete = (despiteIssues = false) => {
    if (!allChecklistChecked) {
      showToastError('Complete document review checklist first')
      return
    }
    if (!verification.certificateUploaded) {
      showToastError('Upload verification certificate first')
      return
    }
    if (verification.issuesFound.length > 0 && !despiteIssues) {
      setShowProceedDespiteIssues(true)
      return
    }
    saveVerification({
      verificationStatus: 'completed',
      verifiedBy: currentAdminName(),
      verificationDate: new Date().toISOString(),
    })
    setShowProceedDespiteIssues(false)
    showToastMsg('Legal verification complete! Property cleared for Seller Payout.')
  }

  const revokeVerification = () => {
    if (
      !window.confirm(
        'Revoke verification? Seller Payout will be blocked again.',
      )
    ) {
      return
    }
    saveVerification({
      verificationStatus: 'in_progress',
      verifiedBy: null,
    })
    showToastMsg('Verification revoked')
  }

  const verificationStatusBadge = () => {
    switch (verification.verificationStatus) {
      case 'in_progress':
        return (
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
            In Progress
          </Badge>
        )
      case 'completed':
        return <Badge variant="responded">✅ Verified</Badge>
      case 'issues_found':
        return <Badge variant="red">⚠️ Issues Found</Badge>
      default:
        return <Badge variant="red">Required</Badge>
    }
  }

  const saveLegalNote = async () => {
    if (!legalText.trim()) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToastError('Admin session expired. Please sign in again.')
      return
    }
    try {
      const log = await createWorkflowLog(session.accessToken, 'acquisition', acquisition.id, {
        channel: 'note',
        direction: 'internal',
        summary: LEGAL_NOTE_SUMMARY,
        body: legalText.trim(),
      })
      setLegalNotes((prev) => [workflowLogToLegalNote(log), ...prev])
      setLegalText('')
      setShowLegalForm(false)
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not save legal note')
    }
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
      const log = await createWorkflowLog(session.accessToken, 'acquisition', acquisition.id, {
        channel: 'call',
        direction: 'outbound',
        summary: `${CALL_SUMMARY_PREFIX}: ${callOutcome}`,
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
      const log = await createWorkflowLog(session.accessToken, 'acquisition', acquisition.id, {
        channel: 'note',
        direction: 'internal',
        summary: INTERNAL_NOTE_SUMMARY,
        body: noteText.trim(),
      })
      setInternalNotes((prev) => [workflowLogToInternalNote(log), ...prev])
      setNoteText('')
      setShowNoteForm(false)
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not save internal note')
    }
  }

  const deleteLegalNote = async (noteId: string) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToastError('Admin session expired. Please sign in again.')
      return
    }
    try {
      await deleteWorkflowLog(session.accessToken, noteId)
      setLegalNotes((prev) => prev.filter((n) => n.id !== noteId))
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not delete legal note')
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

  const tokenAmount = typeof token?.amount === 'number' ? token.amount : null
  const balanceDue = agreed != null && tokenAmount != null ? agreed - tokenAmount : agreed

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

      {anyUploadedNotVerified && !allRequiredVerified && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          Verify documents before proceeding
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Token Payment Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Agreed Price</p>
              <p className="font-medium">{agreed != null ? formatPrice(agreed) : '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Token Paid</p>
              <p className="font-medium">
                {tokenAmount != null ? formatPrice(tokenAmount) : 'Not recorded'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Balance Due</p>
              <p className="font-medium">
                {balanceDue != null && typeof balanceDue === 'number'
                  ? formatPrice(Math.max(0, balanceDue))
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Payment Method</p>
              <p className="font-medium">{token?.method ?? '—'}</p>
            </div>
          </div>
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
              Seller owns land outright. No lease or time limit. Most common type.
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
                        ⚠️ Less than 10 years remaining. Banks may not approve buyer loans.
                      </p>
                    )}
                  </div>
                )}

                {isBdaLessor && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                    Govt lease — NOC takes 30-90 days to process
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
          Standard freehold documents checklist
        </div>
      )}

      {ownershipSaved && ownershipType === 'leasehold' && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          Leasehold property — additional documents required
        </div>
      )}

      <LegalDocumentChecklist
        dealId={acquisition.id}
        relatedToType="acquisition"
        propertyType={acquisition.propertyType || 'apartment'}
        partyName={acquisition.sellerName}
        partyPhone={acquisition.sellerPhone}
        partyEmail={acquisition.sellerEmail}
        partyType="seller"
        partyUserId={acquisition.sellerUserId}
        propertyTitle={acquisition.propertyTitle}
        documents={documents}
        setDocuments={setPersistedDocuments}
        customDocs={customDocs}
        setCustomDocs={setPersistedCustomDocs}
        onToast={showToastMsg}
        requiredDocIds={requiredDocIds}
        onRequiredDocIdsChange={(ids) => persistDocumentationPatch({ requiredDocIds: ids })}
        moveNextLabel="Move to Seller Payout →"
        onMoveNext={() => tryProceedToPayout(() => setShowPayoutConfirm(true))}
      />

      <div
        id="legal-verification-card"
        className="mb-6 rounded-xl border border-border bg-card p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="size-5 text-purple-600" />
            <h3 className="font-semibold text-foreground">Legal Advocate Verification</h3>
          </div>
          {verificationStatusBadge()}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          An independent legal advocate must verify all documents before Seller Payout is released
        </p>

        <hr className="my-4 border-border" />

        {verification.verificationStatus === 'completed' && verification.advocate ? (
          <div className="relative rounded-xl border border-green-200 bg-green-50 p-4">
            <div className="flex flex-col items-center text-center">
              <CheckCircle className="size-8 text-green-600" />
              <p className="mt-2 font-semibold text-green-800">✅ Legal Verification Complete</p>
            </div>
            <div className="mt-4 space-y-1 text-sm text-green-900">
              <p>
                <span className="text-muted-foreground">Verified by:</span> Adv.{' '}
                {verification.advocate.name}
              </p>
              <p>
                <span className="text-muted-foreground">Bar Council:</span>{' '}
                {verification.advocate.barCouncilNumber}
              </p>
              {verification.verificationDate && (
                <p>
                  <span className="text-muted-foreground">Verification Date:</span>{' '}
                  {formatVerificationDate(verification.verificationDate)}
                </p>
              )}
              {verification.certificateUrl && (
                <p>
                  <span className="text-muted-foreground">Certificate:</span>{' '}
                  <button
                    type="button"
                    className="text-primary underline"
                    onClick={() => setShowCertificatePreview(true)}
                  >
                    View Certificate
                  </button>
                </p>
              )}
              {verification.advocateNotes && (
                <p>
                  <span className="text-muted-foreground">Notes:</span> {verification.advocateNotes}
                </p>
              )}
            </div>
            {verificationAgeMonths != null && verificationAgeMonths > 3 && (
              <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                Verification is {verificationAgeMonths} months old. Consider fresh verification.
              </div>
            )}
            <button
              type="button"
              className="absolute bottom-3 right-3 text-xs text-red-600 hover:underline"
              onClick={revokeVerification}
            >
              Revoke Verification
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">Step 1: Assign Legal Advocate</p>

            {!verification.advocateAssigned ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm">Advocate Name *</label>
                  <input
                    type="text"
                    value={advocateForm.name}
                    onChange={(e) => setAdvocateForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Adv. Ramesh Kumar"
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm">Bar Council Number *</label>
                  <input
                    type="text"
                    value={advocateForm.barCouncilNumber}
                    onChange={(e) => {
                      setAdvocateForm((f) => ({ ...f, barCouncilNumber: e.target.value }))
                      setBarCouncilError('')
                    }}
                    placeholder="e.g. KAR/1234/2010"
                    className={cn(
                      'mt-1 h-9 w-full rounded-md border bg-input px-3 text-sm',
                      barCouncilError ? 'border-red-500' : 'border-border',
                    )}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Format: STATE/NUMBERS/YEAR (e.g. KAR/1234/2010)
                  </p>
                  {barCouncilError && (
                    <p className="mt-1 text-xs text-red-600">{barCouncilError}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm">Phone *</label>
                  <input
                    type="tel"
                    value={advocateForm.phone}
                    onChange={(e) => setAdvocateForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+91 98765 43210"
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm">Email</label>
                  <input
                    type="email"
                    value={advocateForm.email}
                    onChange={(e) => setAdvocateForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="advocate@email.com"
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm">Law Firm / Chamber</label>
                  <input
                    type="text"
                    value={advocateForm.firm}
                    onChange={(e) => setAdvocateForm((f) => ({ ...f, firm: e.target.value }))}
                    placeholder="e.g. Kumar & Associates"
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm">Verification Fee (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={advocateForm.verificationFee}
                    onChange={(e) =>
                      setAdvocateForm((f) => ({ ...f, verificationFee: e.target.value }))
                    }
                    placeholder="e.g. 15000"
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="button" onClick={assignAdvocate}>
                    Assign Advocate
                  </Button>
                </div>
              </div>
            ) : verification.advocate ? (
              <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 p-4">
                <div className="flex items-start gap-2">
                  <Scale className="mt-0.5 size-5 shrink-0 text-purple-600" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">
                      Adv. {verification.advocate.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Bar Council: {verification.advocate.barCouncilNumber}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      📞 {verification.advocate.phone}
                      {verification.advocate.email ? ` | 📧 ${verification.advocate.email}` : ''}
                    </p>
                    {verification.advocate.firm && (
                      <p className="text-sm text-muted-foreground">
                        🏛️ {verification.advocate.firm}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-2 text-xs text-muted-foreground hover:text-foreground hover:underline"
                  onClick={changeAdvocate}
                >
                  Change Advocate
                </button>
              </div>
            ) : null}

            {verification.advocateAssigned && (
              <>
                <p className="mt-4 text-sm font-medium">Step 2: Document Review Checklist</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Advocate reviews each document category and marks as verified
                </p>
                <div className="mt-3 space-y-2">
                  {REVIEW_CATEGORIES.map((cat) => (
                    <label key={cat.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!verification.categoryChecklist[cat.id]}
                        onChange={(e) => toggleCategoryReview(cat.id, e.target.checked)}
                      />
                      {cat.label}
                    </label>
                  ))}
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {checklistReviewedCount}/{REVIEW_CATEGORIES.length} categories reviewed
                    </span>
                    <span>
                      {Math.round(
                        (checklistReviewedCount / REVIEW_CATEGORIES.length) * 100,
                      )}
                      %
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-purple-500 transition-all"
                      style={{
                        width: `${(checklistReviewedCount / REVIEW_CATEGORIES.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                {checklistStarted && (
                  <>
                    <p className="mt-4 text-sm font-medium">Step 3: Advocate Findings</p>

                    <div className="mt-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={issuesToggle}
                          onChange={(e) => {
                            setIssuesToggle(e.target.checked)
                            if (!e.target.checked && verification.issuesFound.length === 0) {
                              saveVerification({ verificationStatus: 'in_progress' })
                            }
                          }}
                        />
                        Issues found during review
                      </label>
                      {issuesToggle && (
                        <div className="mt-2 space-y-2">
                          <textarea
                            rows={2}
                            value={issueDraft}
                            onChange={(e) => setIssueDraft(e.target.value)}
                            placeholder="Describe issues..."
                            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                          />
                          <Button type="button" size="sm" variant="outline" onClick={addIssue}>
                            + Add Issue
                          </Button>
                          {verification.issuesFound.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {verification.issuesFound.map((issue, idx) => (
                                <span
                                  key={`${issue}-${idx}`}
                                  className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800"
                                >
                                  {issue}
                                  <button
                                    type="button"
                                    onClick={() => removeIssue(idx)}
                                    aria-label="Remove issue"
                                  >
                                    <X className="size-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {verification.issuesFound.length > 0 && (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                          ⚠️ Legal issues found. Resolve before proceeding.
                        </div>
                      )}
                    </div>

                    <div className="mt-3">
                      <label className="text-sm">Advocate Notes</label>
                      <textarea
                        rows={3}
                        value={verification.advocateNotes}
                        onChange={(e) => saveVerification({ advocateNotes: e.target.value })}
                        placeholder="General observations, recommendations, conditions..."
                        className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                      />
                    </div>
                  </>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">Step 4: Upload Verification Certificate</p>
                  <Badge variant="red">Mandatory</Badge>
                </div>
                <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                  The legal advocate must provide a signed verification certificate confirming all
                  documents are legally clear for transaction.
                </div>

                {!verification.certificateUploaded ? (
                  <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-orange-600" />
                      <div>
                        <p className="text-sm font-medium text-orange-900">
                          Certificate not uploaded
                        </p>
                        <p className="text-xs text-orange-800">
                          This document is mandatory before releasing Seller Payout
                        </p>
                      </div>
                    </div>
                    <input
                      ref={certificateInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void uploadCertificate(file)
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="mt-3"
                      disabled={certificateUploading}
                      onClick={() => certificateInputRef.current?.click()}
                    >
                      {certificateUploading ? 'Uploading certificate...' : '📎 Upload Certificate'}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="size-6 text-green-600" />
                        <div>
                          <p className="text-sm font-medium text-green-800">
                            Certificate Uploaded ✅
                          </p>
                          {verification.verificationDate && (
                            <p className="text-xs text-green-700">
                              Uploaded: {formatTimeAgo(verification.verificationDate)}
                            </p>
                          )}
                          {verification.certificateFileName && (
                            <p className="text-xs text-green-700">
                              File: {verification.certificateFileName}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setShowCertificatePreview(true)}
                        >
                          View Certificate
                        </Button>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:underline"
                          onClick={replaceCertificate}
                        >
                          Replace
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {verification.certificateUploaded &&
                  verification.issuesFound.length > 0 &&
                  verification.verificationStatus === 'issues_found' && (
                    <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                      Issues found — resolve before marking complete
                    </div>
                  )}

                {showCompleteButton && (
                  <div className="mt-4">
                    <Button
                      type="button"
                      className="w-full bg-green-600 hover:bg-green-700"
                      onClick={() => markVerificationComplete()}
                    >
                      ✅ Mark Verification Complete
                    </Button>
                  </div>
                )}

                {verification.certificateUploaded && !allChecklistChecked && (
                  <p className="mt-2 text-xs text-orange-700">
                    Complete document review checklist first
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>

      {showProceedDespiteIssues && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
            <h3 className="font-semibold">Legal issues were found</h3>
            <p className="mt-2 text-sm text-muted-foreground">Proceed despite issues?</p>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                className="bg-orange-600 hover:bg-orange-700"
                onClick={() => markVerificationComplete(true)}
              >
                Yes, proceed
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowProceedDespiteIssues(false)}
              >
                Resolve first
              </Button>
            </div>
          </div>
        </div>
      )}

      {showCertificatePreview && verification.certificateUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            className="mx-auto w-full max-w-lg rounded-xl bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Verification Certificate</h3>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                onClick={() => setShowCertificatePreview(false)}
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            <img
              src={verification.certificateUrl}
              alt="Verification certificate"
              className="max-h-[400px] w-full rounded-lg object-contain bg-muted"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(verification.certificateUrl!, '_blank')}
              >
                Open in new tab
              </Button>
              <Button type="button" onClick={() => setShowCertificatePreview(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Legal Notes</CardTitle>
          {!showLegalForm && (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowLegalForm(true)}>
              + Add Note
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {showLegalForm && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <textarea
                rows={3}
                value={legalText}
                onChange={(e) => setLegalText(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={saveLegalNote}>
                  Save
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowLegalForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {legalNotes.length === 0 && !showLegalForm && (
            <div className="py-6 text-center">
              <Scale className="mx-auto size-10 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">No legal notes</p>
            </div>
          )}
          {legalNotes.map((note) => (
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
                onClick={() => void deleteLegalNote(note.id)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
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

      <Card className="border-t-4 border-primary">
        <CardContent className="space-y-3 p-6">
          <h3 className="font-semibold text-foreground">Next Step</h3>

          {optionalMissing && allRequiredVerified && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              ⚠️ Some optional documents missing. Proceed anyway?
            </div>
          )}

          {showPayoutConfirm ? (
            <div className="rounded-lg border border-border bg-muted p-4 text-sm">
              <p>All required documents verified. Move to seller payout?</p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onStageChange('seller_payout', {
                      documentation: {
                        ...acquisition.documentation,
                        ownershipType,
                        ownership_verified: true,
                        encumbrance_clear: true,
                        tax_clear: true,
                        litigation_clear: true,
                        approvals_verified: true,
                        advocateVerification: verification,
                      },
                    })
                    navigate('/admin/acquisition/payout')
                  }}
                >
                  Confirm
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowPayoutConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button
                type="button"
                className="w-full"
                disabled={!allRequiredVerified}
                title={!allRequiredVerified ? 'Verify all required documents first' : undefined}
                onClick={() => tryProceedToPayout(() => setShowPayoutConfirm(true))}
              >
                💰 Move to Seller Payout
              </Button>
              {verification.verificationStatus !== 'completed' && (
                <p className="mt-2 text-center text-xs text-red-500">
                  ⚠️ Complete legal verification first
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
