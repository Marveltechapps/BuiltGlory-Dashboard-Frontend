import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, FileText, Send, X } from 'lucide-react'
import NotificationPreview from '@/components/NotificationPreview'
import { getDashboardOptions, type DashboardDocumentCategory, type DashboardOptions } from '@/api/adminAppConfig'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { DEFAULT_SENT_BY, formatMessageTimeAgo, logMessage } from '@/utils/messageLog'
import {
  NOTIFICATION_TEMPLATES,
  sendPushNotification,
  type NotificationAudience,
  type SendPushOptions,
} from '@/utils/notifications'

export type FileStatus = 'uploaded' | 'verified' | 'rejected' | 'awaiting_upload'

export interface DocumentFile {
  id: string
  fileName: string
  uploadedAt: string
  status: FileStatus
  notes: string | null
  url: string | null
  description: string
}

export type LegalDocStatus =
  | 'missing'
  | 'uploaded'
  | 'verified'
  | 'rejected'
  | 'sent_to_buyer'

export interface LegalDocumentItem {
  id: string
  name: string
  required: boolean
  isCustom?: boolean
  files: DocumentFile[]
  lastRequestedAt?: string | null
  sentToBuyerAt?: string | null
}

export type DocumentChecklistMode = 'request' | 'send'

type SendChannel = 'whatsapp' | 'email' | 'push'

export const DOCUMENT_CATEGORIES = [
  {
    id: 'registration',
    title: '1. Registration Records',
    documents: [
      { id: 'parent_doc', name: 'Parent Document' },
      { id: 'chain_of_title', name: 'Chain of Title Documents' },
      { id: 'sale_deed', name: 'Sale Deed' },
      { id: 'partition_deed', name: 'Partition Deed' },
      { id: 'settlement_deed', name: 'Settlement Deed' },
      { id: 'gift_deed', name: 'Gift Deed' },
      { id: 'will_probate', name: 'Will & Probate' },
      { id: 'mortgage_deed', name: 'Mortgage Deed' },
      { id: 'release_deed', name: 'Release Deed' },
      { id: 'poa', name: 'Power of Attorney (PoA)' },
      { id: 'court_decree', name: 'Court Decree / Court Sale Order' },
      { id: 'auction_cert', name: 'Auction Sale Certificate' },
      { id: 'ec', name: 'Encumbrance Certificate (EC)' },
    ],
  },
  {
    id: 'revenue',
    title: '2. Revenue Records',
    documents: [
      { id: 'chitta', name: 'Chitta' },
      { id: 'patta', name: 'Patta' },
      { id: 'a_register', name: 'A-Register Extract' },
      { id: 'fmb_sketch', name: 'FMB Sketch' },
      { id: 'tslr', name: 'Town Survey Land Register (TSLR)' },
      { id: 'patta_transfer', name: 'Patta Transfer History' },
      { id: 'natham', name: 'Natham / Poramboke Conversion Order' },
    ],
  },
  {
    id: 'approvals',
    title: '3. Approvals & Planning',
    documents: [
      { id: 'dtcp', name: 'DTCP Approval' },
      { id: 'cmda', name: 'CMDA Approval' },
      { id: 'layout_approval', name: 'Layout Approval' },
      { id: 'building_plan', name: 'Building Plan Approval' },
      { id: 'land_use_cert', name: 'Land Use Certificate' },
      { id: 'noc_housing', name: 'NOC (Housing Board / Local Body)' },
    ],
  },
  {
    id: 'tax_utility',
    title: '4. Tax & Utility Records',
    documents: [
      { id: 'property_tax', name: 'Property Tax Receipts' },
      { id: 'water_tax', name: 'Water Tax / No-Dues Certificate' },
      { id: 'electricity_noc', name: 'Electricity No-Dues' },
    ],
  },
  {
    id: 'family_succession',
    title: '5. Family & Succession Records',
    documents: [
      { id: 'family_tree', name: 'Family Tree / Family Record' },
      { id: 'heirship_cert', name: 'Legal Heirship Certificate' },
      { id: 'death_cert', name: 'Death Certificate' },
      { id: 'divorce_decree', name: 'Divorce Decree' },
      { id: 'marriage_cert', name: 'Marriage Certificate' },
      { id: 'family_settlement', name: 'Family Settlement Agreement' },
      { id: 'succession_records', name: 'Religion-specific Succession Records' },
    ],
  },
  {
    id: 'loan_encumbrance',
    title: '6. Loan & Encumbrance',
    documents: [
      { id: 'cersai', name: 'CERSAI Search Report' },
      { id: 'sarfaesi', name: 'SARFAESI Notice Check' },
      { id: 'bank_noc', name: 'Bank NOC / Loan Closure Letter' },
    ],
  },
  {
    id: 'court_records',
    title: '7. Court Records',
    documents: [
      { id: 'hc_search', name: 'High Court Search Report' },
      { id: 'dc_search', name: 'District Court Search Report' },
      { id: 'ccc_search', name: 'City Civil Court Search Report' },
      { id: 'sc_search', name: 'Supreme Court Search Report' },
      { id: 'lok_adalat', name: 'Lok Adalat / Arbitration Award' },
      { id: 'injunction', name: 'Injunction / Stay Order Check' },
      { id: 'partition_suit', name: 'Partition Suit Decree' },
      { id: 'succession_cert', name: 'Succession Certificate' },
      { id: 'letters_admin', name: 'Letters of Administration' },
      { id: 'probate', name: 'Probate Order' },
      { id: 'court_auction', name: 'Court Auction Sale Certificate' },
      { id: 'insolvency', name: 'Insolvency / Bankruptcy Search' },
    ],
  },
  {
    id: 'govt_acquisition',
    title: '8. Government Acquisition & Restriction Records',
    documents: [
      { id: 'la_notice', name: 'Land Acquisition Notice (Sec 4 / Sec 6)' },
      { id: 'award_comp', name: 'Award Passed / Compensation Order' },
      { id: 'gazette', name: 'Government Acquisition Gazette Notification' },
      { id: 'nh_sh', name: 'NH / SH Road Widening Notification' },
      { id: 'metro_notice', name: 'Metro / CMRL Acquisition Notice' },
      { id: 'railway_notice', name: 'Railway Acquisition Notice' },
    ],
  },
  {
    id: 'crz',
    title: '9. CRZ Records',
    documents: [
      { id: 'crz_cert', name: 'CRZ Classification Certificate' },
      { id: 'crz_noc', name: 'CRZ Clearance / NOC' },
      { id: 'htl_ltl', name: 'HTL / LTL Demarcation' },
      { id: 'czmp', name: 'Coastal Zone Management Plan Reference' },
    ],
  },
  {
    id: 'environmental',
    title: '10. Environmental Protection Records',
    documents: [
      { id: 'env_clearance', name: 'Environmental Clearance Certificate' },
      { id: 'pcb_noc', name: 'Pollution Control Board NOC' },
      { id: 'forest_clearance', name: 'Forest Department Clearance' },
      { id: 'green_belt', name: 'Green Belt / Buffer Zone Check' },
      { id: 'epa_compliance', name: 'EPA Notification Compliance' },
    ],
  },
  {
    id: 'marshy',
    title: '11. Marshy & Water Body Records',
    documents: [
      { id: 'marshy_class', name: 'Marshy / Low-lying Land Classification' },
      { id: 'poramboke_check', name: 'Poramboke Water Body Check' },
      { id: 'lake_buffer', name: 'Lake / Pond / Canal Buffer Zone Clearance' },
      { id: 'revenue_class', name: 'Revenue Classification (Wet Land / Dry Land)' },
    ],
  },
  {
    id: 'mountain',
    title: '12. Mountain & Hill Protection Records',
    documents: [
      { id: 'hada', name: 'Hill Area Development Authority Clearance (HADA)' },
      { id: 'esz', name: 'Eco-sensitive Zone (ESZ) Clearance' },
      { id: 'western_ghats', name: 'Western Ghats Protection Zone Check' },
      { id: 'forest_boundary', name: 'Forest Boundary Demarcation' },
    ],
  },
] as const

/** Documents admin prepares and sends to buyer (Sales Pipeline). */
export const SALE_DOCUMENT_CATEGORIES = [
  {
    id: 'sale_agreement_docs',
    title: '1. Sale Agreement & Title',
    documents: [
      { id: 'sale_agreement', name: 'Sale Agreement' },
      { id: 'title_deed', name: 'Title Deed' },
      { id: 'ec_buyer', name: 'Encumbrance Certificate' },
      { id: 'noc_buyer', name: 'NOC' },
    ],
  },
  {
    id: 'registration_buyer',
    title: '2. Registration & Transfer',
    documents: [
      { id: 'registration_docs', name: 'Registration Documents' },
      { id: 'khata_transfer', name: 'Khata Transfer' },
      { id: 'possession_letter', name: 'Possession Letter' },
    ],
  },
  {
    id: 'tax_compliance',
    title: '3. Tax & Compliance',
    documents: [
      { id: 'property_tax_receipt', name: 'Property Tax Receipt' },
      { id: 'maintenance_noc', name: 'Maintenance / Society NOC' },
      { id: 'builder_handover', name: 'Builder Handover Documents' },
    ],
  },
  {
    id: 'utility_handover',
    title: '4. Utility & Handover',
    documents: [
      { id: 'electricity_transfer', name: 'Electricity Transfer' },
      { id: 'water_connection', name: 'Water Connection Transfer' },
      { id: 'keys_handover', name: 'Keys Handover Acknowledgement' },
    ],
  },
] as const

const ALL_CATEGORY_IDS = DOCUMENT_CATEGORIES.map((c) => c.id)
const MAX_FILES_PER_DOCUMENT = 10

/** Categories shown per property type (unknown types show all). */
export const CATEGORY_IDS_BY_PROPERTY_TYPE: Record<string, string[]> = {
  apartment: [
    'registration',
    'revenue',
    'approvals',
    'tax_utility',
    'family_succession',
    'loan_encumbrance',
    'court_records',
  ],
  villa: [
    'registration',
    'revenue',
    'approvals',
    'tax_utility',
    'family_succession',
    'loan_encumbrance',
    'court_records',
    'environmental',
  ],
  house: [
    'registration',
    'revenue',
    'approvals',
    'tax_utility',
    'family_succession',
    'loan_encumbrance',
    'court_records',
  ],
  penthouse: [
    'registration',
    'revenue',
    'approvals',
    'tax_utility',
    'family_succession',
    'loan_encumbrance',
    'court_records',
  ],
  studio: [
    'registration',
    'revenue',
    'approvals',
    'tax_utility',
    'loan_encumbrance',
    'court_records',
  ],
  plot: [
    'registration',
    'revenue',
    'approvals',
    'tax_utility',
    'loan_encumbrance',
    'court_records',
    'govt_acquisition',
  ],
  land: [
    'registration',
    'revenue',
    'tax_utility',
    'loan_encumbrance',
    'court_records',
    'govt_acquisition',
    'marshy',
    'mountain',
  ],
  commercial: [
    'registration',
    'revenue',
    'approvals',
    'tax_utility',
    'loan_encumbrance',
    'court_records',
    'environmental',
  ],
}

export function categoryIdsForPropertyType(propertyType: string): string[] {
  const key = propertyType.trim().toLowerCase().replace(/\s+/g, '_')
  return CATEGORY_IDS_BY_PROPERTY_TYPE[key] ?? ALL_CATEGORY_IDS
}

function formatPropertyTypeLabel(propertyType: string) {
  return propertyType
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function normalizeDocument(doc: LegalDocumentItem): LegalDocumentItem {
  const files = Array.isArray(doc.files) ? doc.files : []
  return { ...doc, files }
}

export function applyRequiredFlags(
  docs: LegalDocumentItem[],
  requiredIds: Set<string>,
): LegalDocumentItem[] {
  return docs.map((d) => normalizeDocument({ ...d, required: requiredIds.has(d.id) }))
}

export function createInitialDocuments(requiredDocIds: string[] = []): LegalDocumentItem[] {
  const requiredIds = new Set(requiredDocIds)
  return DOCUMENT_CATEGORIES.flatMap((cat) =>
    cat.documents.map((doc) => ({
      ...doc,
      required: requiredIds.has(doc.id),
      files: [],
      isCustom: false,
    })),
  )
}

export function createInitialSalesDocuments(requiredDocIds: string[] = []): LegalDocumentItem[] {
  const requiredIds = new Set(requiredDocIds)
  return SALE_DOCUMENT_CATEGORIES.flatMap((cat) =>
    cat.documents.map((doc) => ({
      ...doc,
      required: requiredIds.has(doc.id),
      files: [],
      isCustom: false,
    })),
  )
}

export function deriveDocumentStatus(doc: LegalDocumentItem): LegalDocStatus {
  const files = doc.files ?? []
  if (files.length === 0) return 'missing'
  if (files.every((f) => f.status === 'verified')) return 'verified'
  if (files.some((f) => f.status === 'rejected')) return 'rejected'
  return 'uploaded'
}

export function isDocumentComplete(doc: LegalDocumentItem): boolean {
  const files = doc.files ?? []
  return files.length > 0 && files.every((f) => f.status === 'verified')
}

function isImageUrl(url: string) {
  return /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(url)
}

function progressBarColor(pct: number) {
  if (pct >= 100) return 'bg-green-500'
  if (pct > 80) return 'bg-green-500'
  if (pct >= 50) return 'bg-orange-500'
  return 'bg-red-500'
}

function categoryBadgeClass(complete: number, total: number) {
  if (total === 0) return 'bg-muted text-muted-foreground'
  if (complete === total) return 'bg-green-100 text-green-700'
  if (complete > 0) return 'bg-orange-100 text-orange-700'
  return 'bg-muted text-muted-foreground'
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

function fileStatusLabel(status: FileStatus) {
  if (status === 'verified') return '✅ Verified'
  if (status === 'rejected') return '❌ Rejected'
  if (status === 'awaiting_upload') return '⏳ Awaiting from app'
  return 'Pending'
}

function phoneForWa(phone: string | null): string | null {
  if (!phone?.trim()) return null
  const digits = phone.replace(/\D/g, '')
  return digits.length > 0 ? digits : null
}

function buildDocumentWhatsAppMessage(
  partyName: string,
  documentName: string,
  propertyTitle: string,
) {
  return (
    `Hi ${partyName} 👋\n\n` +
    `We need the following document \n` +
    `for your property *${propertyTitle}*:\n\n` +
    `📄 *${documentName}*\n\n` +
    `Please upload it directly on the \n` +
    `Builtglory app under:\n` +
    `Documents → ${documentName}\n\n` +
    `Or reply here with the document.\n\n` +
    `Thank you,\n` +
    `Team Builtglory`
  )
}

function buildDocumentEmailContent(
  partyName: string,
  documentName: string,
  propertyTitle: string,
) {
  return {
    subject: `Document Required: ${documentName} — ${propertyTitle}`,
    body:
      `Dear ${partyName},\n\n` +
      `We require the following document \n` +
      `to proceed with your property \n` +
      `${propertyTitle}:\n\n` +
      `Document: ${documentName}\n\n` +
      `Please upload it on the Builtglory app:\n` +
      `1. Open Builtglory app\n` +
      `2. Go to My Documents\n` +
      `3. Upload ${documentName}\n\n` +
      `Or reply to this email with the document.\n\n` +
      `Regards,\n` +
      `Team Builtglory`,
  }
}

function buildSendWhatsAppMessage(
  buyerName: string,
  documentName: string,
  propertyTitle: string,
  documentLink: string,
) {
  const linkLine = documentLink.trim() ? `${documentLink.trim()}\n\n` : ''
  return (
    `Hi ${buyerName} 📄\n\n` +
    `Please find the ${documentName} \n` +
    `for your property *${propertyTitle}*.\n\n` +
    linkLine +
    `Please review and confirm receipt.\n` +
    `— Team Builtglory`
  )
}

function buildSendEmailContent(
  documentName: string,
  propertyTitle: string,
  buyerName: string,
  documentLink: string,
) {
  const linkLine = documentLink.trim() ? `\n\nDocument link: ${documentLink.trim()}` : ''
  return {
    subject: `Document: ${documentName} — ${propertyTitle}`,
    body:
      `Dear ${buyerName},\n\n` +
      `Please find the ${documentName} for your property ${propertyTitle}.${linkLine}\n\n` +
      `Please review and confirm receipt.\n\n` +
      `Regards,\n` +
      `Team Builtglory`,
  }
}

function buildSendPushContent(
  documentName: string,
  propertyTitle: string,
  audience: NotificationAudience,
) {
  const template = NOTIFICATION_TEMPLATES.N06_DOCS_SHARED('', propertyTitle)
  return {
    title: template.title,
    body: `${documentName} for ${propertyTitle} has been shared with you. Check the app.`,
    deepLink: audience === 'seller' ? 'SL-11' : 'B-14',
    audience,
  }
}

function buildSendAllPushContent(
  documentCount: number,
  propertyTitle: string,
  audience: NotificationAudience,
) {
  const template = NOTIFICATION_TEMPLATES.N06_DOCS_SHARED('', propertyTitle)
  return {
    title: template.title,
    body: `${documentCount} documents for ${propertyTitle} have been shared with you. Check the app.`,
    deepLink: audience === 'seller' ? 'SL-11' : 'B-14',
    audience,
  }
}

function workflowPushOptions(
  partyType: NotificationAudience,
  relatedToType: 'acquisition' | 'deal',
  dealId: string,
  partyUserId: string | null | undefined,
  dedupeKey: string,
): SendPushOptions {
  return {
    audience: partyType,
    userId: partyUserId,
    relatedTo: { type: relatedToType, id: dealId },
    dedupeKey,
    skipDuplicateCheck: true,
  }
}

function isDocSendable(doc: LegalDocumentItem) {
  const files = doc.files ?? []
  return (
    files.length > 0 &&
    files.some((f) => f.status === 'uploaded' || f.status === 'verified')
  )
}

function deriveDisplayDocStatus(doc: LegalDocumentItem): LegalDocStatus {
  if (doc.sentToBuyerAt) return 'sent_to_buyer'
  return deriveDocumentStatus(doc)
}

function docStatusBadge(status: LegalDocStatus) {
  if (status === 'sent_to_buyer') {
    return (
      <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
        📤 Sent to Buyer
      </span>
    )
  }
  if (status === 'verified') {
    return (
      <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        ✅ Verified
      </span>
    )
  }
  if (status === 'uploaded') {
    return (
      <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
        Pending verification
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        ❌ Rejected
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Missing
    </span>
  )
}

export type PreviewDocState = {
  name: string
  url: string | null
  docId: string
  fileId: string
  status: FileStatus
  statusLabel: string
  uploadedAt: string
}

export interface LegalDocumentChecklistProps {
  dealId: string
  relatedToType: 'acquisition' | 'deal'
  propertyType: string
  partyName: string
  partyPhone: string | null
  partyEmail: string | null
  partyType: 'seller' | 'buyer'
  partyUserId?: string | null
  propertyTitle: string
  documents: LegalDocumentItem[]
  setDocuments: React.Dispatch<React.SetStateAction<LegalDocumentItem[]>>
  customDocs: LegalDocumentItem[]
  setCustomDocs: React.Dispatch<React.SetStateAction<LegalDocumentItem[]>>
  onToast: (msg: string) => void
  headerExtra?: ReactNode
  onMoveNext?: () => void
  moveNextLabel?: string
  /** Acquisition: request from party. Sales: send prepared docs to buyer. */
  mode?: DocumentChecklistMode
  sectionTitle?: string
  sectionBanner?: ReactNode
  requiredDocIds?: string[]
  onRequiredDocIdsChange?: (ids: string[]) => void | Promise<void>
}

export function LegalDocumentChecklist({
  dealId,
  relatedToType,
  propertyType,
  partyName,
  partyPhone,
  partyEmail,
  partyType,
  partyUserId,
  propertyTitle,
  documents,
  setDocuments,
  customDocs,
  setCustomDocs,
  onToast,
  headerExtra,
  onMoveNext,
  moveNextLabel = 'Move to Next Stage →',
  mode = 'request',
  sectionTitle,
  sectionBanner,
  requiredDocIds,
  onRequiredDocIdsChange,
}: LegalDocumentChecklistProps) {
  const isSendMode = mode === 'send'
  const resolvedSectionTitle = sectionTitle ?? (isSendMode ? 'Sale Documents' : 'Required Documents')
  const [addedCategoryIds, setAddedCategoryIds] = useState<Set<string>>(() => new Set())
  const [showAddCategories, setShowAddCategories] = useState(false)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    () => new Set(categoryIdsForPropertyType(propertyType)),
  )
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(() => new Set())
  const [newFileDescriptions, setNewFileDescriptions] = useState<Record<string, string>>({})
  const [rejectingFile, setRejectingFile] = useState<{
    docId: string
    fileId: string
    isCustom: boolean
  } | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [removeFileConfirm, setRemoveFileConfirm] = useState<{
    docId: string
    fileId: string
    isCustom: boolean
  } | null>(null)
  const [addingCustom, setAddingCustom] = useState(false)
  const [customTitle, setCustomTitle] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<PreviewDocState | null>(null)
  const [openRequestMenuDocId, setOpenRequestMenuDocId] = useState<string | null>(null)
  const [pushRequestModal, setPushRequestModal] = useState<{
    documentName: string
    docId: string
    isCustom: boolean
  } | null>(null)
  const [sendingDoc, setSendingDoc] = useState<{
    doc: LegalDocumentItem
    isCustom: boolean
  } | null>(null)
  const [sendChannel, setSendChannel] = useState<SendChannel>('whatsapp')
  const [sendDocUrl, setSendDocUrl] = useState('')
  const [sendAllModalOpen, setSendAllModalOpen] = useState(false)
  const [sendAllChannel, setSendAllChannel] = useState<SendChannel>('whatsapp')
  const [uploadChooserDocId, setUploadChooserDocId] = useState<string | null>(null)
  const [adminUploadDocId, setAdminUploadDocId] = useState<string | null>(null)
  const [dashboardOptions, setDashboardOptions] = useState<DashboardOptions | null>(null)
  const requestMenuRef = useRef<HTMLDivElement | null>(null)

  const documentOptions = dashboardOptions?.legalDocuments
  const documentCategories: readonly DashboardDocumentCategory[] =
    documentOptions?.categories?.length ? documentOptions.categories : DOCUMENT_CATEGORIES
  const saleDocumentCategories: readonly DashboardDocumentCategory[] =
    documentOptions?.saleCategories?.length ? documentOptions.saleCategories : SALE_DOCUMENT_CATEGORIES
  const allSaleCategoryIds = useMemo(
    () => saleDocumentCategories.map((c) => c.id),
    [saleDocumentCategories],
  )
  const configuredCategoryIdsForPropertyType = useMemo(() => {
    const key = propertyType.trim().toLowerCase().replace(/\s+/g, '_')
    return documentOptions?.categoryIdsByPropertyType?.[key] ?? categoryIdsForPropertyType(propertyType)
  }, [documentOptions?.categoryIdsByPropertyType, propertyType])
  const activeCategories = isSendMode ? saleDocumentCategories : documentCategories

  const baseCategoryIds = useMemo(() => {
    if (isSendMode) return new Set(allSaleCategoryIds)
    return new Set(configuredCategoryIdsForPropertyType)
  }, [allSaleCategoryIds, configuredCategoryIdsForPropertyType, isSendMode])

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
    setAddedCategoryIds(new Set())
    setShowAddCategories(false)
    setExpandedCats(
      new Set(isSendMode ? allSaleCategoryIds : configuredCategoryIdsForPropertyType),
    )
    setExpandedDocIds(new Set())
  }, [allSaleCategoryIds, configuredCategoryIdsForPropertyType, isSendMode, propertyType])

  useEffect(() => {
    if (!requiredDocIds) return
    const requiredIds = new Set(requiredDocIds)
    setDocuments((prev) => applyRequiredFlags(prev, requiredIds))
    setCustomDocs((prev) => applyRequiredFlags(prev, requiredIds))
  }, [requiredDocIds, setDocuments, setCustomDocs])

  useEffect(() => {
    if (!openRequestMenuDocId) return
    const onPointerDown = (e: MouseEvent) => {
      if (requestMenuRef.current?.contains(e.target as Node)) return
      setOpenRequestMenuDocId(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [openRequestMenuDocId])

  const visibleCategoryIds = useMemo(() => {
    const ids = new Set(baseCategoryIds)
    addedCategoryIds.forEach((id) => ids.add(id))
    return ids
  }, [baseCategoryIds, addedCategoryIds])

  const visibleCategories = useMemo(
    () => activeCategories.filter((c) => visibleCategoryIds.has(c.id)),
    [activeCategories, visibleCategoryIds],
  )

  const hiddenCategories = useMemo(
    () =>
      isSendMode
        ? []
        : documentCategories.filter((c) => !visibleCategoryIds.has(c.id)),
    [documentCategories, isSendMode, visibleCategoryIds],
  )

  const addCategory = (categoryId: string) => {
    setAddedCategoryIds((prev) => new Set([...prev, categoryId]))
    setExpandedCats((prev) => new Set([...prev, categoryId]))
    onToast('Category added to checklist')
  }

  const allDocs = useMemo(
    () => [...documents, ...customDocs].map(normalizeDocument),
    [documents, customDocs],
  )

  const requiredDocs = allDocs.filter((d) => d.required)
  const requiredComplete = requiredDocs.filter(isDocumentComplete).length
  const requiredTotal = requiredDocs.length
  const allRequiredVerified =
    requiredTotal > 0 && requiredDocs.every(isDocumentComplete)
  const requiredProgressPct =
    requiredTotal > 0 ? Math.round((requiredComplete / requiredTotal) * 100) : 0
  const missingRequired = requiredDocs.filter((d) => !isDocumentComplete(d))

  const updateDocFiles = (
    docId: string,
    updater: (files: DocumentFile[]) => DocumentFile[],
    isCustom: boolean,
  ) => {
    const setter = isCustom ? setCustomDocs : setDocuments
    setter((prev) =>
      prev.map((d) => (d.id === docId ? { ...normalizeDocument(d), files: updater(d.files ?? []) } : d)),
    )
  }

  const findDoc = (id: string) => {
    const custom = customDocs.find((d) => d.id === id)
    if (custom) return { doc: normalizeDocument(custom), isCustom: true }
    const base = documents.find((d) => d.id === id)
    return base ? { doc: normalizeDocument(base), isCustom: false } : null
  }

  const toggleDocRequired = (docId: string, isCustom: boolean) => {
    const found = findDoc(docId)
    if (!found) return
    const nextRequired = !found.doc.required
    const idSet = new Set(allDocs.filter((doc) => doc.required).map((doc) => doc.id))
    if (nextRequired) idSet.add(docId)
    else idSet.delete(docId)
    const nextIds = [...idSet]
    if (onRequiredDocIdsChange) {
      void Promise.resolve(onRequiredDocIdsChange(nextIds)).catch((error) => {
        onToast(error instanceof Error ? error.message : 'Could not save required document selection')
      })
    }
    const setter = isCustom ? setCustomDocs : setDocuments
    setter((prev) =>
      prev.map((d) => (d.id === docId ? { ...normalizeDocument(d), required: nextRequired } : d)),
    )
    onToast(nextRequired ? 'Marked as required' : 'Removed required mark')
  }

  const toggleDocExpanded = (docId: string) => {
    setExpandedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  const expandDoc = (docId: string) => {
    setExpandedDocIds((prev) => new Set([...prev, docId]))
  }

  const openFilePreview = (doc: LegalDocumentItem, file: DocumentFile) => {
    setPreviewDoc({
      name: `${doc.name} — ${file.description}`,
      url: file.url,
      docId: doc.id,
      fileId: file.id,
      status: file.status,
      statusLabel: fileStatusLabel(file.status),
      uploadedAt: formatTimeAgo(file.uploadedAt),
    })
  }

  const markDocRequested = (docId: string, isCustom: boolean) => {
    const now = new Date().toISOString()
    const setter = isCustom ? setCustomDocs : setDocuments
    setter((prev) =>
      prev.map((d) =>
        d.id === docId ? { ...normalizeDocument(d), lastRequestedAt: now } : d,
      ),
    )
  }

  const markDocSentToBuyer = (docId: string, isCustom: boolean) => {
    const now = new Date().toISOString()
    const setter = isCustom ? setCustomDocs : setDocuments
    setter((prev) =>
      prev.map((d) =>
        d.id === docId ? { ...normalizeDocument(d), sentToBuyerAt: now } : d,
      ),
    )
  }

  const recordDocumentSend = (
    channel: SendChannel,
    _documentName: string,
    messageText: string,
    docId: string,
    isCustom: boolean,
    to: string,
  ) => {
    markDocSentToBuyer(docId, isCustom)
    logMessage({
      channel,
      to,
      toName: partyName,
      message: messageText,
      sentBy: DEFAULT_SENT_BY,
      relatedTo: {
        type: relatedToType,
        id: dealId,
        title: propertyTitle,
      },
    })
  }

  const openSendModal = (doc: LegalDocumentItem, isCustom: boolean) => {
    setSendingDoc({ doc: normalizeDocument(doc), isCustom })
    setSendChannel('whatsapp')
    setSendDocUrl('')
  }

  const confirmSendDocument = () => {
    if (!sendingDoc) return
    const { doc, isCustom } = sendingDoc
    const documentName = doc.name
    const link = sendDocUrl.trim()

    if (sendChannel === 'whatsapp') {
      const waPhone = phoneForWa(partyPhone)
      if (!waPhone) {
        onToast('Phone number not available')
        return
      }
      const text = buildSendWhatsAppMessage(partyName, documentName, propertyTitle, link)
      window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`, '_blank')
      recordDocumentSend('whatsapp', documentName, text, doc.id, isCustom, waPhone)
    } else if (sendChannel === 'email') {
      const email = partyEmail?.trim()
      if (!email) {
        onToast('Email not available')
        return
      }
      const { subject, body } = buildSendEmailContent(
        documentName,
        propertyTitle,
        partyName,
        link,
      )
      window.open(
        `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
        '_self',
      )
      recordDocumentSend(
        'email',
        documentName,
        `${subject}\n\n${body}`,
        doc.id,
        isCustom,
        email,
      )
    } else {
      const push = buildSendPushContent(documentName, propertyTitle, partyType)
      sendPushNotification(
        partyName,
        push,
        'N-06',
        workflowPushOptions(partyType, relatedToType, dealId, partyUserId, `N-06:send-doc:${dealId}:${doc.id}`),
      )
      recordDocumentSend('push', documentName, `${push.title}\n${push.body}`, doc.id, isCustom, partyName)
    }

    onToast(`Document sent to ${partyName}`)
    setSendingDoc(null)
    setSendDocUrl('')
  }

  const sendableDocs = useMemo(
    () => allDocs.filter(isDocSendable),
    [allDocs],
  )

  const confirmSendAllDocuments = () => {
    if (sendableDocs.length === 0) {
      onToast('No uploaded documents to send')
      return
    }

    const docNames = sendableDocs.map((d) => d.name).join(', ')
    const list = sendableDocs.map((d) => `• ${d.name}`).join('\n')

    if (sendAllChannel === 'whatsapp') {
      const waPhone = phoneForWa(partyPhone)
      if (!waPhone) {
        onToast('Phone number not available')
        return
      }
      const text =
        `Hi ${partyName} 📄\n\n` +
        `Please find the following documents for your property *${propertyTitle}*:\n\n` +
        `${list}\n\n` +
        `Please review and confirm receipt.\n` +
        `— Team Builtglory`
      window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`, '_blank')
      logMessage({
        channel: 'whatsapp',
        to: waPhone,
        toName: partyName,
        message: text,
        sentBy: DEFAULT_SENT_BY,
        relatedTo: { type: relatedToType, id: dealId, title: propertyTitle },
      })
    } else if (sendAllChannel === 'email') {
      const email = partyEmail?.trim()
      if (!email) {
        onToast('Email not available')
        return
      }
      const subject = `Documents — ${propertyTitle}`
      const body =
        `Dear ${partyName},\n\n` +
        `Please find the following documents for your property ${propertyTitle}:\n\n` +
        `${list}\n\n` +
        `Documents: ${docNames}\n\n` +
        `Please review and confirm receipt.\n\n` +
        `Regards,\nTeam Builtglory`
      window.open(
        `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
        '_self',
      )
      logMessage({
        channel: 'email',
        to: email,
        toName: partyName,
        message: `${subject}\n\n${body}`,
        sentBy: DEFAULT_SENT_BY,
        relatedTo: { type: relatedToType, id: dealId, title: propertyTitle },
      })
    } else {
      const push = buildSendAllPushContent(sendableDocs.length, propertyTitle, partyType)
      sendPushNotification(
        partyName,
        push,
        'N-06',
        workflowPushOptions(
          partyType,
          relatedToType,
          dealId,
          partyUserId,
          `N-06:send-all:${dealId}:${sendableDocs.length}`,
        ),
      )
      logMessage({
        channel: 'push',
        to: partyName,
        toName: partyName,
        message: `${push.title}\n${push.body}`,
        sentBy: DEFAULT_SENT_BY,
        relatedTo: { type: relatedToType, id: dealId, title: propertyTitle },
      })
    }

    sendableDocs.forEach((doc) => {
      const isCustom = customDocs.some((d) => d.id === doc.id)
      markDocSentToBuyer(doc.id, isCustom)
    })

    onToast(`Sent ${sendableDocs.length} documents to ${partyName}`)
    setSendAllModalOpen(false)
  }

  const recordDocumentRequest = (
    channel: 'whatsapp' | 'email' | 'push',
    _documentName: string,
    messageText: string,
    docId: string,
    isCustom: boolean,
    to: string,
  ) => {
    markDocRequested(docId, isCustom)
    logMessage({
      channel,
      to,
      toName: partyName,
      message: messageText,
      sentBy: DEFAULT_SENT_BY,
      relatedTo: {
        type: relatedToType,
        id: dealId,
        title: propertyTitle,
      },
    })
  }

  const startAddFile = (docId: string) => {
    expandDoc(docId)
    setUploadChooserDocId(docId)
    setAdminUploadDocId(null)
  }

  const addAdminFileToDoc = (doc: LegalDocumentItem, isCustom: boolean) => {
    const description = (newFileDescriptions[doc.id] ?? '').trim()
    if (!description) {
      onToast('Enter file description')
      return
    }
    if (doc.files.length >= MAX_FILES_PER_DOCUMENT) {
      onToast('Maximum 10 files per document')
      return
    }
    const newFile: DocumentFile = {
      id: `file_${Date.now()}`,
      fileName: description,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
      notes: null,
      url: null,
      description,
    }
    updateDocFiles(doc.id, (files) => [...files, newFile], isCustom)
    setNewFileDescriptions((prev) => ({ ...prev, [doc.id]: '' }))
    setAdminUploadDocId(null)
    setUploadChooserDocId(null)
    expandDoc(doc.id)
    onToast('File added by admin')
  }

  const addAwaitingAppUpload = (doc: LegalDocumentItem, isCustom: boolean) => {
    if (doc.files.length >= MAX_FILES_PER_DOCUMENT) {
      onToast('Maximum 10 files per document')
      return
    }
    const newFile: DocumentFile = {
      id: `file_${Date.now()}`,
      fileName: 'Awaiting app upload',
      uploadedAt: new Date().toISOString(),
      status: 'awaiting_upload',
      notes: null,
      url: null,
      description: 'Awaiting upload from app',
    }
    updateDocFiles(doc.id, (files) => [...files, newFile], isCustom)
    setUploadChooserDocId(null)
    setAdminUploadDocId(null)
    expandDoc(doc.id)
    onToast('Marked as awaiting app upload')
  }

  const sendDocumentWhatsApp = (
    documentName: string,
    docId: string,
    isCustom: boolean,
  ) => {
    const waPhone = phoneForWa(partyPhone)
    if (!waPhone) {
      onToast('Phone number not available')
      return
    }
    const text = buildDocumentWhatsAppMessage(partyName, documentName, propertyTitle)
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`, '_blank')
    recordDocumentRequest('whatsapp', documentName, text, docId, isCustom, waPhone)
    setOpenRequestMenuDocId(null)
    onToast('WhatsApp opened')
  }

  const sendDocumentEmail = (documentName: string, docId: string, isCustom: boolean) => {
    const email = partyEmail?.trim()
    if (!email) {
      onToast('Email not available')
      return
    }
    const { subject, body } = buildDocumentEmailContent(
      partyName,
      documentName,
      propertyTitle,
    )
    window.open(
      `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      '_self',
    )
    recordDocumentRequest(
      'email',
      documentName,
      `${subject}\n\n${body}`,
      docId,
      isCustom,
      email,
    )
    setOpenRequestMenuDocId(null)
    onToast('Email opened')
  }

  const openPushRequestModal = (
    documentName: string,
    docId: string,
    isCustom: boolean,
  ) => {
    setPushRequestModal({ documentName, docId, isCustom })
    setOpenRequestMenuDocId(null)
  }

  const confirmPushDocumentRequest = () => {
    if (!pushRequestModal) return
    const { documentName, docId, isCustom } = pushRequestModal
    const template = NOTIFICATION_TEMPLATES.N18_DOCUMENT_REQUESTED(
      partyName,
      documentName,
      propertyTitle,
    )
    sendPushNotification(
      partyName,
      template,
      'N-18',
      workflowPushOptions(
        partyType,
        relatedToType,
        dealId,
        partyUserId,
        `N-18:request:${dealId}:${docId}`,
      ),
    )
    recordDocumentRequest(
      'push',
      documentName,
      `${template.title}\n${template.body}`,
      docId,
      isCustom,
      partyName,
    )
    onToast(`Push notification sent to ${partyName}'s app`)
    setPushRequestModal(null)
  }

  const requestAllMissing = () => {
    const missing = requiredDocs.filter((d) => d.files.length === 0)
    if (missing.length === 0) {
      onToast('No missing required documents')
      return
    }
    const waPhone = phoneForWa(partyPhone)
    if (!waPhone) {
      onToast('Phone number not available')
      return
    }
    const list = missing.map((d) => `• ${d.name}`).join('\n')
    const text = `Hi ${partyName}, please provide the following documents for property *${propertyTitle}*:\n${list}\nThis is required to proceed.`
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`, '_blank')
    onToast('WhatsApp opened')
  }

  const toggleCategory = (id: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const docsForCategory = (categoryId: string) => {
    const cat = activeCategories.find((c) => c.id === categoryId)
    if (!cat) return []
    return cat.documents
      .map((def) => documents.find((d) => d.id === def.id))
      .filter((d): d is LegalDocumentItem => !!d)
      .map(normalizeDocument)
  }

  const renderRequiredToggle = (doc: LegalDocumentItem, isCustom: boolean, stopPropagation?: boolean) =>
    doc.required ? (
      <button
        type="button"
        className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200"
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation()
          toggleDocRequired(doc.id, isCustom)
        }}
      >
        Required ✅
      </button>
    ) : (
      <button
        type="button"
        className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation()
          toggleDocRequired(doc.id, isCustom)
        }}
      >
        Set as Required
      </button>
    )

  const renderFileSummary = (doc: LegalDocumentItem) => {
    const { files, lastRequestedAt, sentToBuyerAt } = doc
    if (files.length === 0) {
      return (
        <div className="mt-1 space-y-0.5">
          <p className="flex items-center gap-1 text-xs text-red-500">
            <X className="size-3" /> Missing
          </p>
          {isSendMode && sentToBuyerAt && (
            <p className="text-xs text-blue-600">
              Sent to buyer {formatMessageTimeAgo(sentToBuyerAt)}
            </p>
          )}
          {!isSendMode && lastRequestedAt && (
            <p className="text-xs text-muted-foreground">
              📲 Requested {formatMessageTimeAgo(lastRequestedAt)}
            </p>
          )}
        </div>
      )
    }
    const pending = files.filter((f) => f.status === 'uploaded').length
    const rejected = files.filter((f) => f.status === 'rejected').length
    const awaiting = files.filter((f) => f.status === 'awaiting_upload').length
    const allVerified = files.every((f) => f.status === 'verified')

    return (
      <div className="mt-1 space-y-0.5">
        <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {files.length} file(s) uploaded
        </span>
        {awaiting > 0 && (
          <p className="text-xs text-orange-600">⏳ Awaiting upload from app</p>
        )}
        {allVerified && <p className="text-xs text-green-600">✅ All verified</p>}
        {!allVerified && pending > 0 && (
          <p className="text-xs text-orange-500">{pending} pending verification</p>
        )}
        {rejected > 0 && <p className="text-xs text-red-500">{rejected} rejected</p>}
        {files.length > 0 && files.every((f) => f.status === 'rejected') && (
          <p className="text-xs font-medium text-red-600">All files rejected — reupload needed</p>
        )}
        {isSendMode && sentToBuyerAt && (
          <p className="text-xs text-blue-600">
            Sent to buyer {formatMessageTimeAgo(sentToBuyerAt)}
          </p>
        )}
        {!isSendMode && lastRequestedAt && (
          <p className="text-xs text-muted-foreground">
            📲 Requested {formatMessageTimeAgo(lastRequestedAt)}
          </p>
        )}
      </div>
    )
  }

  const renderSendActions = (doc: LegalDocumentItem, isCustom: boolean) => {
    if (doc.sentToBuyerAt) {
      return (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => openSendModal(doc, isCustom)}
          >
            Resend
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() =>
              onToast('Acknowledgement has not been recorded for this document yet')
            }
          >
            View Acknowledgement
          </Button>
        </>
      )
    }
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 border-blue-300 px-2 text-xs text-blue-700 hover:bg-blue-50"
        onClick={() => openSendModal(doc, isCustom)}
      >
        Send to Buyer
      </Button>
    )
  }

  const renderRequestDropdown = (doc: LegalDocumentItem, isCustom: boolean) => {
    const menuOpen = openRequestMenuDocId === doc.id
    return (
      <div
        className="relative"
        ref={menuOpen ? requestMenuRef : undefined}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() =>
            setOpenRequestMenuDocId(menuOpen ? null : doc.id)
          }
        >
          📲 Request Document ▾
        </Button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-30 mt-1 min-w-[13.5rem] rounded-md border border-border bg-card py-1 shadow-md">
            <button
              type="button"
              className="flex w-full px-3 py-2 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!phoneForWa(partyPhone)}
              onClick={() => sendDocumentWhatsApp(doc.name, doc.id, isCustom)}
            >
              💬 Send via WhatsApp
            </button>
            <button
              type="button"
              className="flex w-full px-3 py-2 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!partyEmail?.trim()}
              onClick={() => sendDocumentEmail(doc.name, doc.id, isCustom)}
            >
              📧 Send via Email
            </button>
            <button
              type="button"
              className="flex w-full flex-col px-3 py-2 text-left text-xs hover:bg-muted"
              onClick={() => openPushRequestModal(doc.name, doc.id, isCustom)}
            >
              <span>🔔 Send Push Notification</span>
              <span className="text-[10px] text-muted-foreground">(in-app request)</span>
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderDocRow = (doc: LegalDocumentItem, isCustom: boolean) => {
    const normalized = normalizeDocument(doc)
    const isExpanded = expandedDocIds.has(normalized.id)
    const allRejected =
      normalized.files.length > 0 && normalized.files.every((f) => f.status === 'rejected')
    const pendingCount = normalized.files.filter((f) => f.status === 'uploaded').length
    const showVerifyAll = normalized.files.length > 1 && pendingCount > 0

    return (
      <div
        key={normalized.id}
        className={cn(
          'border-b border-border',
          allRejected && 'bg-red-50/50',
        )}
      >
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => toggleDocExpanded(normalized.id)}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{normalized.name}</p>
              {isSendMode && docStatusBadge(deriveDisplayDocStatus(normalized))}
            </div>
            {renderFileSummary(normalized)}
          </button>

          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {renderRequiredToggle(normalized, isCustom, true)}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                'h-7 px-2 text-xs',
                normalized.files.length === 0
                  ? 'border-blue-300 text-blue-700 hover:bg-blue-50'
                  : 'text-muted-foreground',
              )}
              onClick={() => startAddFile(normalized.id)}
            >
              {normalized.files.length === 0 ? 'Add File' : '+ Add More'}
            </Button>
            {isSendMode
              ? renderSendActions(normalized, isCustom)
              : renderRequestDropdown(normalized, isCustom)}
            {normalized.files.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => toggleDocExpanded(normalized.id)}
              >
                {isExpanded ? '▲' : '▼'} View Files ({normalized.files.length})
              </Button>
            )}
            {showVerifyAll && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 border-green-300 px-2 text-xs text-green-700"
                onClick={() => {
                  updateDocFiles(
                    normalized.id,
                    (files) =>
                      files.map((f) =>
                        f.status === 'uploaded' ? { ...f, status: 'verified' as const } : f,
                      ),
                    isCustom,
                  )
                  onToast('All files verified')
                }}
              >
                Verify All
              </Button>
            )}
            {isCustom && (
              <button
                type="button"
                className="rounded p-1 text-red-600 hover:bg-red-50"
                aria-label="Delete custom document"
                onClick={() => setDeleteConfirmId(normalized.id)}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="space-y-3 border-t border-border bg-muted/20 px-4 pb-4 pt-3">
            {uploadChooserDocId === normalized.id && adminUploadDocId !== normalized.id && (
              <div className="rounded-lg border border-dashed border-border bg-card p-3">
                <p className="mb-2 text-sm font-medium">How would you like to add this document?</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUploadChooserDocId(null)
                      setAdminUploadDocId(normalized.id)
                    }}
                  >
                    📎 Admin Upload
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                    onClick={() => addAwaitingAppUpload(normalized, isCustom)}
                  >
                    📱 Awaiting App Upload
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setUploadChooserDocId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {normalized.files.map((file) => (
              <div
                key={file.id}
                className="rounded-lg border border-border bg-card p-3 shadow-sm"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        {file.status === 'awaiting_upload' ? (
                          <p className="text-sm font-medium text-foreground">{file.description}</p>
                        ) : (
                          <input
                            type="text"
                            value={file.description}
                            onChange={(e) => {
                              const value = e.target.value
                              updateDocFiles(
                                normalized.id,
                                (files) =>
                                  files.map((f) =>
                                    f.id === file.id
                                      ? {
                                          ...f,
                                          description: value,
                                          fileName: value,
                                        }
                                      : f,
                                  ),
                                isCustom,
                              )
                            }}
                            className="w-full rounded border-0 bg-transparent p-0 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        )}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {file.status === 'awaiting_upload'
                            ? `Marked ${formatTimeAgo(file.uploadedAt)}`
                            : `Uploaded ${formatTimeAgo(file.uploadedAt)}`}
                        </p>
                        <span
                          className={cn(
                            'mt-1 inline-block text-xs font-medium',
                            file.status === 'verified' && 'text-green-600',
                            file.status === 'uploaded' && 'text-orange-500',
                            file.status === 'awaiting_upload' && 'text-orange-600',
                            file.status === 'rejected' && 'text-red-500',
                          )}
                        >
                          {fileStatusLabel(file.status)}
                          {file.status === 'rejected' && file.notes ? ` — ${file.notes}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {file.status !== 'awaiting_upload' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => openFilePreview(normalized, file)}
                      >
                        View
                      </Button>
                    )}
                    {file.status === 'uploaded' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 border-green-300 px-2 text-xs text-green-700"
                        onClick={() => {
                          updateDocFiles(
                            normalized.id,
                            (files) =>
                              files.map((f) =>
                                f.id === file.id ? { ...f, status: 'verified' } : f,
                              ),
                            isCustom,
                          )
                          onToast('File verified')
                        }}
                      >
                        Verify
                      </Button>
                    )}
                    {file.status !== 'rejected' && file.status !== 'awaiting_upload' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 border-red-300 px-2 text-xs text-red-700"
                        onClick={() => {
                          setRejectingFile({
                            docId: normalized.id,
                            fileId: file.id,
                            isCustom,
                          })
                          setRejectReason('')
                        }}
                      >
                        Reject
                      </Button>
                    )}
                    <button
                      type="button"
                      className="rounded p-1 text-red-600 hover:bg-red-50"
                      aria-label="Remove file"
                      onClick={() =>
                        setRemoveFileConfirm({
                          docId: normalized.id,
                          fileId: file.id,
                          isCustom,
                        })
                      }
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>

                {rejectingFile?.docId === normalized.id &&
                  rejectingFile.fileId === file.id && (
                    <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
                      <label className="text-xs font-medium">Rejection reason</label>
                      <textarea
                        rows={2}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-red-300 text-red-700"
                          onClick={() => {
                            updateDocFiles(
                              normalized.id,
                              (files) =>
                                files.map((f) =>
                                  f.id === file.id
                                    ? {
                                        ...f,
                                        status: 'rejected',
                                        notes: rejectReason.trim() || 'Rejected',
                                      }
                                    : f,
                                ),
                              isCustom,
                            )
                            setRejectingFile(null)
                            setRejectReason('')
                            onToast('File rejected')
                          }}
                        >
                          Confirm Reject
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRejectingFile(null)
                            setRejectReason('')
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
              </div>
            ))}

            {(adminUploadDocId === normalized.id ||
              (normalized.files.length > 0 && uploadChooserDocId !== normalized.id)) && (
              <div className="rounded-lg border border-dashed border-border bg-card p-3">
                <p className="mb-2 text-sm font-medium">Add Another File</p>
                {adminUploadDocId === normalized.id ? (
                  <>
                    <input
                      type="text"
                      value={newFileDescriptions[normalized.id] ?? ''}
                      onChange={(e) =>
                        setNewFileDescriptions((prev) => ({
                          ...prev,
                          [normalized.id]: e.target.value,
                        }))
                      }
                      placeholder="e.g. EC 2010-2023, Sale Deed 1995, Latest copy..."
                      className="mb-3 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addAdminFileToDoc(normalized, isCustom)}
                      >
                        Upload
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAdminUploadDocId(null)
                          setNewFileDescriptions((prev) => ({ ...prev, [normalized.id]: '' }))
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => startAddFile(normalized.id)}
                    >
                      📎 Admin Upload
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      onClick={() => addAwaitingAppUpload(normalized, isCustom)}
                    >
                      📱 Awaiting App Upload
                    </Button>
                  </div>
                )}
                <div className="mt-3 border-t border-border pt-3">
                  {isSendMode
                    ? renderSendActions(normalized, isCustom)
                    : renderRequestDropdown(normalized, isCustom)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle>{resolvedSectionTitle}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSendMode
                ? 'Documents prepared by Builtglory for the buyer'
                : `Documents for ${formatPropertyTypeLabel(propertyType)} property`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {requiredTotal > 0 && (
              <span className="text-sm text-muted-foreground">
                {requiredComplete}/{requiredTotal} required complete
                {requiredProgressPct >= 100 ? ' · Complete ✅' : ''}
              </span>
            )}
            {headerExtra}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sectionBanner}
          {requiredTotal === 0 ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Mark documents as required to track progress
            </p>
          ) : (
            <>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {requiredComplete}/{requiredTotal} required documents complete
                  </span>
                  <span>{requiredProgressPct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full transition-all',
                      progressBarColor(requiredProgressPct),
                    )}
                    style={{ width: `${requiredProgressPct}%` }}
                  />
                </div>
              </div>
              {isSendMode ? (
                <Button
                  type="button"
                  size="sm"
                  className="w-full sm:w-auto"
                  disabled={sendableDocs.length === 0}
                  onClick={() => {
                    setSendAllChannel('whatsapp')
                    setSendAllModalOpen(true)
                  }}
                >
                  📤 Send All to Buyer
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={requestAllMissing}
                >
                  Request All Missing
                </Button>
              )}
            </>
          )}

          <div className="space-y-2">
            {visibleCategories.map((cat) => {
              const catDocs = docsForCategory(cat.id)
              const catComplete = catDocs.filter(isDocumentComplete).length
              const expanded = expandedCats.has(cat.id)
              return (
                <div key={cat.id} className="overflow-hidden rounded-lg border border-border">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 bg-muted/30 px-4 py-3 text-left"
                    onClick={() => toggleCategory(cat.id)}
                  >
                    <span className="flex items-center gap-2 font-semibold text-foreground">
                      {expanded ? (
                        <ChevronUp className="size-4 shrink-0" />
                      ) : (
                        <ChevronDown className="size-4 shrink-0" />
                      )}
                      {cat.title}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        categoryBadgeClass(catComplete, catDocs.length),
                      )}
                    >
                      {catComplete}/{catDocs.length}
                    </span>
                  </button>
                  {expanded && (
                    <div className="border-t border-border">
                      {catDocs.map((doc) => renderDocRow(doc, false))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {hiddenCategories.length > 0 && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                onClick={() => setShowAddCategories((v) => !v)}
              >
                + Add More Categories
              </Button>
              {showAddCategories && (
                <div className="rounded-lg border border-dashed border-border p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Add extra categories not included for this property type
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {hiddenCategories.map((cat) => (
                      <Button
                        key={cat.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => addCategory(cat.id)}
                      >
                        + {cat.title.replace(/^\d+\.\s*/, '')}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!addingCustom ? (
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              onClick={() => setAddingCustom(true)}
            >
              + Add Custom Document
            </Button>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-border p-4">
              <p className="mb-3 text-sm font-medium">Add Custom Document Field</p>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="e.g. Society NOC, Builder Agreement..."
                className="mb-3 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const title = customTitle.trim()
                    if (!title) {
                      onToast('Enter document title')
                      return
                    }
                    const newDoc: LegalDocumentItem = {
                      id: `custom_${Date.now()}`,
                      name: title,
                      required: false,
                      files: [],
                      isCustom: true,
                    }
                    setCustomDocs((prev) => [...prev, newDoc])
                    setCustomTitle('')
                    setAddingCustom(false)
                    onToast(`"${title}" added to document checklist`)
                  }}
                >
                  Add Document
                </Button>
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setAddingCustom(false)
                    setCustomTitle('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {customDocs.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-muted-foreground">Custom Documents</p>
              <div className="overflow-hidden rounded-lg border border-border">
                {customDocs.map((doc) => renderDocRow(normalizeDocument(doc), true))}
              </div>
            </div>
          )}

          <div className="space-y-3 border-t border-border pt-4">
            {requiredTotal === 0 ? (
              <p className="text-sm text-muted-foreground">
                Mark documents as required to track progress
              </p>
            ) : (
              <>
                <p className="text-sm font-medium">
                  {requiredComplete} of {requiredTotal} required documents verified
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full transition-all',
                      progressBarColor(requiredProgressPct),
                    )}
                    style={{ width: `${requiredProgressPct}%` }}
                  />
                </div>
              </>
            )}

            {allRequiredVerified ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                <p className="font-medium">✅ All required documents verified!</p>
                <p className="mt-1">Ready to proceed to next stage.</p>
                {onMoveNext && (
                  <Button type="button" className="mt-3" size="sm" onClick={onMoveNext}>
                    {moveNextLabel}
                  </Button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <p className="font-medium">
                  Cannot proceed — {missingRequired.length} required documents incomplete:
                </p>
                <ul className="mt-2 list-inside list-disc">
                  {missingRequired.map((d) => (
                    <li key={d.id}>{d.name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {deleteConfirmId && (() => {
        const found = findDoc(deleteConfirmId)
        if (!found?.doc.isCustom) return null
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-lg">
              <p className="font-semibold">Remove &apos;{found.doc.name}&apos;?</p>
              <p className="mt-2 text-sm text-muted-foreground">
                This document will be deleted from the checklist
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-300 text-red-700"
                  onClick={() => {
                    setCustomDocs((prev) => prev.filter((d) => d.id !== deleteConfirmId))
                    setDeleteConfirmId(null)
                    onToast('Document removed')
                  }}
                >
                  Confirm
                </Button>
                <Button type="button" variant="outline" onClick={() => setDeleteConfirmId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )
      })()}

      {removeFileConfirm && (() => {
        const found = findDoc(removeFileConfirm.docId)
        if (!found) return null
        const isLastFile = found.doc.files.length === 1
        const isRequired = found.doc.required
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-lg">
              <p className="font-semibold">Remove this file?</p>
              {isLastFile && isRequired ? (
                <p className="mt-2 text-sm text-red-700">
                  This will mark document as missing again. Remove?
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  This file will be removed from {found.doc.name}.
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-300 text-red-700"
                  onClick={() => {
                    updateDocFiles(
                      removeFileConfirm.docId,
                      (files) => files.filter((f) => f.id !== removeFileConfirm.fileId),
                      removeFileConfirm.isCustom,
                    )
                    setRemoveFileConfirm(null)
                    onToast('File removed')
                  }}
                >
                  Confirm
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRemoveFileConfirm(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )
      })()}

      {sendingDoc && (() => {
        const { doc } = sendingDoc
        const displayStatus = deriveDisplayDocStatus(doc)
        const preview =
          sendChannel === 'whatsapp'
            ? buildSendWhatsAppMessage(partyName, doc.name, propertyTitle, sendDocUrl)
            : sendChannel === 'email'
              ? (() => {
                  const { subject, body } = buildSendEmailContent(
                    doc.name,
                    propertyTitle,
                    partyName,
                    sendDocUrl,
                  )
                  return `Subject: ${subject}\n\n${body}`
                })()
              : (() => {
                  const push = buildSendPushContent(doc.name, propertyTitle, partyType)
                  return `Title: ${push.title}\n\n${push.body}`
                })()

        const channelOptions: { id: SendChannel; icon: string; label: string; hint: string }[] = [
          {
            id: 'whatsapp',
            icon: '💬',
            label: 'WhatsApp',
            hint: 'Send document link via WhatsApp',
          },
          {
            id: 'email',
            icon: '📧',
            label: 'Email',
            hint: 'Send via email with document attached',
          },
          {
            id: 'push',
            icon: '🔔',
            label: 'Push Notification',
            hint: 'Notify buyer on app',
          },
        ]

        return (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div
              className="mx-auto w-full max-w-[500px] rounded-xl bg-card p-6 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Send className="size-5 text-blue-600" />
                  <h3 className="text-lg font-semibold text-foreground">Send Document to Buyer</h3>
                </div>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    setSendingDoc(null)
                    setSendDocUrl('')
                  }}
                  aria-label="Close"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-sm font-medium text-foreground">📄 {doc.name}</p>
                <div className="mt-1">{docStatusBadge(displayStatus)}</div>
              </div>

              <p className="mt-4 text-sm font-medium text-foreground">Send via</p>
              <div className="mt-2 space-y-2">
                {channelOptions.map((opt) => (
                  <label
                    key={opt.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      sendChannel === opt.id
                        ? 'border-blue-400 bg-blue-50/60'
                        : 'border-border hover:bg-muted/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="send-channel"
                      className="mt-1"
                      checked={sendChannel === opt.id}
                      onChange={() => setSendChannel(opt.id)}
                    />
                    <span>
                      <span className="text-sm font-medium text-foreground">
                        {opt.icon} {opt.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>

              <p className="mt-4 text-sm font-medium text-foreground">Message preview</p>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-xs text-foreground">
                {preview}
              </pre>

              <div className="mt-4">
                <label className="text-sm font-medium text-foreground">Document URL (optional):</label>
                <input
                  type="url"
                  value={sendDocUrl}
                  onChange={(e) => setSendDocUrl(e.target.value)}
                  placeholder="Paste document URL or file link..."
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  S3/Drive link to actual file. Leave empty to send notification only.
                </p>
              </div>

              <Button type="button" className="mt-4 w-full" onClick={confirmSendDocument}>
                Send {doc.name} to Buyer
              </Button>
            </div>
          </div>
        )
      })()}

      {sendAllModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="mx-auto w-full max-w-[500px] rounded-xl bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-foreground">Send All Documents</h3>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                onClick={() => setSendAllModalOpen(false)}
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Send all uploaded/verified documents to {partyName}?
            </p>
            <ul className="mt-3 max-h-40 space-y-1 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-sm">
              {sendableDocs.map((d) => (
                <li key={d.id}>📄 {d.name}</li>
              ))}
            </ul>
            {sendableDocs.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">No uploaded documents available.</p>
            )}

            <p className="mt-4 text-sm font-medium text-foreground">Send via</p>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {(['whatsapp', 'email', 'push'] as const).map((ch) => (
                <label key={ch} className="flex items-center gap-1.5 capitalize">
                  <input
                    type="radio"
                    name="send-all-channel"
                    checked={sendAllChannel === ch}
                    onChange={() => setSendAllChannel(ch)}
                  />
                  {ch === 'whatsapp' ? '💬 WhatsApp' : ch === 'email' ? '📧 Email' : '🔔 Push'}
                </label>
              ))}
            </div>

            <Button
              type="button"
              className="mt-4 w-full"
              disabled={sendableDocs.length === 0}
              onClick={confirmSendAllDocuments}
            >
              Send All ({sendableDocs.length} docs)
            </Button>
          </div>
        </div>
      )}

      {pushRequestModal && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-xl bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-foreground">Send Document Request</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              The following notification will be sent to {partyName}&apos;s app:
            </p>
            {(() => {
              const template = NOTIFICATION_TEMPLATES.N18_DOCUMENT_REQUESTED(
                partyName,
                pushRequestModal.documentName,
                propertyTitle,
              )
              return (
                <NotificationPreview
                  title={template.title}
                  body={template.body}
                  deepLink={template.deepLink}
                  notificationId="N-18"
                  recipientLabel={partyName}
                  className="mt-3 border-0 bg-transparent p-0"
                />
              )
            })()}
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
              📱 User will see this notification and can upload directly from the app.
              Document will appear here automatically when backend is connected.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={confirmPushDocumentRequest}>
                Send Notification
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPushRequestModal(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
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
                    <p>File: {previewDoc.name}</p>
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
                    onToast('No downloadable file URL is attached to this document yet')
                  }
                }}
              >
                📥 Download
              </Button>
              {previewDoc.status === 'verified' ? (
                <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm text-green-700">
                  ✅ Verified
                </span>
              ) : previewDoc.status === 'uploaded' ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const found = findDoc(previewDoc.docId)
                    if (found) {
                      updateDocFiles(
                        previewDoc.docId,
                        (files) =>
                          files.map((f) =>
                            f.id === previewDoc.fileId ? { ...f, status: 'verified' } : f,
                          ),
                        found.isCustom,
                      )
                      onToast('File verified')
                    }
                    setPreviewDoc(null)
                  }}
                >
                  Verify
                </Button>
              ) : null}
              <Button type="button" onClick={() => setPreviewDoc(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function useLegalDocumentStats(
  documents: LegalDocumentItem[],
  customDocs: LegalDocumentItem[],
) {
  return useMemo(() => {
    const allDocs = [...documents, ...customDocs].map(normalizeDocument)
    const requiredDocs = allDocs.filter((d) => d.required)
    const allRequiredVerified =
      requiredDocs.length > 0 && requiredDocs.every(isDocumentComplete)
    const anyUploadedNotVerified = allDocs.some(
      (d) => deriveDocumentStatus(d) === 'uploaded',
    )
    const optionalMissing = allDocs.some(
      (d) => !d.required && !isDocumentComplete(d) && d.files.length > 0,
    )
    return { allDocs, requiredDocs, allRequiredVerified, anyUploadedNotVerified, optionalMissing }
  }, [documents, customDocs])
}
