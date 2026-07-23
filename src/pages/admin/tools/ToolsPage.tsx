import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  AlertCircle,
  BarChart2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  GripVertical,
  Home,
  Image as ImageIcon,
  Package,
  Plus,
  Rocket,
  Sparkles,
  Tag,
  Ticket,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatPrice,
  getPropertyTypeLabel as getDomainPropertyTypeLabel,
  type Property,
} from '@/domain/properties'
import { readAdminSession } from '@/api/admin'
import {
  createAdminContent,
  deleteAdminContent,
  listAdminContent,
  updateAdminContent,
  type AdminContentItem,
} from '@/api/adminContent'
import {
  inviteAdminOperator,
  removeAdminOperator,
  updateAdminOperator,
  type AdminOperator,
} from '@/api/adminAdmins'
import {
  createAdminMessageTemplate,
  deleteAdminMessageTemplate,
  listAdminBulkMessages,
  listAdminMessageTemplates,
  sendAdminBulkMessage,
  updateAdminMessageTemplate,
} from '@/api/adminMessaging'
import { getAdminDesigners, type Designer as ApiDesigner } from '@/api/adminEnquiries'
import {
  listAdminProperties,
  listAdminPropertyImportJobs,
  undoAdminPropertyImportJob,
  updateAdminProperty,
  type PropertyImportJob,
} from '@/api/adminProperties'
import { getAdminSettings } from '@/api/adminSettings'
import { listAdminUsers, type User } from '@/api/adminUsers'
import { cn } from '@/lib/utils'
import { COMPANY_SUPPORT_PHONE_DISPLAY } from '@/config/companyContact'
import { findUnknownTemplateVars } from '@/utils/edgeCases'
import {
  formatChannel,
  formatMessageTimeAgo,
  loadAllMessages,
  type SentMessage,
} from '@/utils/messageLog'

type ToolsTab =
  | 'content'
  | 'mastersheet'
  | 'locations'
  | 'pricing'
  | 'templates'
  | 'bulkmessage'

type FaqCategory = 'General' | 'Buying' | 'Selling' | 'Payment'
type TemplateChannel = 'whatsapp' | 'email' | 'sms'
type BulkChannel = 'whatsapp' | 'email' | 'sms' | 'all'

type HomeBannerNavigateTo =
  | 'property'
  | 'featured'
  | 'upcoming'
  | 'buy'
  | 'sell'
  | 'url'
  | 'none'

type HomeBannerSectionLinkMode = 'scroll' | 'full_list'

interface HomeBanner {
  id: string
  title: string
  subtitle: string
  imageUrl: string
  useImage: boolean
  bgColor: string
  textColor: 'white' | 'dark'
  ctaText: string
  ctaColor: string
  navigateTo: HomeBannerNavigateTo
  propertyId: string | null
  propertyTitle: string | null
  sectionLinkMode: HomeBannerSectionLinkMode | null
  buyPrefilterType: string | null
  sellPrefilterType: string | null
  externalUrl: string | null
  startDate: string | null
  expiryDate: string | null
  isActive: boolean
  order: number
}

type HomeBannerDraft = Omit<HomeBanner, 'id' | 'order'>

interface HomeScreenSection {
  id: string
  label: string
  description: string
  isActive: boolean
  canDisable: boolean
  order: number
}

const HOME_SCREEN_LAYOUT_CONTENT_SLUG = 'home-screen-layout-config'
const HOME_SCREEN_BANNERS_CONTENT_SLUG = 'home-screen-banners-config'
const FEATURED_UPCOMING_CONTENT_SLUG = 'featured-upcoming-property-order'
const ONBOARDING_SLIDES_CONTENT_SLUG = 'onboarding-slides-config'
const SCHEDULED_NOTIFICATIONS_CONTENT_SLUG = 'scheduled-notifications-config'
const PROPERTY_TYPE_VISIBILITY_CONTENT_SLUG = 'property-type-visibility-config'
const FORCE_UPDATE_CONTENT_SLUG = 'app-force-update-config'
const TOOLS_OPERATIONAL_CONFIG_CONTENT_SLUG = 'tools-operational-config'

type UpcomingPropertyEntry = { id: string; launchDate: string | null }

type Designer = ApiDesigner & {
  specialization: string[]
}

const adminOperatorToDesigner = (admin: AdminOperator): Designer => ({
  id: admin.id,
  name: admin.name,
  phone: admin.phone ?? '',
  email: admin.email,
  role: admin.role,
  assignedArea: admin.assignedArea.length ? admin.assignedArea : admin.specialization,
  activeEnquiries: 0,
  isAvailable: admin.isAvailable,
  activeProjects: 0,
  specialization: admin.specialization.length ? admin.specialization : admin.assignedArea,
})

const BANNER_BG_PRESETS = [
  { label: 'Blue', value: '#2563EB' },
  { label: 'Green', value: '#16A34A' },
  { label: 'Orange', value: '#EA580C' },
  { label: 'Purple', value: '#9333EA' },
  { label: 'Red', value: '#DC2626' },
  { label: 'Dark', value: '#1E3A5F' },
  { label: 'Teal', value: '#0891B2' },
] as const

const BANNER_CTA_PRESETS = ['#FFFFFF', '#2563EB', '#EA580C', '#16A34A'] as const

const BANNER_PROPERTY_TYPE_OPTIONS: { label: string; slug: string }[] = [
  { label: 'Plot', slug: 'plot' },
  { label: 'Apartment', slug: 'apartment' },
  { label: 'Villa', slug: 'villa' },
  { label: 'Commercial', slug: 'commercial' },
  { label: 'Residential', slug: 'residential' },
  { label: 'Organic Home', slug: 'organic-home' },
  { label: '3D Printing Home', slug: '3d-printing-home' },
  { label: 'Fractional Ownership', slug: 'fractional-ownership' },
  { label: 'CEO Mansion', slug: 'ceo-mansion' },
  { label: 'Holiday Home', slug: 'holiday-home' },
  { label: 'Land & Landbank', slug: 'land-landbank' },
  { label: 'Farm House', slug: 'farm-house' },
  { label: 'NRI Services', slug: 'nri-services' },
  { label: 'Interior', slug: 'interior' },
]

function getPropertyTypeLabel(slug: string): string {
  if (slug === 'all') return 'All'
  return BANNER_PROPERTY_TYPE_OPTIONS.find((o) => o.slug === slug)?.label ?? slug
}

function normalizeExternalUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function isValidExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(normalizeExternalUrl(url))
    return parsed.protocol === 'https:' && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

function formatBannerDateLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isHomeBannerExpired(banner: HomeBanner): boolean {
  if (!banner.expiryDate) return false
  return new Date(banner.expiryDate).getTime() < Date.now()
}

function isHomeBannerScheduled(banner: HomeBanner): boolean {
  if (!banner.startDate) return false
  return new Date(banner.startDate).getTime() > Date.now()
}

function getHomeBannerStatus(
  banner: HomeBanner,
): 'active' | 'scheduled' | 'expired' | 'inactive' {
  if (isHomeBannerExpired(banner)) return 'expired'
  if (isHomeBannerScheduled(banner)) return 'scheduled'
  if (!banner.isActive) return 'inactive'
  return 'active'
}

const PROPERTY_PLACEHOLDER_IMG =
  'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=96'

function isPropertySelectable(p: Property): boolean {
  return !p.isDeleted && p.status !== 'sold'
}

function findPropertyById(
  propertyId: string | null,
  properties: Property[],
): Property | undefined {
  if (!propertyId?.trim()) return undefined
  const key = propertyId.trim().toUpperCase()
  return properties.find(
    (p) => p.id.toUpperCase() === key || p.referenceId.toUpperCase() === key,
  )
}

function propertyExists(propertyId: string | null, properties: Property[]): boolean {
  const p = findPropertyById(propertyId, properties)
  return Boolean(p && !p.isDeleted)
}

function isLinkedPropertySold(propertyId: string | null, properties: Property[]): boolean {
  const p = findPropertyById(propertyId, properties)
  return p?.status === 'sold'
}

function getSelectableProperties(properties: Property[]): Property[] {
  return properties.filter(isPropertySelectable)
}

function filterPropertiesForBannerSearch(query: string, properties: Property[]): Property[] {
  const q = query.trim().toLowerCase()
  const base = getSelectableProperties(properties)
  if (!q) return base.slice(0, 6)
  return base
    .filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.referenceId.toLowerCase().includes(q),
    )
    .slice(0, 6)
}

function filterPropertiesForListAdd(
  query: string,
  properties: Property[],
  opts: {
    excludeFeatured?: boolean
    excludeUpcoming?: boolean
    featuredOrder: string[]
    upcomingOrder: UpcomingPropertyEntry[]
  },
  max = 8,
): Property[] {
  const q = query.trim().toLowerCase()
  const upcomingIds = new Set(opts.upcomingOrder.map((e) => e.id))
  const base = getSelectableProperties(properties).filter((p) => {
    if (p.status !== 'available') return false
    if (opts.excludeFeatured && (p.isFeatured || opts.featuredOrder.includes(p.id))) return false
    if (opts.excludeUpcoming && (p.isUpcoming || upcomingIds.has(p.id))) return false
    return true
  })
  if (!q) return base.slice(0, max)
  return base
    .filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.referenceId.toLowerCase().includes(q),
    )
    .slice(0, max)
}

function getOrderedFeaturedList(properties: Property[], featuredOrder: string[]): Property[] {
  const byId = new Map(properties.map((p) => [p.id, p]))
  return featuredOrder
    .map((id) => byId.get(id))
    .filter((p): p is Property => Boolean(p && p.isFeatured && isPropertySelectable(p)))
}

function getOrderedUpcomingList(
  properties: Property[],
  upcomingOrder: UpcomingPropertyEntry[],
): Property[] {
  const byId = new Map(properties.map((p) => [p.id, p]))
  return upcomingOrder
    .map((entry) => {
      const p = byId.get(entry.id)
      if (!p || !p.isUpcoming) return null
      return { ...p, launchDate: entry.launchDate ?? p.launchDate }
    })
    .filter((p): p is Property => Boolean(p && isPropertySelectable(p)))
}

function initPropertyCatalog(sourceProperties: Property[] = []): {
  properties: Property[]
  featuredOrder: string[]
  upcomingOrder: UpcomingPropertyEntry[]
} {
  const properties = sourceProperties.map((p) => ({ ...p }))
  const featuredOrder = properties.filter((p) => p.isFeatured).map((p) => p.id)
  const upcomingOrder: UpcomingPropertyEntry[] = properties
    .filter((p) => p.isUpcoming)
    .map((p) => ({ id: p.id, launchDate: p.launchDate }))

  return { properties, featuredOrder, upcomingOrder }
}

function isPropertyVerified(p: Property): boolean {
  return p.source === 'acquired' || Boolean(p.specs.reraNumber)
}

function getPropertyAreaLabel(p: Property): string {
  const area = p.specs.builtUpArea ?? p.specs.carpetArea ?? p.specs.plotArea
  return area ? `${area} sqft` : '—'
}

function getLaunchCountdownText(launchDate: string | null): string {
  if (!launchDate) return 'Date TBD'
  const daysUntil = Math.ceil(
    (new Date(launchDate).getTime() - Date.now()) / 86400000,
  )
  if (daysUntil <= 0) return 'Launched!'
  if (daysUntil === 1) return 'Launching tomorrow!'
  return `Launching in ${daysUntil} days`
}

function getUpcomingRowBadge(launchDate: string | null): {
  label: string
  className: string
} {
  if (!launchDate) {
    return { label: 'Set date ⚠️', className: 'bg-orange-100 text-orange-800' }
  }
  if (isLaunchDatePast(launchDate)) {
    return { label: 'Passed ❌', className: 'bg-red-100 text-red-800' }
  }
  if (isLaunchingSoon(launchDate)) {
    return { label: 'Launching soon! 🚀', className: 'bg-green-100 text-green-800' }
  }
  return {
    label: `Launches ${formatLaunchDateLabel(launchDate)}`,
    className: 'bg-blue-100 text-blue-800',
  }
}

function AppPhonePreview({
  type,
  properties,
}: {
  type: 'featured' | 'upcoming'
  properties: Property[]
}) {
  const previewProps = properties.slice(0, 2)

  return (
    <div className="flex flex-col items-center">
      <div className="w-[280px] overflow-hidden rounded-[40px] border-2 border-gray-800 bg-white shadow-xl">
        <div className="flex h-6 items-center justify-center bg-gray-800">
          <div className="h-4 w-20 rounded-b-xl bg-gray-900" />
        </div>
        <div className="flex items-center justify-between bg-white px-4 py-1 text-[10px] text-muted-foreground">
          <span>9:41</span>
          <span>●●●</span>
        </div>
        <div className="border-b border-border px-3 py-2 text-center text-[10px] font-bold tracking-wide">
          BUILTGLORY
        </div>
        <div className="max-h-[380px] overflow-y-auto p-3">
          {type === 'featured' ? (
            <>
              <div className="mb-2 flex items-center justify-between text-xs font-semibold">
                <span>Featured Properties</span>
                <span className="text-primary">See All</span>
              </div>
              {previewProps.length === 0 ? (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-center text-xs text-orange-800">
                  No featured properties — section hidden on app
                </div>
              ) : (
                <>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {previewProps.map((p) => (
                      <div
                        key={p.id}
                        className="inline-block w-[130px] shrink-0 overflow-hidden rounded-xl border bg-white shadow-sm"
                      >
                        <div className="relative h-20 bg-muted">
                          {p.coverPhoto || p.photos[0] ? (
                            <img
                              src={getPropertyThumbnail(p)}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground">
                              <Home className="size-6" />
                            </div>
                          )}
                          {isPropertyVerified(p) && (
                            <span className="absolute right-1 top-1 rounded bg-green-100 px-1 text-[9px] text-green-800">
                              ✅ Verified
                            </span>
                          )}
                        </div>
                        <div className="space-y-0.5 p-2">
                          <p className="text-xs font-bold text-primary">{formatPrice(p.price)}</p>
                          <p className="truncate text-xs font-medium">{p.title}</p>
                          <p className="truncate text-[10px] text-muted-foreground">📍 {p.city}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {getPropertyAreaLabel(p)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-center gap-1">
                    {previewProps.map((_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'size-1.5 rounded-full',
                          i === 0 ? 'bg-primary' : 'bg-muted',
                        )}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between text-xs font-semibold">
                <span>Upcoming Properties</span>
                <span className="text-primary">See All</span>
              </div>
              {previewProps.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No upcoming launches
                </div>
              ) : (
                <div className="space-y-2">
                  {allUpcomingLaunchesPassedInList(properties) && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[10px] text-red-800">
                      All upcoming launches passed! Update dates or remove listings.
                    </div>
                  )}
                  {previewProps.map((p) => (
                    <div
                      key={p.id}
                      className="overflow-hidden rounded-xl border bg-white shadow-sm"
                    >
                      <div className="relative h-[120px] bg-muted">
                        {p.coverPhoto || p.photos[0] ? (
                          <img
                            src={getPropertyThumbnail(p)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground">
                            <Home className="size-8" />
                          </div>
                        )}
                        <span className="absolute right-2 top-2 rounded bg-amber-300 px-1.5 py-0.5 text-[9px] font-semibold text-amber-900">
                          UPCOMING
                        </span>
                        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">
                          {getLaunchCountdownText(p.launchDate)}
                        </span>
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-bold text-primary">{formatPrice(p.price)}</p>
                        <p className="truncate text-xs font-medium">{p.title}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Preview updates as you edit</p>
    </div>
  )
}

function allUpcomingLaunchesPassedInList(properties: Property[]): boolean {
  return (
    properties.length > 0 &&
    properties.every((p) => p.launchDate && isLaunchDatePast(p.launchDate))
  )
}

function isLaunchDatePast(launchDate: string | null): boolean {
  if (!launchDate) return false
  return new Date(launchDate).getTime() < Date.now()
}

function isLaunchDateFuture(launchDate: string | null): boolean {
  if (!launchDate) return false
  return new Date(launchDate).getTime() > Date.now()
}

function isLaunchingThisMonth(launchDate: string | null): boolean {
  if (!launchDate) return false
  const d = new Date(launchDate)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d >= now
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function formatLaunchDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function isLaunchingSoon(launchDate: string | null): boolean {
  if (!launchDate) return false
  const diff = new Date(launchDate).getTime() - Date.now()
  return diff > 0 && diff <= 7 * 24 * 60 * 60 * 1000
}

function truncateUrl(url: string, max = 36): string {
  if (url.length <= max) return url
  return `${url.slice(0, max)}…`
}

function getPropertyThumbnail(p: Property): string {
  return p.coverPhoto ?? p.photos[0] ?? PROPERTY_PLACEHOLDER_IMG
}

function getBannerTapPreviewLabel(
  draft: HomeBannerDraft,
  opts: { buyTypeLabel?: string; sellTypeLabel?: string },
): string {
  switch (draft.navigateTo) {
    case 'property':
      return draft.propertyTitle ?? 'Select property'
    case 'featured':
      return 'Featured Properties'
    case 'upcoming':
      return 'Upcoming Launches'
    case 'buy':
      return draft.buyPrefilterType && draft.buyPrefilterType !== 'all'
        ? `Buy: ${opts.buyTypeLabel ?? draft.buyPrefilterType}`
        : 'Buy Screen'
    case 'sell':
      return draft.sellPrefilterType && draft.sellPrefilterType !== 'all'
        ? `Sell: ${opts.sellTypeLabel ?? draft.sellPrefilterType}`
        : 'Sell Screen'
    case 'url':
      return 'External URL'
    default:
      return 'No action'
  }
}

function resolveTypeSlugLabel(
  slug: string | null | undefined,
  options: { slug: string; displayName: string }[],
): string | undefined {
  if (!slug || slug === 'all') return undefined
  return options.find((o) => o.slug === slug)?.displayName ?? getPropertyTypeLabel(slug)
}

function suggestTextColor(bgHex: string): 'white' | 'dark' {
  const hex = bgHex.replace('#', '')
  if (hex.length !== 6) return 'white'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? 'dark' : 'white'
}

function buildDefaultHomeSections(): HomeScreenSection[] {
  return [
    {
      id: 'search_bar',
      label: 'Search Bar',
      description: 'Property search at top',
      isActive: true,
      canDisable: false,
      order: 1,
    },
    {
      id: 'buy_sell_tiles',
      label: 'Buy & Sell Tiles',
      description: 'Quick access to buy/sell',
      isActive: true,
      canDisable: false,
      order: 2,
    },
    {
      id: 'promotional_banners',
      label: 'Promotional Banners',
      description: 'Home screen carousel banners',
      isActive: true,
      canDisable: true,
      order: 3,
    },
    {
      id: 'featured_properties',
      label: 'Featured Properties',
      description: 'Curated featured listings carousel',
      isActive: true,
      canDisable: true,
      order: 4,
    },
    {
      id: 'upcoming_properties',
      label: 'Upcoming Properties',
      description: 'Pre-launch and upcoming projects',
      isActive: true,
      canDisable: true,
      order: 5,
    },
    {
      id: 'property_type_grid',
      label: 'Property Type Grid',
      description: '13 property type cards on Buy screen',
      isActive: true,
      canDisable: true,
      order: 6,
    },
    {
      id: 'news_insights',
      label: 'News & Insights',
      description: 'Market news and investment articles',
      isActive: true,
      canDisable: true,
      order: 7,
    },
  ]
}

function buildDefaultHomeBanners(): HomeBanner[] {
  return [
    {
      id: 'b1',
      title: 'Premium Villas in Bangalore',
      subtitle: 'Starting ₹2.5Cr onwards',
      imageUrl: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800',
      useImage: true,
      bgColor: '#2563EB',
      textColor: 'white',
      ctaText: 'View Properties',
      ctaColor: '#FFFFFF',
      navigateTo: 'buy',
      propertyId: null,
      propertyTitle: null,
      sectionLinkMode: null,
      buyPrefilterType: 'villa',
      sellPrefilterType: null,
      externalUrl: null,
      startDate: null,
      expiryDate: null,
      isActive: true,
      order: 1,
    },
    {
      id: 'b2',
      title: 'NRI Investment Guide 2026',
      subtitle: 'Expert tips for overseas buyers',
      imageUrl: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800',
      useImage: true,
      bgColor: '#1E3A5F',
      textColor: 'white',
      ctaText: 'Read Guide',
      ctaColor: '#FFFFFF',
      navigateTo: 'url',
      propertyId: null,
      propertyTitle: null,
      sectionLinkMode: null,
      buyPrefilterType: null,
      sellPrefilterType: null,
      externalUrl: 'https://builtglory.com/nri-guide',
      startDate: null,
      expiryDate: null,
      isActive: true,
      order: 2,
    },
    {
      id: 'b3',
      title: 'Zero Brokerage Plots',
      subtitle: 'CMDA approved layouts',
      imageUrl: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800',
      useImage: true,
      bgColor: '#16A34A',
      textColor: 'white',
      ctaText: 'Explore Plots',
      ctaColor: '#FFFFFF',
      navigateTo: 'buy',
      propertyId: null,
      propertyTitle: null,
      sectionLinkMode: null,
      buyPrefilterType: 'plot',
      sellPrefilterType: null,
      externalUrl: null,
      startDate: null,
      expiryDate: null,
      isActive: false,
      order: 3,
    },
  ]
}

function normalizeHomeBanner(banner: HomeBanner): HomeBanner {
  const needsSectionMode =
    banner.navigateTo === 'featured' || banner.navigateTo === 'upcoming'
  return {
    ...banner,
    sectionLinkMode: needsSectionMode ? (banner.sectionLinkMode ?? 'scroll') : null,
    sellPrefilterType: banner.sellPrefilterType ?? null,
  }
}

interface OnboardingSlide {
  id: string
  order: number
  title: string
  description: string
  imageUrl: string
  isActive: boolean
}

interface ScheduledNotification {
  id: string
  title: string
  body: string
  target: string
  scheduledAt: string
  status: 'scheduled'
  createdBy: string
  createdAt: string
}

interface DeliveryReport {
  id: string
  title: string
  body: string
  sentAt: string
  targetType: string
  sentCount: number
  deliveredCount: number
  openedCount: number
  failedCount: number
}

interface FaqItem {
  id: string
  question: string
  answer: string
  category: FaqCategory
  active: boolean
}

interface PushNotification {
  id: string
  title: string
  audience: string
  sentAt: string
  status: 'Sent' | 'Scheduled' | 'Failed'
}

interface CityRow {
  id: string
  city: string
  state: string
  propertiesCount: number
  active: boolean
}

interface LocalityRow {
  id: string
  locality: string
  city: string
  propertiesCount: number
  active: boolean
}

interface MapZone {
  id: string
  name: string
  city: string
  coordinates: string
  active: boolean
}

interface BoostPlan {
  id: string
  name: string
  priceLabel: string
  description: string
  benefits: string[]
  active: boolean
}

interface BoostOrder {
  id: string
  propertyId: string
  property: string
  plan: string
  started: string
  expires: string
  daysLeft: number
  status: 'active' | 'expired'
}

interface InteriorPackage {
  id: string
  name: string
  priceRange: string
  timeline: string
  active: boolean
}

type ImportHistoryStatus = 'completed' | 'partial' | 'failed' | 'reverted'

interface ImportHistoryEntry {
  id: string
  date: string
  fileName: string
  rowsTotal: number
  rowsSuccess: number
  rowsFailed: number
  status: ImportHistoryStatus
  importedBy: string
  canUndo: boolean
  properties?: { id: string; title: string; status?: string }[]
  failedRows?: { row: number; propertyId: string; reason: string }[]
}

interface ImportErrorEntry {
  id: string
  row: number
  propertyId: string
  errorReason: string
  importDate: string
  fileName: string
}

const DESIGNER_SPECIALIZATIONS = [
  'Modern',
  'Classic',
  'Contemporary',
  'Minimalist',
  'Traditional',
  'Industrial',
  'Luxury',
  'Bohemian',
] as const

interface Coupon {
  id: string
  code: string
  discount: string
  type: '% discount' | 'Flat discount'
  appliesTo: string
  uses: string
  expiry: string
  active: boolean
}

interface ToolsOperationalConfig {
  cities: CityRow[]
  localities: LocalityRow[]
  zones: MapZone[]
  boostPlans: BoostPlan[]
  boostOrders?: BoostOrder[]
  interiorPkgs: InteriorPackage[]
  coupons: Coupon[]
}

const BOOST_DURATION_DAYS = 7

const DEFAULT_BOOST_PLANS: BoostPlan[] = [
  {
    id: 'bp1',
    name: 'Basic',
    priceLabel: 'Free',
    description: 'Standard visibility',
    benefits: ['Listed in search', 'Basic analytics'],
    active: true,
  },
  {
    id: 'bp2',
    name: 'Featured',
    priceLabel: '₹999/week',
    description: 'Highlighted in search results',
    benefits: ['Featured badge', '2x visibility', 'Priority support'],
    active: true,
  },
  {
    id: 'bp3',
    name: 'Premium',
    priceLabel: '₹2499/week',
    description: 'Top placement across the app',
    benefits: ['Top placement', 'Home carousel', 'Dedicated manager'],
    active: true,
  },
]

function formatBoostDate(iso: string) {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function resolveBoostPlanName(featuredIndex: number, boostPlans: BoostPlan[]): string {
  const activePlans = boostPlans.filter((plan) => plan.active)
  if (!activePlans.length) return 'Featured'
  if (featuredIndex === 0) {
    return activePlans[activePlans.length - 1]?.name ?? 'Premium'
  }
  if (featuredIndex === 1) {
    return activePlans[Math.min(1, activePlans.length - 1)]?.name ?? 'Featured'
  }
  return activePlans[0]?.name ?? 'Basic'
}

function buildBoostOrderFromProperty(
  property: Property,
  featuredIndex: number,
  boostPlans: BoostPlan[],
): BoostOrder {
  const startedAt = new Date(property.updatedAt || property.addedAt)
  const expiresAt = new Date(startedAt)
  expiresAt.setDate(expiresAt.getDate() + BOOST_DURATION_DAYS)
  const daysLeft = Math.max(
    0,
    Math.ceil((expiresAt.getTime() - Date.now()) / 86400000),
  )
  const status: BoostOrder['status'] = daysLeft > 0 ? 'active' : 'expired'

  return {
    id: `boost-${property.id}`,
    propertyId: property.id,
    property: property.title,
    plan: resolveBoostPlanName(featuredIndex, boostPlans),
    started: formatBoostDate(startedAt.toISOString()),
    expires: formatBoostDate(expiresAt.toISOString()),
    daysLeft,
    status,
  }
}

function buildActiveBoostOrders(
  properties: Property[],
  featuredOrder: string[],
  boostPlans: BoostPlan[],
): BoostOrder[] {
  const featuredProperties = getOrderedFeaturedList(properties, featuredOrder)
  return featuredProperties.map((property, index) =>
    buildBoostOrderFromProperty(property, index, boostPlans),
  )
}

function mergePropertyLists(...lists: Property[][]): Property[] {
  const byId = new Map<string, Property>()
  for (const list of lists) {
    for (const property of list) {
      byId.set(property.id, property)
    }
  }
  return Array.from(byId.values())
}

function computeLocationCounts(properties: Property[]) {
  const cityCounts: Record<string, number> = {}
  const localityCounts: Record<string, number> = {}
  for (const property of properties) {
    const city = property.city?.trim()
    const locality = property.locality?.trim()
    if (city) {
      const cityKey = city.toLowerCase()
      cityCounts[cityKey] = (cityCounts[cityKey] ?? 0) + 1
    }
    if (city && locality) {
      const localityKey = `${city.toLowerCase()}|${locality.toLowerCase()}`
      localityCounts[localityKey] = (localityCounts[localityKey] ?? 0) + 1
    }
  }
  return { cityCounts, localityCounts }
}

function withCityPropertyCounts(cities: CityRow[], cityCounts: Record<string, number>): CityRow[] {
  return cities.map((city) => ({
    ...city,
    propertiesCount: cityCounts[city.city.trim().toLowerCase()] ?? 0,
  }))
}

function withLocalityPropertyCounts(
  localities: LocalityRow[],
  localityCounts: Record<string, number>,
): LocalityRow[] {
  return localities.map((locality) => ({
    ...locality,
    propertiesCount:
      localityCounts[
        `${locality.city.trim().toLowerCase()}|${locality.locality.trim().toLowerCase()}`
      ] ?? 0,
  }))
}

function inferCitiesFromProperties(properties: Property[]): CityRow[] {
  const byCity = new Map<string, { state: string }>()
  for (const property of properties) {
    const city = property.city?.trim()
    if (!city) continue
    const state = property.state?.trim() || ''
    const existing = byCity.get(city)
    if (!existing) {
      byCity.set(city, { state })
    } else if (!existing.state && state) {
      existing.state = state
    }
  }
  return Array.from(byCity.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([city, { state }], index) => ({
      id: `inferred-city-${index + 1}`,
      city,
      state,
      propertiesCount: 0,
      active: true,
    }))
}

function inferLocalitiesFromProperties(properties: Property[]): LocalityRow[] {
  const seen = new Set<string>()
  const rows: LocalityRow[] = []
  for (const property of properties) {
    const city = property.city?.trim()
    const locality = property.locality?.trim()
    if (!city || !locality) continue
    const key = `${city.toLowerCase()}|${locality.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      id: `inferred-locality-${rows.length + 1}`,
      locality,
      city,
      propertiesCount: 0,
      active: true,
    })
  }
  return rows.sort((a, b) => a.city.localeCompare(b.city) || a.locality.localeCompare(b.locality))
}

interface MessageTemplate {
  id: string
  name: string
  channel: TemplateChannel
  category: string
  body: string
  subject?: string
}

interface TemplateDraft {
  name: string
  category: string
  subject: string
  body: string
}

interface SentBulkMessage {
  id: string
  message: string
  channel: string
  recipients: number
  sentBy: string
  date: string
  status: string
}

type NewsCategory = 'Market News' | 'Tips' | 'Legal' | 'Investment'

interface PropertyTypeIcon {
  id: string
  slug: string
  icon: string
  typeName: string
  displayName: string
  showOnBuy: boolean
  showOnSell: boolean
  active: boolean
  order: number
}

function mergePropertyTypesWithDefaults(cmsTypes: PropertyTypeIcon[]): PropertyTypeIcon[] {
  const defaults = buildDefaultPropertyTypes()
  const defaultBySlug = new Map(defaults.map((item) => [item.slug, item]))
  if (!cmsTypes.length) return defaults

  return cmsTypes.map((cms) => {
    const fallback = defaultBySlug.get(cms.slug)
    if (!fallback) return cms
    return {
      ...fallback,
      ...cms,
      slug: fallback.slug,
      typeName: fallback.typeName,
      displayName: fallback.displayName,
      icon: cms.icon || fallback.icon,
    }
  })
}

function buildDefaultPropertyTypes(): PropertyTypeIcon[] {
  return [
    {
      id: 'pt1',
      slug: 'plot',
      icon: '🏞️',
      typeName: 'Plot',
      displayName: 'Plot',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 1,
    },
    {
      id: 'pt2',
      slug: 'apartment',
      icon: '🏢',
      typeName: 'Apartment',
      displayName: 'Apartment',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 2,
    },
    {
      id: 'pt3',
      slug: 'residential',
      icon: '🏠',
      typeName: 'Residential',
      displayName: 'Residential',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 3,
    },
    {
      id: 'pt4',
      slug: 'commercial',
      icon: '🏬',
      typeName: 'Commercial',
      displayName: 'Commercial',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 4,
    },
    {
      id: 'pt5',
      slug: 'organic-home',
      icon: '🌿',
      typeName: 'Organic Home',
      displayName: 'Organic Home',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 5,
    },
    {
      id: 'pt6',
      slug: '3d-printing-home',
      icon: '🖨️',
      typeName: '3D Printing Home',
      displayName: '3D Printing Home',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 6,
    },
    {
      id: 'pt7',
      slug: 'fractional-ownership',
      icon: '📊',
      typeName: 'Fractional Ownership',
      displayName: 'Fractional Ownership',
      showOnBuy: true,
      showOnSell: false,
      active: true,
      order: 7,
    },
    {
      id: 'pt8',
      slug: 'ceo-mansion',
      icon: '👔',
      typeName: 'CEO Mansion',
      displayName: 'CEO Mansion',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 8,
    },
    {
      id: 'pt9',
      slug: 'holiday-home',
      icon: '🏖️',
      typeName: 'Holiday Home',
      displayName: 'Holiday Home',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 9,
    },
    {
      id: 'pt10',
      slug: 'land-landbank',
      icon: '🗺️',
      typeName: 'Land & Landbank',
      displayName: 'Land & Landbank',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 10,
    },
    {
      id: 'pt11',
      slug: 'farm-house',
      icon: '🌾',
      typeName: 'Farm House',
      displayName: 'Farm House',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 11,
    },
    {
      id: 'pt12',
      slug: 'nri-services',
      icon: '🌍',
      typeName: 'NRI Services',
      displayName: 'NRI Services',
      showOnBuy: true,
      showOnSell: true,
      active: true,
      order: 12,
    },
    {
      id: 'pt13',
      slug: 'interior',
      icon: '🛋️',
      typeName: 'Interior',
      displayName: 'Interior',
      showOnBuy: false,
      showOnSell: true,
      active: false,
      order: 13,
    },
  ]
}

interface NewsArticle {
  id: string
  title: string
  category: NewsCategory
  content: string
  imageUrl: string
  publishedAt: string
  active: boolean
}

const contentId = (item: AdminContentItem) => String(item._id ?? item.id ?? item.referenceId ?? item.slug)
const contentBySlug = (items: AdminContentItem[], slug: string) =>
  items.find((item) => item.slug === slug)
const metadataArray = <T,>(item: AdminContentItem | undefined, key: string): T[] =>
  Array.isArray(item?.metadata?.[key]) ? (item.metadata[key] as T[]) : []
const categoryToCms = (category: FaqCategory) => category.toLowerCase()
const cmsToFaqCategory = (category?: string | null): FaqCategory => {
  const normalized = (category || 'General').toLowerCase()
  if (normalized === 'buying') return 'Buying'
  if (normalized === 'selling') return 'Selling'
  if (normalized === 'payment') return 'Payment'
  return 'General'
}
const cmsToNewsCategory = (category?: string | null): NewsCategory => {
  if (category === 'Tips' || category === 'Legal' || category === 'Investment') return category
  return 'Market News'
}
const toFaqItem = (item: AdminContentItem): FaqItem => ({
  id: contentId(item),
  question: item.title,
  answer: item.body ?? '',
  category: cmsToFaqCategory(item.category),
  active: item.status === 'published',
})
const toNewsArticle = (item: AdminContentItem): NewsArticle => ({
  id: contentId(item),
  title: item.title,
  category: cmsToNewsCategory(item.category),
  content: item.body ?? '',
  imageUrl: item.imageUrl ?? '',
  publishedAt: item.publishedAt ?? item.updatedAt ?? new Date().toISOString(),
  active: item.status === 'published',
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const metadataRecord = (
  item: AdminContentItem | undefined,
  key: string,
): Record<string, unknown> | null => {
  const value = item?.metadata?.[key]
  return isRecord(value) ? value : null
}

const DEFAULT_HOME_BANNER_DRAFT: HomeBannerDraft = {
  title: '',
  subtitle: '',
  imageUrl: '',
  useImage: false,
  bgColor: '#2563EB',
  textColor: 'white',
  ctaText: '',
  ctaColor: '#FFFFFF',
  navigateTo: 'none',
  propertyId: null,
  propertyTitle: null,
  sectionLinkMode: null,
  buyPrefilterType: 'all',
  sellPrefilterType: 'all',
  externalUrl: null,
  startDate: null,
  expiryDate: null,
  isActive: true,
}

const INITIAL_NEWS_ARTICLES: NewsArticle[] = []
const INITIAL_DELIVERY_REPORTS: DeliveryReport[] = []
const INITIAL_FAQS: FaqItem[] = []
const INITIAL_PUSH_HISTORY: PushNotification[] = []
const INITIAL_CITIES: CityRow[] = []
const INITIAL_LOCALITIES: LocalityRow[] = []
const INITIAL_ZONES: MapZone[] = []
const INITIAL_BOOST_PLANS: BoostPlan[] = DEFAULT_BOOST_PLANS
const INITIAL_ARCHIVED_BOOST_ORDERS: BoostOrder[] = []
const INITIAL_INTERIOR: InteriorPackage[] = []
const INITIAL_COUPONS: Coupon[] = []
const INITIAL_TEMPLATES: MessageTemplate[] = []
const SENT_BULK_HISTORY: SentBulkMessage[] = []
const INITIAL_TERMS = ''
const INITIAL_PRIVACY = ''
const VERSION_REGEX = /^\d+\.\d+\.\d+$/

const NEWS_CATEGORY_STYLES: Record<NewsCategory, string> = {
  'Market News': 'bg-blue-100 text-blue-700',
  Tips: 'bg-green-100 text-green-700',
  Legal: 'bg-purple-100 text-purple-700',
  Investment: 'bg-orange-100 text-orange-700',
}

const TEMPLATE_VARS = ['{{name}}', '{{property}}', '{{amount}}', '{{date}}'] as const
const BULK_VARS = ['{{name}}', '{{city}}', '{{property}}'] as const

function buildDefaultOnboardingSlides(): OnboardingSlide[] {
  return []
}

function getImportStatusBadge(status: ImportHistoryStatus) {
  return status === 'completed'
    ? 'Completed'
    : status === 'partial'
      ? 'Partial'
      : status === 'reverted'
        ? 'Reverted'
        : 'Failed'
}

function getDesignerInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'D'
}

function importJobToHistory(job: PropertyImportJob): ImportHistoryEntry {
  const rowsFailed = job.rowsRejected ?? 0
  const status: ImportHistoryStatus =
    job.status === 'reverted'
      ? 'reverted'
      : rowsFailed > 0 && (job.rowsAccepted ?? 0) > 0
        ? 'partial'
        : job.status === 'completed'
          ? 'completed'
          : 'failed'
  return {
    id: job.id,
    date: job.completedAt ?? job.createdAt,
    fileName: job.fileName,
    rowsTotal: job.rowsTotal,
    rowsSuccess: job.rowsAccepted,
    rowsFailed,
    status,
    importedBy: 'Current Admin',
    canUndo: status === 'completed' && !job.revertedAt,
    properties: job.importedProperties.map((property) => ({
      id: property.id,
      title: property.title,
      status: property.status,
    })),
    failedRows: job.errors.map((error) => ({
      row: error.row,
      propertyId: error.field,
      reason: error.message,
    })),
  }
}

function importJobsToErrors(jobs: PropertyImportJob[]): ImportErrorEntry[] {
  return jobs.flatMap((job) =>
    job.errors.map((error) => ({
      id: `${job.id}-${error.row}-${error.field}`,
      row: error.row,
      propertyId: error.field,
      errorReason: error.message,
      importDate: job.completedAt ?? job.createdAt,
      fileName: job.fileName,
    })),
  )
}

type AppContentSection =
  | 'home'
  | 'onboarding'
  | 'faq'
  | 'terms'
  | 'privacy'
  | 'about'
  | 'push'

const APP_CONTENT_NAV: {
  id: AppContentSection
  icon: string
  label: string
  description: string
}[] = [
  { id: 'home', icon: '🏠', label: 'Home Screen', description: 'Banners, featured layout' },
  { id: 'onboarding', icon: '📱', label: 'Onboarding', description: 'Slides, welcome text' },
  { id: 'faq', icon: '❓', label: 'FAQ', description: 'Questions & answers' },
  { id: 'terms', icon: '📋', label: 'Terms & Conditions', description: 'Legal content' },
  { id: 'privacy', icon: '🔒', label: 'Privacy Policy', description: 'Privacy content' },
  { id: 'about', icon: 'ℹ️', label: 'About App', description: 'Version, contact info' },
  { id: 'push', icon: '🔔', label: 'Push Notifications', description: 'Send notifications' },
]

function getToolsTab(pathname: string): ToolsTab {
  if (pathname.includes('/tools/mastersheet')) return 'mastersheet'
  if (pathname.includes('/tools/locations')) return 'locations'
  if (pathname.includes('/tools/pricing')) return 'pricing'
  if (pathname.includes('/tools/templates')) return 'templates'
  if (pathname.includes('/tools/bulkmessage')) return 'bulkmessage'
  return 'content'
}

function highlightVariables(text: string) {
  const parts = text.split(/(\{[^}]+\})/g)
  return parts.map((part, i) =>
    part.startsWith('{') && part.endsWith('}') ? (
      <span key={i} className="font-medium text-primary">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

function formatPushDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function countBuyers(users: User[]) {
  return users.filter((u) => u.role === 'buyer' || u.role === 'both').length
}

function countSellers(users: User[]) {
  return users.filter((u) => u.role === 'seller' || u.role === 'both').length
}

function countNri(users: User[]) {
  return users.filter((u) => u.userType === 'nri').length
}


export function ToolsPage() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const tab = getToolsTab(pathname)

  const [toast, setToast] = useState<string | null>(null)
  const [contentItems, setContentItems] = useState<AdminContentItem[]>([])

  const [homeBanners, setHomeBanners] = useState<HomeBanner[]>(() =>
    buildDefaultHomeBanners().map(normalizeHomeBanner),
  )
  const [bannerFormOpen, setBannerFormOpen] = useState(false)
  const [bannerDraft, setBannerDraft] = useState<HomeBannerDraft>(DEFAULT_HOME_BANNER_DRAFT)
  const [bannerImageTest, setBannerImageTest] = useState<'idle' | 'ok' | 'error'>('idle')
  const [propertySearch, setPropertySearch] = useState('')
  const [bannerImageTests, setBannerImageTests] = useState<Record<string, 'ok' | 'error'>>({})
  const [bulkConfirmText, setBulkConfirmText] = useState('')
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null)
  const [bannerDragIndex, setBannerDragIndex] = useState<number | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [appProperties, setAppProperties] = useState<Property[]>([])
  const [featuredOrder, setFeaturedOrder] = useState<string[]>([])
  const [upcomingOrder, setUpcomingOrder] = useState<UpcomingPropertyEntry[]>([])
  const [featuredAddSearch, setFeaturedAddSearch] = useState('')
  const [featuredDragIndex, setFeaturedDragIndex] = useState<number | null>(null)
  const [upcomingAddOpen, setUpcomingAddOpen] = useState(false)
  const [upcomingAddSearch, setUpcomingAddSearch] = useState('')
  const [upcomingAddSelectedId, setUpcomingAddSelectedId] = useState<string | null>(null)
  const [upcomingAddLaunchDate, setUpcomingAddLaunchDate] = useState('')
  const [upcomingAddDateError, setUpcomingAddDateError] = useState(false)

  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeIcon[]>(() =>
    buildDefaultPropertyTypes(),
  )
  const [visibilityConfirm, setVisibilityConfirm] = useState<{
    type: 'interior-buy' | 'fractional-sell'
    id: string
  } | null>(null)
  const [sections, setSections] = useState<HomeScreenSection[]>(() => buildDefaultHomeSections())
  const [sectionDragIndex, setSectionDragIndex] = useState<number | null>(null)
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>(INITIAL_NEWS_ARTICLES)
  const [editingArticleId, setEditingArticleId] = useState<string | null>(null)
  const [articleDraft, setArticleDraft] = useState({
    title: '',
    category: 'Market News' as NewsCategory,
    content: '',
    imageUrl: '',
    active: true,
  })

  const [onboardingSlides, setOnboardingSlides] = useState<OnboardingSlide[]>(
    () => buildDefaultOnboardingSlides(),
  )
  const [onboardingSlideDragIndex, setOnboardingSlideDragIndex] = useState<number | null>(
    null,
  )
  const [onboardingSlideAddOpen, setOnboardingSlideAddOpen] = useState(false)
  const [onboardingSlideAddDraft, setOnboardingSlideAddDraft] = useState({
    title: '',
    description: '',
    imageUrl: '',
  })
  const [onboardingSlideImageWarnings, setOnboardingSlideImageWarnings] = useState<
    Record<string, boolean>
  >({})

  const [faqs, setFaqs] = useState<FaqItem[]>(INITIAL_FAQS)
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null)
  const [faqDraft, setFaqDraft] = useState({
    question: '',
    answer: '',
    category: 'General' as FaqCategory,
  })

  const [pushTitle, setPushTitle] = useState('')
  const [pushMessage, setPushMessage] = useState('')
  const [pushAudience, setPushAudience] = useState('all')
  const [pushPhone, setPushPhone] = useState('')
  const [pushScheduleLater, setPushScheduleLater] = useState(false)
  const [pushScheduleAt, setPushScheduleAt] = useState('')
  const [pushHistory, setPushHistory] = useState<PushNotification[]>(INITIAL_PUSH_HISTORY)
  const [scheduledNotifications, setScheduledNotifications] = useState<
    ScheduledNotification[]
  >([])
  const [deliveryReports] = useState<DeliveryReport[]>(INITIAL_DELIVERY_REPORTS)
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null)
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false)

  const [termsContent, setTermsContent] = useState(INITIAL_TERMS)
  const [termsLastUpdated, setTermsLastUpdated] = useState('')
  const [privacyContent, setPrivacyContent] = useState(INITIAL_PRIVACY)
  const [privacyLastUpdated, setPrivacyLastUpdated] = useState('')
  const [legalPreview, setLegalPreview] = useState<'terms' | 'privacy' | null>(null)

  const [aboutApp, setAboutApp] = useState({
    appVersion: '1.0.0',
    buildNumber: '100',
    releaseDate: '2026-01-01',
    companyName: 'Builtglory',
    companyWebsite: 'www.builtglory.com',
    supportEmail: 'support@builtglory.com',
    supportPhone: COMPANY_SUPPORT_PHONE_DISPLAY,
    appDescription:
      "Builtglory is India's premier real estate platform connecting buyers and sellers.",
    instagram: '',
    linkedin: '',
    twitter: '',
    whatsapp: COMPANY_SUPPORT_PHONE_DISPLAY,
  })
  const [forceUpdateMinVersion, setForceUpdateMinVersion] = useState('1.0.0')
  const [forceUpdateEnabled, setForceUpdateEnabled] = useState(false)
  const [contentSection, setContentSection] = useState<AppContentSection>('home')

  const [cities, setCities] = useState<CityRow[]>(INITIAL_CITIES)
  const [localities, setLocalities] = useState<LocalityRow[]>(INITIAL_LOCALITIES)
  const [zones, setZones] = useState<MapZone[]>(INITIAL_ZONES)
  const [cityFormOpen, setCityFormOpen] = useState(false)
  const [cityDraft, setCityDraft] = useState({ city: '', state: '', active: true })
  const [editingCityId, setEditingCityId] = useState<string | null>(null)
  const [localityCityFilter, setLocalityCityFilter] = useState('')
  const [localityFormOpen, setLocalityFormOpen] = useState(false)
  const [localityDraft, setLocalityDraft] = useState({
    locality: '',
    city: '',
    active: true,
  })
  const [editingLocalityId, setEditingLocalityId] = useState<string | null>(null)
  const [zoneFormOpen, setZoneFormOpen] = useState(false)
  const [zoneDraft, setZoneDraft] = useState({ name: '', city: '', coordinates: '', active: true })
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)

  const [boostPlans, setBoostPlans] = useState<BoostPlan[]>(INITIAL_BOOST_PLANS)
  const [boostOrderFilter, setBoostOrderFilter] = useState<'all' | 'active' | 'expired'>('all')
  const [archivedBoostOrders, setArchivedBoostOrders] = useState<BoostOrder[]>(
    INITIAL_ARCHIVED_BOOST_ORDERS,
  )
  const [boostOrderActionId, setBoostOrderActionId] = useState<string | null>(null)
  const [interiorPkgs, setInteriorPkgs] = useState<InteriorPackage[]>(INITIAL_INTERIOR)
  const [designers, setDesigners] = useState<Designer[]>([])
  const [designerFormOpen, setDesignerFormOpen] = useState(false)
  const [designerDraft, setDesignerDraft] = useState({
    name: '',
    phone: '',
    email: '',
    specialization: [] as string[],
  })
  const [importHistory, setImportHistory] = useState<ImportHistoryEntry[]>([])
  const [expandedImportId, setExpandedImportId] = useState<string | null>(null)
  const [undoConfirmId, setUndoConfirmId] = useState<string | null>(null)
  const [importErrors, setImportErrors] = useState<ImportErrorEntry[]>([])
  const [coupons, setCoupons] = useState<Coupon[]>(INITIAL_COUPONS)
  const [couponFormOpen, setCouponFormOpen] = useState(false)
  const [couponDraft, setCouponDraft] = useState({
    code: '',
    discountType: '%' as '%' | 'flat',
    discountValue: '',
    appliesTo: 'Boost Plans',
    maxUses: '',
    expiry: '',
    active: true,
  })

  const [templates, setTemplates] = useState<MessageTemplate[]>(INITIAL_TEMPLATES)
  const [templateChannel, setTemplateChannel] = useState<TemplateChannel>('whatsapp')
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null)
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>({
    name: '',
    category: 'General',
    subject: '',
    body: '',
  })

  const [bulkAudience, setBulkAudience] = useState('all')
  const [bulkChannel, setBulkChannel] = useState<BulkChannel>('whatsapp')
  const [bulkTitle, setBulkTitle] = useState('')
  const [bulkBody, setBulkBody] = useState('')
  const [bulkSchedule, setBulkSchedule] = useState<'now' | 'later'>('now')
  const [bulkScheduleAt, setBulkScheduleAt] = useState('')
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [bulkHistory, setBulkHistory] = useState<SentBulkMessage[]>(SENT_BULK_HISTORY)
  const [loading, setLoading] = useState(true)
  const [bulkCustomFilter, setBulkCustomFilter] = useState(false)
  const [bulkSubTab, setBulkSubTab] = useState<'compose' | 'history'>('compose')
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([])
  const [msgLogFilter, setMsgLogFilter] = useState<'all' | 'whatsapp' | 'email'>('all')
  const [msgLogSearch, setMsgLogSearch] = useState('')
  const toolsConfigHydratedRef = useRef(false)
  const lastSavedToolsConfigRef = useRef('')

  const showToast = useCallback((msg: string) => setToast(msg), [])

  const upsertToolsContentConfig = useCallback(
    async ({
      slug,
      section,
      title,
      excerpt,
      category,
      metadata,
    }: {
      slug: string
      section: 'home' | 'onboarding' | 'general' | 'banner'
      title: string
      excerpt: string
      category: string
      metadata: Record<string, unknown>
    }) => {
      const session = readAdminSession()
      if (!session?.accessToken) {
        throw new Error('Sign in again to save app content configuration')
      }
      const existing = contentBySlug(contentItems, slug)
      const payload = {
        slug,
        section,
        title,
        excerpt,
        body: JSON.stringify(metadata),
        category,
        status: 'published' as const,
        metadata,
      }
      const saved = existing
        ? await updateAdminContent(session.accessToken, contentId(existing), payload)
        : await createAdminContent(session.accessToken, payload)
      setContentItems((prev) =>
        existing
          ? prev.map((item) => (contentId(item) === contentId(existing) ? saved : item))
          : [saved, ...prev],
      )
      return saved
    },
    [contentItems],
  )

  const savePropertyCurationConfig = useCallback(
    async (nextFeaturedOrder: string[], nextUpcomingOrder: UpcomingPropertyEntry[]) => {
      await upsertToolsContentConfig({
        slug: FEATURED_UPCOMING_CONTENT_SLUG,
        section: 'home',
        title: 'Featured and Upcoming Property Order',
        excerpt: 'Curated property ordering for home screen sections',
        category: 'property-curation',
        metadata: {
          featuredOrder: nextFeaturedOrder,
          upcomingOrder: nextUpcomingOrder,
        },
      })
    },
    [upsertToolsContentConfig],
  )

  const saveToolsOperationalConfig = useCallback(
    async (config: ToolsOperationalConfig) => {
      await upsertToolsContentConfig({
        slug: TOOLS_OPERATIONAL_CONFIG_CONTENT_SLUG,
        section: 'general',
        title: 'Tools Operational Configuration',
        excerpt: 'Admin-managed locations, pricing, coupons, and packages for Tools',
        category: 'tools-config',
        metadata: {
          ...config,
          interiorPackages: config.interiorPkgs,
        },
      })
    },
    [upsertToolsContentConfig],
  )

  const dashboardMessages = useMemo(() => {
    let list = sentMessages
    if (msgLogFilter !== 'all') {
      list = list.filter((m) => m.channel === msgLogFilter)
    }
    const q = msgLogSearch.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (m) =>
          m.toName.toLowerCase().includes(q) ||
          m.message.toLowerCase().includes(q) ||
          m.to.toLowerCase().includes(q),
      )
    }
    return list
  }, [msgLogFilter, msgLogSearch, sentMessages])

  useEffect(() => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      setLoading(false)
      setUsers([])
      setAppProperties([])
      setDesigners([])
      setContentItems([])
      setSentMessages([])
      setImportHistory([])
      setImportErrors([])
      toolsConfigHydratedRef.current = false
      lastSavedToolsConfigRef.current = ''
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      listAdminProperties(session.accessToken, { limit: 100, sort: 'newest' }),
      listAdminProperties(session.accessToken, { featured: true, limit: 50, sort: 'newest' }),
      listAdminUsers(session.accessToken, { limit: 100, sort: 'newest' }),
      getAdminDesigners(session.accessToken),
      listAdminContent(session.accessToken, { limit: 100, sort: 'newest' }),
      listAdminMessageTemplates(session.accessToken),
      listAdminBulkMessages(session.accessToken),
      listAdminPropertyImportJobs(session.accessToken, 20),
      loadAllMessages(),
      getAdminSettings(session.accessToken).catch(() => null),
    ])
      .then(([properties, featuredProperties, nextUsers, nextDesigners, nextContent, nextTemplates, nextBulkHistory, nextImportJobs, nextSentMessages, adminSettings]) => {
        if (cancelled) return
        const mergedProperties = mergePropertyLists(properties.data, featuredProperties.data)
        const catalog = initPropertyCatalog(mergedProperties)
        const contentRows = nextContent.data
        const curationConfig = contentBySlug(contentRows, FEATURED_UPCOMING_CONTENT_SLUG)
        const cmsFeaturedOrder = metadataArray<string>(curationConfig, 'featuredOrder')
        const cmsUpcomingOrder = metadataArray<UpcomingPropertyEntry>(curationConfig, 'upcomingOrder')
        setAppProperties(catalog.properties)
        setFeaturedOrder(cmsFeaturedOrder.length ? cmsFeaturedOrder : catalog.featuredOrder)
        setUpcomingOrder(cmsUpcomingOrder.length ? cmsUpcomingOrder : catalog.upcomingOrder)
        setUsers(nextUsers.data)
        setDesigners(
          nextDesigners.map((designer) => ({
            ...designer,
            specialization: designer.assignedArea.length ? designer.assignedArea : ['Interior'],
          })),
        )
        setContentItems(contentRows)
        if (nextTemplates.length) setTemplates(nextTemplates)
        setBulkHistory(nextBulkHistory)
        setImportHistory(nextImportJobs.data.map(importJobToHistory))
        setImportErrors(importJobsToErrors(nextImportJobs.data))
        setSentMessages(nextSentMessages)
        const homeBannerConfig = contentBySlug(contentRows, HOME_SCREEN_BANNERS_CONTENT_SLUG)
        const homeLayoutConfig = contentBySlug(contentRows, HOME_SCREEN_LAYOUT_CONTENT_SLUG)
        const onboardingConfig = contentBySlug(contentRows, ONBOARDING_SLIDES_CONTENT_SLUG)
        const propertyTypeConfig = contentBySlug(contentRows, PROPERTY_TYPE_VISIBILITY_CONTENT_SLUG)
        const scheduledConfig = contentBySlug(contentRows, SCHEDULED_NOTIFICATIONS_CONTENT_SLUG)
        const forceUpdateConfig = contentBySlug(contentRows, FORCE_UPDATE_CONTENT_SLUG)
        const toolsOperationalConfig = contentBySlug(contentRows, TOOLS_OPERATIONAL_CONFIG_CONTENT_SLUG)
        const cmsHomeBanners = metadataArray<HomeBanner>(homeBannerConfig, 'banners')
        const cmsHomeSections = metadataArray<HomeScreenSection>(homeLayoutConfig, 'sections')
        const cmsOnboardingSlides = metadataArray<OnboardingSlide>(onboardingConfig, 'slides')
        const cmsPropertyTypes = metadataArray<PropertyTypeIcon>(propertyTypeConfig, 'propertyTypes')
        const cmsScheduledNotifications = metadataArray<ScheduledNotification>(scheduledConfig, 'notifications')
        const cmsForceUpdate = metadataRecord(forceUpdateConfig, 'forceUpdate')
        const cmsCities = metadataArray<CityRow>(toolsOperationalConfig, 'cities')
        const cmsLocalities = metadataArray<LocalityRow>(toolsOperationalConfig, 'localities')
        const cmsZones = metadataArray<MapZone>(toolsOperationalConfig, 'zones')
        const cmsBoostPlans = metadataArray<BoostPlan>(toolsOperationalConfig, 'boostPlans')
        const cmsBoostOrders = metadataArray<BoostOrder>(toolsOperationalConfig, 'boostOrders')
        const cmsInteriorPkgs = metadataArray<InteriorPackage>(toolsOperationalConfig, 'interiorPkgs')
        const cmsCoupons = metadataArray<Coupon>(toolsOperationalConfig, 'coupons')
        if (cmsHomeBanners.length) setHomeBanners(cmsHomeBanners.map(normalizeHomeBanner))
        if (cmsHomeSections.length) setSections(cmsHomeSections)
        if (cmsOnboardingSlides.length) setOnboardingSlides(cmsOnboardingSlides)
        if (cmsPropertyTypes.length) setPropertyTypes(mergePropertyTypesWithDefaults(cmsPropertyTypes))
        if (cmsScheduledNotifications.length) setScheduledNotifications(cmsScheduledNotifications)
        if (cmsCities.length) {
          setCities(cmsCities)
        } else {
          const inferredCities = inferCitiesFromProperties(catalog.properties)
          if (inferredCities.length) setCities(inferredCities)
        }
        if (cmsLocalities.length) {
          setLocalities(cmsLocalities)
        } else {
          const inferredLocalities = inferLocalitiesFromProperties(catalog.properties)
          if (inferredLocalities.length) setLocalities(inferredLocalities)
        }
        if (cmsZones.length) setZones(cmsZones)
        if (cmsBoostPlans.length) {
          setBoostPlans(cmsBoostPlans)
        } else if (adminSettings?.tools?.boostPlans?.length) {
          setBoostPlans(adminSettings.tools.boostPlans)
        }
        if (cmsBoostOrders.length) {
          setArchivedBoostOrders(
            cmsBoostOrders.filter((order) => order.status === 'expired'),
          )
        }
        if (cmsInteriorPkgs.length) {
          setInteriorPkgs(cmsInteriorPkgs)
        } else if (adminSettings?.tools?.interiorPackages?.length) {
          setInteriorPkgs(adminSettings.tools.interiorPackages)
        }
        if (cmsCoupons.length) {
          setCoupons(cmsCoupons)
        } else if (adminSettings?.tools?.coupons?.length) {
          setCoupons(adminSettings.tools.coupons)
        }
        if (cmsForceUpdate) {
          setForceUpdateEnabled(Boolean(cmsForceUpdate.enabled))
          if (typeof cmsForceUpdate.minVersion === 'string') {
            setForceUpdateMinVersion(cmsForceUpdate.minVersion)
          }
        }
        const cmsFaqs = contentRows.filter((item) => item.section === 'faq').map(toFaqItem)
        const cmsNews = contentRows.filter((item) => item.section === 'news').map(toNewsArticle)
        if (cmsFaqs.length) setFaqs(cmsFaqs)
        if (cmsNews.length) setNewsArticles(cmsNews)
        const terms = contentBySlug(contentRows, 'terms-of-service')
        const privacy = contentBySlug(contentRows, 'privacy-policy')
        const about = contentBySlug(contentRows, 'about-builtglory')
        if (terms) {
          setTermsContent(terms.body ?? '')
          setTermsLastUpdated(String(terms.metadata?.lastUpdatedLabel ?? terms.updatedAt ?? 'Published'))
        }
        if (privacy) {
          setPrivacyContent(privacy.body ?? '')
          setPrivacyLastUpdated(String(privacy.metadata?.lastUpdatedLabel ?? privacy.updatedAt ?? 'Published'))
        }
        if (about) {
          setAboutApp((current) => ({
            ...current,
            appVersion: String(about.metadata?.version ?? current.appVersion),
            supportEmail: String(about.metadata?.supportEmail ?? current.supportEmail),
            supportPhone: String(about.metadata?.supportPhone ?? current.supportPhone),
            appDescription: about.body ?? current.appDescription,
          }))
        }
        toolsConfigHydratedRef.current = true
      })
      .catch((error) => {
        if (!cancelled) showToast(error instanceof Error ? error.message : 'Failed to load tools data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showToast])

  useEffect(() => {
    if (!toolsConfigHydratedRef.current) return
    const config: ToolsOperationalConfig = {
      cities,
      localities,
      zones,
      boostPlans,
      boostOrders: archivedBoostOrders,
      interiorPkgs,
      coupons,
    }
    const serialized = JSON.stringify(config)
    if (serialized === lastSavedToolsConfigRef.current) return
    const timer = window.setTimeout(() => {
      saveToolsOperationalConfig(config)
        .then(() => {
          lastSavedToolsConfigRef.current = serialized
        })
        .catch((error) => {
          showToast(error instanceof Error ? error.message : 'Could not save tools configuration')
        })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [archivedBoostOrders, boostPlans, cities, coupons, interiorPkgs, localities, saveToolsOperationalConfig, showToast, zones])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const filteredTemplates = useMemo(
    () => templates.filter((t) => t.channel === templateChannel),
    [templates, templateChannel],
  )

  const bulkRecipientCount = useMemo(() => {
    if (bulkAudience === 'custom' && bulkCustomFilter) {
      return Math.max(1, Math.floor(users.length * 0.4))
    }
    switch (bulkAudience) {
      case 'buyers':
        return countBuyers(users)
      case 'sellers':
        return countSellers(users)
      case 'nri':
        return countNri(users)
      default:
        return users.length
    }
  }, [bulkAudience, bulkCustomFilter, users])

  const bulkMaxChars =
    bulkChannel === 'sms' ? 160 : bulkChannel === 'whatsapp' ? 1000 : 5000

  const smsParts = bulkChannel === 'sms' ? Math.ceil(bulkBody.length / 160) || 1 : 1

  const pushAudienceLabel = useMemo(() => {
    const map: Record<string, string> = {
      all: 'All Users',
      buyers: 'Buyers Only',
      sellers: 'Sellers Only',
      nri: 'NRI Only',
      specific: `Specific User (${pushPhone || 'phone'})`,
    }
    return map[pushAudience] ?? pushAudience
  }, [pushAudience, pushPhone])

  const locationCounts = useMemo(
    () => computeLocationCounts(appProperties),
    [appProperties],
  )
  const citiesWithCounts = useMemo(
    () => withCityPropertyCounts(cities, locationCounts.cityCounts),
    [cities, locationCounts.cityCounts],
  )
  const localitiesWithCounts = useMemo(
    () => withLocalityPropertyCounts(localities, locationCounts.localityCounts),
    [localities, locationCounts.localityCounts],
  )
  const effectiveLocalityCityFilter = useMemo(() => {
    if (!cities.length) return ''
    if (cities.some((city) => city.city === localityCityFilter)) return localityCityFilter
    return cities[0].city
  }, [cities, localityCityFilter])
  const filteredLocalities = localitiesWithCounts.filter(
    (l) => l.city === effectiveLocalityCityFilter,
  )

  const templateHasVars = /\{[^}]+\}/.test(templateDraft.body)

  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections],
  )

  const sortedHomeBanners = useMemo(
    () => [...homeBanners].sort((a, b) => a.order - b.order),
    [homeBanners],
  )

  const activeHomeBannerCount = useMemo(
    () =>
      homeBanners.filter((b) => getHomeBannerStatus(b) === 'active').length,
    [homeBanners],
  )

  const selectableProperties = useMemo(
    () => getSelectableProperties(appProperties),
    [appProperties],
  )
  const featuredProperties = useMemo(
    () => getOrderedFeaturedList(appProperties, featuredOrder),
    [appProperties, featuredOrder],
  )
  const boostOrders = useMemo(() => {
    const activeOrders = buildActiveBoostOrders(appProperties, featuredOrder, boostPlans)
    const activePropertyIds = new Set(activeOrders.map((order) => order.propertyId))
    const archivedOrders = archivedBoostOrders.filter(
      (order) => !activePropertyIds.has(order.propertyId),
    )
    return [...activeOrders, ...archivedOrders]
  }, [appProperties, archivedBoostOrders, boostPlans, featuredOrder])
  const filteredBoostOrders = useMemo(
    () =>
      boostOrders.filter(
        (order) => boostOrderFilter === 'all' || order.status === boostOrderFilter,
      ),
    [boostOrderFilter, boostOrders],
  )
  const boostOrderStats = useMemo(
    () => ({
      active: boostOrders.filter((order) => order.status === 'active').length,
      expired: boostOrders.filter((order) => order.status === 'expired').length,
      total: boostOrders.length,
    }),
    [boostOrders],
  )
  const upcomingProperties = useMemo(
    () => getOrderedUpcomingList(appProperties, upcomingOrder),
    [appProperties, upcomingOrder],
  )
  const bannerPropertySearchResults = useMemo(
    () => filterPropertiesForBannerSearch(propertySearch, appProperties),
    [propertySearch, appProperties],
  )
  const featuredPanelAddResults = useMemo(
    () =>
      filterPropertiesForListAdd(
        featuredAddSearch,
        appProperties,
        { excludeFeatured: true, featuredOrder, upcomingOrder },
        6,
      ),
    [featuredAddSearch, appProperties, featuredOrder, upcomingOrder],
  )
  const upcomingAddResults = useMemo(
    () =>
      filterPropertiesForListAdd(upcomingAddSearch, appProperties, {
        excludeUpcoming: true,
        featuredOrder,
        upcomingOrder,
      }),
    [upcomingAddSearch, appProperties, featuredOrder, upcomingOrder],
  )
  const featuredStats = useMemo(() => {
    const availableToAdd = getSelectableProperties(appProperties).filter(
      (p) => !p.isFeatured && !featuredOrder.includes(p.id),
    ).length
    const prices = featuredProperties.map((p) => p.price)
    const avgPrice =
      prices.length > 0
        ? Math.round(prices.reduce((sum, n) => sum + n, 0) / prices.length)
        : 0
    const cityCounts = featuredProperties.reduce<Record<string, number>>((acc, p) => {
      acc[p.city] = (acc[p.city] ?? 0) + 1
      return acc
    }, {})
    const topCity =
      Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    return {
      count: featuredProperties.length,
      availableToAdd,
      avgPrice,
      topCity,
    }
  }, [appProperties, featuredOrder, featuredProperties])
  const upcomingStats = useMemo(() => {
    const futureLaunches = upcomingProperties
      .map((p) => p.launchDate)
      .filter((d): d is string => Boolean(d && isLaunchDateFuture(d)))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    const missingDates = upcomingProperties.filter((p) => !p.launchDate).length
    const launchingThisMonth = upcomingProperties.filter((p) =>
      isLaunchingThisMonth(p.launchDate),
    ).length
    return {
      count: upcomingProperties.length,
      nextLaunch: futureLaunches[0] ?? null,
      missingDates,
      launchingThisMonth,
    }
  }, [upcomingProperties])
  const selectedBannerProperty = useMemo(
    () => findPropertyById(bannerDraft.propertyId, appProperties),
    [bannerDraft.propertyId, appProperties],
  )
  const buyBannerTypeOptions = useMemo(
    () => [...propertyTypes].filter((pt) => pt.showOnBuy).sort((a, b) => a.order - b.order),
    [propertyTypes],
  )
  const sellBannerTypeOptions = useMemo(
    () => [...propertyTypes].filter((pt) => pt.showOnSell).sort((a, b) => a.order - b.order),
    [propertyTypes],
  )
  const buyDraftTypeLabel = useMemo(
    () => resolveTypeSlugLabel(bannerDraft.buyPrefilterType, buyBannerTypeOptions),
    [bannerDraft.buyPrefilterType, buyBannerTypeOptions],
  )
  const sellDraftTypeLabel = useMemo(
    () => resolveTypeSlugLabel(bannerDraft.sellPrefilterType, sellBannerTypeOptions),
    [bannerDraft.sellPrefilterType, sellBannerTypeOptions],
  )
  const bannerTapPreviewLabel = useMemo(
    () =>
      getBannerTapPreviewLabel(bannerDraft, {
        buyTypeLabel: buyDraftTypeLabel,
        sellTypeLabel: sellDraftTypeLabel,
      }),
    [bannerDraft, buyDraftTypeLabel, sellDraftTypeLabel],
  )
  const bannerUrlInvalid =
    bannerDraft.navigateTo === 'url' &&
    Boolean(bannerDraft.externalUrl?.trim()) &&
    !isValidExternalUrl(bannerDraft.externalUrl ?? '')
  const allUpcomingLaunchesPassed = useMemo(
    () =>
      upcomingProperties.length > 0 &&
      upcomingProperties.every(
        (p) => p.launchDate && new Date(p.launchDate).getTime() < Date.now(),
      ),
    [upcomingProperties],
  )

  const resetBannerDraft = () => {
    setBannerDraft(DEFAULT_HOME_BANNER_DRAFT)
    setBannerImageTest('idle')
    setPropertySearch('')
  }

  const removeFromFeatured = useCallback(
    async (id: string) => {
      const prop = appProperties.find((p) => p.id === id)
      const nextOrder = featuredOrder.filter((x) => x !== id)
      const session = readAdminSession()
      if (!session?.accessToken) return showToast('Sign in again to update featured properties')
      try {
        const saved = await updateAdminProperty(session.accessToken, id, { isFeatured: false })
        await savePropertyCurationConfig(nextOrder, upcomingOrder)
        setFeaturedOrder(nextOrder)
        setAppProperties((prev) => prev.map((p) => (p.id === id ? saved : p)))
        if (prop) showToast(`${prop.title} removed ⭐`)
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not update featured property')
      }
    },
    [appProperties, featuredOrder, savePropertyCurationConfig, showToast, upcomingOrder],
  )

  const deactivateBoostOrder = useCallback(
    async (order: BoostOrder) => {
      if (
        !window.confirm(
          `Deactivate boost for ${order.property}? This removes the property from featured listings.`,
        )
      ) {
        return
      }
      const session = readAdminSession()
      if (!session?.accessToken) {
        showToast('Sign in again to deactivate boost orders')
        return
      }
      setBoostOrderActionId(order.id)
      try {
        const nextOrder = featuredOrder.filter((id) => id !== order.propertyId)
        const saved = await updateAdminProperty(session.accessToken, order.propertyId, {
          isFeatured: false,
        })
        await savePropertyCurationConfig(nextOrder, upcomingOrder)
        setFeaturedOrder(nextOrder)
        setAppProperties((prev) =>
          prev.map((property) => (property.id === order.propertyId ? saved : property)),
        )
        setArchivedBoostOrders((prev) => [
          ...prev.filter((item) => item.propertyId !== order.propertyId),
          { ...order, status: 'expired', daysLeft: 0 },
        ])
        showToast(`Boost deactivated for ${order.property}`)
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not deactivate boost')
      } finally {
        setBoostOrderActionId(null)
      }
    },
    [featuredOrder, savePropertyCurationConfig, showToast, upcomingOrder],
  )

  const addToFeatured = useCallback(
    async (id: string) => {
      if (featuredOrder.length >= 20) {
        showToast('Maximum 20 featured properties. Remove some before adding more.')
        return
      }
      const prop = appProperties.find((p) => p.id === id)
      if (!prop) return
      const nextOrder = [...featuredOrder.filter((x) => x !== id), id]
      const session = readAdminSession()
      if (!session?.accessToken) return showToast('Sign in again to update featured properties')
      try {
        const saved = await updateAdminProperty(session.accessToken, id, { isFeatured: true })
        await savePropertyCurationConfig(nextOrder, upcomingOrder)
        setFeaturedOrder(nextOrder)
        setAppProperties((prev) => prev.map((p) => (p.id === id ? saved : p)))
        setFeaturedAddSearch('')
        showToast('Added to Featured ⭐')
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not update featured property')
      }
    },
    [appProperties, featuredOrder, savePropertyCurationConfig, showToast, upcomingOrder],
  )

  const moveFeatured = useCallback(
    async (id: string, direction: 'up' | 'down') => {
      const idx = featuredOrder.indexOf(id)
      if (idx < 0) return
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= featuredOrder.length) return
      const next = [...featuredOrder]
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      try {
        await savePropertyCurationConfig(next, upcomingOrder)
        setFeaturedOrder(next)
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not save featured order')
      }
    },
    [featuredOrder, savePropertyCurationConfig, showToast, upcomingOrder],
  )

  const handleFeaturedDrop = useCallback(
    async (dropIndex: number) => {
      if (featuredDragIndex == null || featuredDragIndex === dropIndex) return
      const next = [...featuredOrder]
      const [removed] = next.splice(featuredDragIndex, 1)
      next.splice(dropIndex, 0, removed)
      try {
        await savePropertyCurationConfig(next, upcomingOrder)
        setFeaturedOrder(next)
        setFeaturedDragIndex(null)
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not save featured order')
      }
    },
    [featuredDragIndex, featuredOrder, savePropertyCurationConfig, showToast, upcomingOrder],
  )

  const removeFromUpcoming = useCallback(
    async (id: string) => {
      const prop = appProperties.find((p) => p.id === id)
      const nextOrder = upcomingOrder.filter((e) => e.id !== id)
      const session = readAdminSession()
      if (!session?.accessToken) return showToast('Sign in again to update upcoming properties')
      try {
        const saved = await updateAdminProperty(session.accessToken, id, {
          isUpcoming: false,
          launchDate: null,
        })
        await savePropertyCurationConfig(featuredOrder, nextOrder)
        setUpcomingOrder(nextOrder)
        setAppProperties((prev) => prev.map((p) => (p.id === id ? saved : p)))
        if (prop) showToast(`${prop.title} removed from Upcoming`)
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not update upcoming property')
      }
    },
    [appProperties, featuredOrder, savePropertyCurationConfig, showToast, upcomingOrder],
  )

  const updateUpcomingLaunchDate = useCallback(
    async (id: string, launchDate: string | null) => {
      const nextOrder = upcomingOrder.map((e) =>
        e.id === id ? { ...e, launchDate: launchDate || null } : e,
      )
      const session = readAdminSession()
      if (!session?.accessToken) return showToast('Sign in again to update launch date')
      try {
        const saved = await updateAdminProperty(session.accessToken, id, {
          isUpcoming: true,
          launchDate: launchDate || null,
        })
        await savePropertyCurationConfig(featuredOrder, nextOrder)
        setUpcomingOrder(nextOrder)
        setAppProperties((prev) => prev.map((p) => (p.id === id ? saved : p)))
        showToast('Launch date updated')
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not update launch date')
      }
    },
    [featuredOrder, savePropertyCurationConfig, showToast, upcomingOrder],
  )

  const moveUpcomingToAvailable = useCallback(
    async (id: string) => {
      const nextOrder = upcomingOrder.filter((e) => e.id !== id)
      const session = readAdminSession()
      if (!session?.accessToken) return showToast('Sign in again to update upcoming properties')
      try {
        const saved = await updateAdminProperty(session.accessToken, id, {
          isUpcoming: false,
          launchDate: null,
        })
        await savePropertyCurationConfig(featuredOrder, nextOrder)
        setUpcomingOrder(nextOrder)
        setAppProperties((prev) => prev.map((p) => (p.id === id ? saved : p)))
        showToast('Moved to Available')
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not update upcoming property')
      }
    },
    [featuredOrder, savePropertyCurationConfig, showToast, upcomingOrder],
  )

  const confirmAddToUpcoming = useCallback(async () => {
    if (!upcomingAddSelectedId) return
    if (upcomingOrder.some((e) => e.id === upcomingAddSelectedId)) {
      showToast('Already in list')
      return
    }
    if (!upcomingAddLaunchDate) {
      setUpcomingAddDateError(true)
      showToast('Launch date required')
      return
    }
    if (isLaunchDatePast(upcomingAddLaunchDate)) {
      setUpcomingAddDateError(true)
      showToast('Launch date must be in the future')
      return
    }
    const prop = appProperties.find((p) => p.id === upcomingAddSelectedId)
    if (!prop) return
    const isoDate = new Date(upcomingAddLaunchDate).toISOString()
    const nextOrder = [
      { id: upcomingAddSelectedId, launchDate: isoDate },
      ...upcomingOrder.filter((e) => e.id !== upcomingAddSelectedId),
    ]
    const session = readAdminSession()
    if (!session?.accessToken) return showToast('Sign in again to update upcoming properties')
    try {
      const saved = await updateAdminProperty(session.accessToken, upcomingAddSelectedId, {
        isUpcoming: true,
        launchDate: isoDate,
      })
      await savePropertyCurationConfig(featuredOrder, nextOrder)
      setUpcomingOrder(nextOrder)
      setAppProperties((prev) =>
        prev.map((p) => (p.id === upcomingAddSelectedId ? saved : p)),
      )
      setUpcomingAddOpen(false)
      setUpcomingAddSearch('')
      setUpcomingAddSelectedId(null)
      setUpcomingAddLaunchDate('')
      setUpcomingAddDateError(false)
      showToast(`${prop.title} added to Upcoming 🚀`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update upcoming property')
    }
  }, [
    upcomingAddSelectedId,
    upcomingAddLaunchDate,
    appProperties,
    featuredOrder,
    savePropertyCurationConfig,
    upcomingOrder,
    showToast,
  ])

  useEffect(() => {
    setHomeBanners((prev) =>
      prev.map((b) => {
        if (isHomeBannerExpired(b) && b.isActive) {
          return { ...b, isActive: false }
        }
        return b
      }),
    )
  }, [])

  useEffect(() => {
    if (bannerDraft.navigateTo !== 'property' || bannerDraft.propertyId) return
    if (selectableProperties.length !== 1) return
    const only = selectableProperties[0]
    setBannerDraft((d) => ({
      ...d,
      propertyId: only.id,
      propertyTitle: only.title,
    }))
  }, [bannerDraft.navigateTo, bannerDraft.propertyId, selectableProperties])

  useEffect(() => {
    const soldFeatured = appProperties.filter((p) => p.isFeatured && p.status === 'sold')
    if (soldFeatured.length === 0) return
    const soldIds = new Set(soldFeatured.map((p) => p.id))
    const nextFeaturedOrder = featuredOrder.filter((id) => !soldIds.has(id))
    const session = readAdminSession()
    if (!session?.accessToken) return
    Promise.all(
      soldFeatured.map((property) =>
        updateAdminProperty(session.accessToken, property.id, { isFeatured: false }),
      ),
    )
      .then(async (savedProperties) => {
        await savePropertyCurationConfig(nextFeaturedOrder, upcomingOrder)
        const savedById = new Map(savedProperties.map((property) => [property.id, property]))
        setFeaturedOrder(nextFeaturedOrder)
        setAppProperties((prev) =>
          prev.map((p) => savedById.get(p.id) ?? p),
        )
        showToast('Sold property auto-removed from Featured')
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : 'Could not auto-remove sold featured property')
      })
  }, [appProperties, featuredOrder, savePropertyCurationConfig, showToast, upcomingOrder])

  useEffect(() => {
    if (upcomingProperties.length === 0) {
      setUpcomingAddOpen(true)
    }
  }, [upcomingProperties.length])

  const handleUndoImport = async (entry: ImportHistoryEntry) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to undo imports')
      return
    }
    try {
      const result = await undoAdminPropertyImportJob(session.accessToken, entry.id)
      const job = result.job
      if (job) {
        const updatedEntry = importJobToHistory(job)
        setImportHistory((prev) =>
          prev.map((item) => (item.id === entry.id ? updatedEntry : item)),
        )
        setImportErrors((prev) => [
          ...prev.filter((error) => !error.id.startsWith(`${entry.id}-`)),
          ...importJobsToErrors([job]),
        ])
      }
      const properties = await listAdminProperties(session.accessToken, { limit: 100, sort: 'newest' })
      const catalog = initPropertyCatalog(properties.data)
      setAppProperties(catalog.properties)
      setFeaturedOrder(catalog.featuredOrder)
      setUpcomingOrder(catalog.upcomingOrder)
      setUndoConfirmId(null)
      setExpandedImportId(null)
      showToast(`Import undone. ${result.revertedCount} properties removed.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not undo import')
    }
  }

  const addDesigner = async () => {
    if (!designerDraft.name.trim() || !designerDraft.email.trim()) {
      showToast('Name and email required')
      return
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to add designer')
      return
    }
    try {
      const saved = await inviteAdminOperator(session.accessToken, {
        name: designerDraft.name.trim(),
        phone: designerDraft.phone.trim(),
        email: designerDraft.email.trim(),
        role: 'designer',
        assignedArea: designerDraft.specialization,
        specialization: designerDraft.specialization,
        isAvailable: true,
      })
      setDesigners((prev) => [adminOperatorToDesigner(saved), ...prev])
      setDesignerDraft({ name: '', phone: '', email: '', specialization: [] })
      setDesignerFormOpen(false)
      showToast('Designer added')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add designer')
    }
  }

  const toggleDesignerAvailability = async (designer: Designer) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to update designer')
      return
    }
    const nextAvailability = !designer.isAvailable
    setDesigners((prev) =>
      prev.map((d) => (d.id === designer.id ? { ...d, isAvailable: nextAvailability } : d)),
    )
    try {
      const saved = await updateAdminOperator(session.accessToken, designer.id, {
        isAvailable: nextAvailability,
      })
      setDesigners((prev) =>
        prev.map((d) => (d.id === designer.id ? { ...d, ...adminOperatorToDesigner(saved) } : d)),
      )
      showToast(`${designer.name} marked ${nextAvailability ? 'available' : 'busy'}`)
    } catch (error) {
      setDesigners((prev) =>
        prev.map((d) => (d.id === designer.id ? { ...d, isAvailable: designer.isAvailable } : d)),
      )
      showToast(error instanceof Error ? error.message : 'Could not update designer')
    }
  }

  const removeDesigner = async (designer: Designer) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to remove designer')
      return
    }
    try {
      await removeAdminOperator(session.accessToken, designer.id)
      setDesigners((prev) => prev.filter((d) => d.id !== designer.id))
      showToast(`${designer.name} removed`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove designer')
    }
  }

  const testBannerImage = (url: string, bannerId?: string) => {
    if (!url.trim()) {
      setBannerImageTest('error')
      return
    }
    const img = new Image()
    img.onload = () => {
      setBannerImageTest('ok')
      if (bannerId) {
        setBannerImageTests((prev) => ({ ...prev, [bannerId]: 'ok' }))
      }
    }
    img.onerror = () => {
      setBannerImageTest('error')
      if (bannerId) {
        setBannerImageTests((prev) => ({ ...prev, [bannerId]: 'error' }))
      }
    }
    img.src = url.trim()
  }

  const saveHomeBanner = () => {
    if (!bannerDraft.title.trim()) {
      showToast('Banner title is required')
      return
    }
    if (bannerDraft.title.length > 40) {
      showToast('Title max 40 characters')
      return
    }
    if (bannerDraft.navigateTo === 'property' && !bannerDraft.propertyId) {
      showToast('Select a property')
      return
    }
    if (bannerDraft.navigateTo === 'url') {
      if (!bannerDraft.externalUrl?.trim()) {
        showToast('Enter a valid HTTPS URL')
        return
      }
      if (!isValidExternalUrl(bannerDraft.externalUrl)) {
        showToast('URL must start with https://')
        return
      }
    }
    if (bannerDraft.useImage && bannerDraft.imageUrl.trim() && bannerImageTest === 'error') {
      showToast('Fix image URL before saving')
      return
    }

    const payload: HomeBanner = {
      id: editingBannerId ?? `b${Date.now()}`,
      title: bannerDraft.title.trim(),
      subtitle: bannerDraft.subtitle.trim().slice(0, 60),
      imageUrl: bannerDraft.imageUrl.trim(),
      useImage: bannerDraft.useImage,
      bgColor: bannerDraft.bgColor,
      textColor: bannerDraft.textColor,
      ctaText: bannerDraft.ctaText.trim().slice(0, 20),
      ctaColor: bannerDraft.ctaColor,
      navigateTo: bannerDraft.navigateTo,
      propertyId: bannerDraft.propertyId,
      propertyTitle: bannerDraft.propertyTitle,
      sectionLinkMode:
        bannerDraft.navigateTo === 'featured' || bannerDraft.navigateTo === 'upcoming'
          ? (bannerDraft.sectionLinkMode ?? 'scroll')
          : null,
      buyPrefilterType: bannerDraft.buyPrefilterType,
      sellPrefilterType:
        bannerDraft.navigateTo === 'sell' ? (bannerDraft.sellPrefilterType ?? 'all') : null,
      externalUrl:
        bannerDraft.navigateTo === 'url'
          ? normalizeExternalUrl(bannerDraft.externalUrl ?? '')
          : null,
      startDate: bannerDraft.startDate,
      expiryDate: bannerDraft.expiryDate,
      isActive: bannerDraft.isActive,
      order: editingBannerId
        ? (homeBanners.find((b) => b.id === editingBannerId)?.order ?? homeBanners.length + 1)
        : homeBanners.length + 1,
    }

    if (editingBannerId) {
      setHomeBanners((prev) =>
        prev.map((b) => (b.id === editingBannerId ? { ...b, ...payload, id: editingBannerId } : b)),
      )
    } else {
      setHomeBanners((prev) => [...prev, payload])
    }
    setBannerFormOpen(false)
    setEditingBannerId(null)
    resetBannerDraft()
    showToast('Banner saved')
  }

  const saveAllHomeBanners = async () => {
    const ordered = [...homeBanners]
      .sort((a, b) => a.order - b.order)
      .map((b, i) => ({ ...b, order: i + 1 }))
    try {
      await upsertToolsContentConfig({
        slug: HOME_SCREEN_BANNERS_CONTENT_SLUG,
        section: 'banner',
        title: 'Home Screen Banners',
        excerpt: 'App home carousel banner configuration',
        category: 'home-banners',
        metadata: { banners: ordered },
      })
      setHomeBanners(ordered)
      showToast('Banners saved to app home carousel')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save home banners')
    }
  }

  const handleBannerDrop = (dropIndex: number) => {
    if (bannerDragIndex == null || bannerDragIndex === dropIndex) return
    const list = [...sortedHomeBanners]
    const [removed] = list.splice(bannerDragIndex, 1)
    list.splice(dropIndex, 0, removed)
    const updated = list.map((b, i) => ({ ...b, order: i + 1 }))
    setHomeBanners(updated)
    setBannerDragIndex(null)
  }

  const handleSectionDrop = (dropIndex: number) => {
    if (sectionDragIndex == null || sectionDragIndex === dropIndex) return
    const list = [...sortedSections]
    const dragged = list[sectionDragIndex]
    if (!dragged.canDisable) return
    const [removed] = list.splice(sectionDragIndex, 1)
    list.splice(dropIndex, 0, removed)
    const updated = list.map((s, i) => ({ ...s, order: i + 1 }))
    setSections(updated)
    setSectionDragIndex(null)
  }

  const homeBannerToDraft = (banner: HomeBanner): HomeBannerDraft => ({
    title: banner.title,
    subtitle: banner.subtitle,
    imageUrl: banner.imageUrl,
    useImage: banner.useImage,
    bgColor: banner.bgColor,
    textColor: banner.textColor,
    ctaText: banner.ctaText,
    ctaColor: banner.ctaColor,
    navigateTo: banner.navigateTo,
    propertyId: banner.propertyId,
    propertyTitle: banner.propertyTitle,
    sectionLinkMode: banner.sectionLinkMode,
    buyPrefilterType: banner.buyPrefilterType,
    sellPrefilterType: banner.sellPrefilterType,
    externalUrl: banner.externalUrl,
    startDate: banner.startDate,
    expiryDate: banner.expiryDate,
    isActive: banner.isActive,
  })

  const sortedOnboardingSlides = useMemo(
    () => [...onboardingSlides].sort((a, b) => a.order - b.order),
    [onboardingSlides],
  )

  const onboardingPreviewSlide = useMemo(
    () => sortedOnboardingSlides.find((s) => s.isActive) ?? sortedOnboardingSlides[0],
    [sortedOnboardingSlides],
  )

  const updateOnboardingSlide = (id: string, patch: Partial<OnboardingSlide>) => {
    setOnboardingSlides((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    )
  }

  const moveOnboardingSlide = (id: string, direction: 'up' | 'down') => {
    const list = [...sortedOnboardingSlides]
    const idx = list.findIndex((s) => s.id === id)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= list.length) return
    ;[list[idx], list[swapIdx]] = [list[swapIdx], list[idx]]
    setOnboardingSlides(list.map((s, i) => ({ ...s, order: i + 1 })))
  }

  const handleOnboardingSlideDrop = (dropIndex: number) => {
    if (onboardingSlideDragIndex == null || onboardingSlideDragIndex === dropIndex) return
    const list = [...sortedOnboardingSlides]
    const [removed] = list.splice(onboardingSlideDragIndex, 1)
    list.splice(dropIndex, 0, removed)
    setOnboardingSlides(list.map((s, i) => ({ ...s, order: i + 1 })))
    setOnboardingSlideDragIndex(null)
  }

  const deleteOnboardingSlide = (id: string) => {
    if (onboardingSlides.length <= 1) {
      showToast('Must have at least 1 slide')
      return
    }
    if (!window.confirm('Delete slide?')) return
    const next = onboardingSlides
      .filter((s) => s.id !== id)
      .map((s, i) => ({ ...s, order: i + 1 }))
    setOnboardingSlides(next)
    showToast('Slide removed')
  }

  const addOnboardingSlide = () => {
    if (!onboardingSlideAddDraft.title.trim() || !onboardingSlideAddDraft.description.trim()) {
      showToast('Title and description are required')
      return
    }
    if (onboardingSlides.length >= 6) {
      showToast('Maximum 6 slides allowed')
      return
    }
    const slide: OnboardingSlide = {
      id: `slide-${Date.now()}`,
      order: onboardingSlides.length + 1,
      title: onboardingSlideAddDraft.title.trim().slice(0, 50),
      description: onboardingSlideAddDraft.description.trim().slice(0, 120),
      imageUrl: onboardingSlideAddDraft.imageUrl.trim(),
      isActive: true,
    }
    setOnboardingSlides((prev) => [...prev, slide])
    setOnboardingSlideAddDraft({ title: '', description: '', imageUrl: '' })
    setOnboardingSlideAddOpen(false)
    showToast('Slide added')
  }

  const saveOnboardingSlides = async () => {
    if (sortedOnboardingSlides.length < 2) {
      showToast('Minimum 2 slides required')
      return
    }
    if (!sortedOnboardingSlides.some((s) => s.isActive)) {
      showToast('No active slides. At least 1 must be active.')
      return
    }
    try {
      await upsertToolsContentConfig({
        slug: ONBOARDING_SLIDES_CONTENT_SLUG,
        section: 'onboarding',
        title: 'Onboarding Slides',
        excerpt: 'Customer app onboarding slide sequence',
        category: 'onboarding',
        metadata: { slides: sortedOnboardingSlides },
      })
      showToast('Onboarding slides saved')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save onboarding slides')
    }
  }

  const cancelScheduledNotification = async (id: string) => {
    const next = scheduledNotifications.filter((n) => n.id !== id)
    try {
      await upsertToolsContentConfig({
        slug: SCHEDULED_NOTIFICATIONS_CONTENT_SLUG,
        section: 'general',
        title: 'Scheduled Push Notifications',
        excerpt: 'Pending scheduled push notifications from Tools',
        category: 'push-schedule',
        metadata: { notifications: next },
      })
      setScheduledNotifications(next)
      showToast('Scheduled notification cancelled')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not cancel scheduled notification')
    }
  }

  const saveFaq = async () => {
    if (!faqDraft.question.trim() || !faqDraft.answer.trim()) {
      showToast('Question and answer required')
      return
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to save FAQ content')
      return
    }
    const payload = {
      section: 'faq' as const,
      title: faqDraft.question.trim(),
      body: faqDraft.answer.trim(),
      category: categoryToCms(faqDraft.category),
      status: 'published' as const,
      metadata: { topicLabel: faqDraft.category },
    }
    try {
      if (editingFaqId && editingFaqId !== 'new') {
        const saved = await updateAdminContent(session.accessToken, editingFaqId, payload)
        setContentItems((prev) => prev.map((item) => (contentId(item) === editingFaqId ? saved : item)))
        setFaqs((prev) =>
          prev.map((f) =>
            f.id === editingFaqId
              ? { ...f, question: faqDraft.question, answer: faqDraft.answer, category: faqDraft.category }
              : f,
          ),
        )
      } else {
        const saved = await createAdminContent(session.accessToken, payload)
        setContentItems((prev) => [saved, ...prev])
        setFaqs((prev) => [...prev, toFaqItem(saved)])
      }
      setEditingFaqId(null)
      setFaqDraft({ question: '', answer: '', category: 'General' })
      showToast('FAQ saved to CMS')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save FAQ')
    }
  }

  const sendPush = () => {
    const session = readAdminSession()
    if (!pushTitle.trim() || !pushMessage.trim()) {
      showToast('Title and message required')
      return
    }
    if (pushMessage.length > 100) {
      showToast('Message must be 100 characters or less')
      return
    }
    if (pushScheduleLater) {
      if (!pushScheduleAt) {
        showToast('Select a schedule date and time')
        return
      }
      const scheduled = new Date(pushScheduleAt)
      if (scheduled < new Date()) {
        showToast('Cannot schedule in the past')
        return
      }
      const entry: ScheduledNotification = {
        id: `SCHED-${Date.now()}`,
        title: pushTitle.trim(),
        body: pushMessage.trim(),
        target: pushAudienceLabel,
        scheduledAt: scheduled.toISOString(),
        status: 'scheduled',
        createdBy: session?.admin?.name || session?.admin?.email || 'Current Admin',
        createdAt: new Date().toISOString(),
      }
      const next = [entry, ...scheduledNotifications]
      upsertToolsContentConfig({
        slug: SCHEDULED_NOTIFICATIONS_CONTENT_SLUG,
        section: 'general',
        title: 'Scheduled Push Notifications',
        excerpt: 'Pending scheduled push notifications from Tools',
        category: 'push-schedule',
        metadata: { notifications: next },
      })
        .then(() => {
          setScheduledNotifications(next)
          setPushConfirmOpen(false)
          setPushTitle('')
          setPushMessage('')
          setPushScheduleAt('')
          setPushScheduleLater(false)
          showToast(
            `Notification scheduled for ${scheduled.toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}`,
          )
        })
        .catch((error) => {
          showToast(error instanceof Error ? error.message : 'Could not schedule notification')
        })
      return
    }
    setPushHistory((prev) => [
      {
        id: `p${Date.now()}`,
        title: pushTitle,
        audience: pushAudienceLabel,
        sentAt: new Date().toISOString(),
        status: 'Sent' as const,
      },
      ...prev,
    ].slice(0, 5))
    setPushConfirmOpen(false)
    setPushTitle('')
    setPushMessage('')
    showToast('Notification sent')
  }

  const saveCity = () => {
    if (!cityDraft.city.trim()) return
    if (editingCityId) {
      setCities((prev) =>
        prev.map((c) =>
          c.id === editingCityId ? { ...c, ...cityDraft } : c,
        ),
      )
    } else {
      setCities((prev) => [
        ...prev,
        {
          id: `c${Date.now()}`,
          city: cityDraft.city,
          state: cityDraft.state,
          propertiesCount: 0,
          active: cityDraft.active,
        },
      ])
    }
    setCityFormOpen(false)
    setEditingCityId(null)
    showToast('City saved')
  }

  const deleteCity = (row: CityRow) => {
    const count =
      locationCounts.cityCounts[row.city.trim().toLowerCase()] ?? row.propertiesCount
    if (count > 0) {
      window.alert(`${count} properties in this city — remove or reassign first`)
      return
    }
    setCities((prev) => prev.filter((c) => c.id !== row.id))
    setLocalities((prev) => prev.filter((l) => l.city !== row.city))
    showToast('City deleted')
  }

  const saveLocality = () => {
    if (!localityDraft.locality.trim()) return
    if (editingLocalityId) {
      setLocalities((prev) =>
        prev.map((l) =>
          l.id === editingLocalityId
            ? { ...l, locality: localityDraft.locality, city: localityDraft.city, active: localityDraft.active }
            : l,
        ),
      )
    } else {
      setLocalities((prev) => [
        ...prev,
        {
          id: `l${Date.now()}`,
          locality: localityDraft.locality,
          city: localityDraft.city,
          propertiesCount: 0,
          active: localityDraft.active,
        },
      ])
    }
    setLocalityFormOpen(false)
    setEditingLocalityId(null)
    showToast('Locality saved')
  }

  const deleteLocality = (row: LocalityRow) => {
    const count =
      locationCounts.localityCounts[
        `${row.city.trim().toLowerCase()}|${row.locality.trim().toLowerCase()}`
      ] ?? row.propertiesCount
    if (count > 0) {
      window.alert(`${count} properties in this locality — remove or reassign first`)
      return
    }
    setLocalities((prev) => prev.filter((x) => x.id !== row.id))
    showToast('Locality deleted')
  }

  const saveZone = () => {
    if (!zoneDraft.name.trim() || !zoneDraft.city.trim()) return
    if (editingZoneId) {
      setZones((prev) =>
        prev.map((zone) =>
          zone.id === editingZoneId
            ? { ...zone, ...zoneDraft, name: zoneDraft.name.trim(), city: zoneDraft.city.trim() }
            : zone,
        ),
      )
    } else {
      setZones((prev) => [
        ...prev,
        {
          id: `z${Date.now()}`,
          name: zoneDraft.name.trim(),
          city: zoneDraft.city.trim(),
          coordinates: zoneDraft.coordinates.trim(),
          active: zoneDraft.active,
        },
      ])
    }
    setZoneFormOpen(false)
    setEditingZoneId(null)
    showToast('Map zone saved')
  }

  const deleteZone = (row: MapZone) => {
    setZones((prev) => prev.filter((zone) => zone.id !== row.id))
    showToast('Map zone deleted')
  }

  const createCoupon = () => {
    const code = couponDraft.code.toUpperCase()
    if (!code) return
    if (coupons.some((c) => c.code === code)) {
      showToast('Code already in use')
      return
    }
    setCoupons((prev) => [
      ...prev,
      {
        id: `cp${Date.now()}`,
        code,
        discount:
          couponDraft.discountType === '%'
            ? `${couponDraft.discountValue}%`
            : `₹${couponDraft.discountValue}`,
        type: couponDraft.discountType === '%' ? '% discount' : 'Flat discount',
        appliesTo: couponDraft.appliesTo,
        uses: `0/${couponDraft.maxUses || '100'} uses`,
        expiry: couponDraft.expiry || '—',
        active: couponDraft.active,
      },
    ])
    setCouponFormOpen(false)
    showToast('Coupon created')
  }

  const resetTemplateDraft = () => {
    setTemplateDraft({
      name: '',
      category: 'General',
      subject: '',
      body: '',
    })
  }

  const startCreateTemplate = () => {
    setEditingTemplateId(null)
    setDeleteTemplateId(null)
    resetTemplateDraft()
    setCreatingTemplate(true)
  }

  const startEditTemplate = (template: MessageTemplate) => {
    setCreatingTemplate(false)
    setDeleteTemplateId(null)
    setEditingTemplateId(template.id)
    setTemplateDraft({
      name: template.name,
      category: template.category,
      subject: template.subject ?? '',
      body: template.body,
    })
  }

  const cancelTemplateEdit = () => {
    setCreatingTemplate(false)
    setEditingTemplateId(null)
    resetTemplateDraft()
  }

  const saveTemplate = async () => {
    if (!templateDraft.name.trim()) {
      showToast('Template name cannot be empty')
      return
    }
    if (!templateDraft.body.trim()) {
      showToast('Template body cannot be empty')
      return
    }
    const cleanTemplate = {
      name: templateDraft.name.trim(),
      channel: templateChannel,
      category: templateDraft.category.trim() || 'General',
      subject:
        templateChannel === 'email' && templateDraft.subject.trim()
          ? templateDraft.subject.trim()
          : undefined,
      body: templateDraft.body.trim(),
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to save template')
      return
    }

    try {
      if (creatingTemplate) {
        const saved = await createAdminMessageTemplate(session.accessToken, cleanTemplate)
        setTemplates((prev) => [saved, ...prev])
        setCreatingTemplate(false)
        resetTemplateDraft()
        showToast('Template created')
        return
      }

      if (!editingTemplateId) return

      const saved = await updateAdminMessageTemplate(session.accessToken, editingTemplateId, cleanTemplate)
      setTemplates((prev) => [
        ...prev.map((t) => (t.id === editingTemplateId ? saved : t)),
      ])
      setEditingTemplateId(null)
      resetTemplateDraft()
      showToast('Template saved')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save template')
    }
  }

  const confirmDeleteTemplate = async () => {
    if (!deleteTemplateId) return
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to delete template')
      return
    }
    try {
      await deleteAdminMessageTemplate(session.accessToken, deleteTemplateId)
      setTemplates((prev) => prev.filter((t) => t.id !== deleteTemplateId))
      if (editingTemplateId === deleteTemplateId) {
        setEditingTemplateId(null)
        resetTemplateDraft()
      }
      setDeleteTemplateId(null)
      showToast('Template deleted')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not delete template')
    }
  }

  const duplicateTemplate = async (template: MessageTemplate) => {
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to duplicate template')
      return
    }
    try {
      const saved = await createAdminMessageTemplate(session.accessToken, {
        name: `${template.name} (copy)`,
        channel: template.channel,
        category: template.category,
        subject: template.subject,
        body: template.body,
      })
      setTemplates((prev) => [saved, ...prev])
      showToast('Template duplicated')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not duplicate template')
    }
  }

  const insertVar = (v: string, target: 'template' | 'bulk') => {
    if (target === 'template') {
      setTemplateDraft((d) => ({ ...d, body: d.body + v }))
    } else {
      setBulkBody((b) => b + v)
    }
  }

  const saveTerms = async () => {
    if (!termsContent.trim()) {
      showToast('Content cannot be empty')
      return
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to save terms')
      return
    }
    const lastUpdatedLabel = new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    const existing = contentItems.find((item) => item.slug === 'terms-of-service')
    const payload = {
      slug: 'terms-of-service',
      section: 'legal' as const,
      title: 'Builtglory Marketplace Agreement',
      excerpt: 'Terms of Service',
      body: termsContent.trim(),
      category: 'terms',
      status: 'published' as const,
      metadata: { lastUpdatedLabel },
    }
    try {
      const saved = existing
        ? await updateAdminContent(session.accessToken, contentId(existing), payload)
        : await createAdminContent(session.accessToken, payload)
      setContentItems((prev) => existing ? prev.map((item) => (contentId(item) === contentId(existing) ? saved : item)) : [saved, ...prev])
      setTermsLastUpdated(lastUpdatedLabel)
      showToast('Terms & Conditions saved to CMS')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save terms')
    }
  }

  const savePrivacy = async () => {
    if (!privacyContent.trim()) {
      showToast('Content cannot be empty')
      return
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to save privacy policy')
      return
    }
    const lastUpdatedLabel = new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    const existing = contentItems.find((item) => item.slug === 'privacy-policy')
    const payload = {
      slug: 'privacy-policy',
      section: 'legal' as const,
      title: 'Privacy Policy',
      excerpt: 'How we use and protect your data',
      body: privacyContent.trim(),
      category: 'privacy',
      status: 'published' as const,
      metadata: { lastUpdatedLabel },
    }
    try {
      const saved = existing
        ? await updateAdminContent(session.accessToken, contentId(existing), payload)
        : await createAdminContent(session.accessToken, payload)
      setContentItems((prev) => existing ? prev.map((item) => (contentId(item) === contentId(existing) ? saved : item)) : [saved, ...prev])
      setPrivacyLastUpdated(lastUpdatedLabel)
      showToast('Privacy Policy saved to CMS')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save privacy policy')
    }
  }

  const saveAboutInfo = async () => {
    if (!VERSION_REGEX.test(aboutApp.appVersion.trim())) {
      showToast('Use format: X.X.X (e.g. 1.0.0)')
      return
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to save about content')
      return
    }
    const existing = contentItems.find((item) => item.slug === 'about-builtglory')
    const payload = {
      slug: 'about-builtglory',
      section: 'about' as const,
      title: `About ${aboutApp.companyName.trim() || 'Builtglory'}`,
      excerpt: "India's verified real estate marketplace",
      body: aboutApp.appDescription.trim(),
      status: 'published' as const,
      metadata: {
        version: aboutApp.appVersion.trim(),
        buildNumber: aboutApp.buildNumber.trim(),
        releaseDate: aboutApp.releaseDate,
        companyName: aboutApp.companyName,
        companyWebsite: aboutApp.companyWebsite,
        supportEmail: aboutApp.supportEmail,
        supportPhone: aboutApp.supportPhone,
        instagram: aboutApp.instagram,
        linkedin: aboutApp.linkedin,
        twitter: aboutApp.twitter,
        whatsapp: aboutApp.whatsapp,
      },
    }
    try {
      const saved = existing
        ? await updateAdminContent(session.accessToken, contentId(existing), payload)
        : await createAdminContent(session.accessToken, payload)
      setContentItems((prev) => existing ? prev.map((item) => (contentId(item) === contentId(existing) ? saved : item)) : [saved, ...prev])
      showToast('About page saved to CMS')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save about content')
    }
  }

  const saveForceUpdateSettings = async () => {
    if (forceUpdateEnabled && !forceUpdateMinVersion.trim()) {
      showToast('Set minimum version first')
      return
    }
    if (forceUpdateMinVersion.trim() && !VERSION_REGEX.test(forceUpdateMinVersion.trim())) {
      showToast('Use format: X.X.X (e.g. 1.0.0)')
      return
    }
    try {
      await upsertToolsContentConfig({
        slug: FORCE_UPDATE_CONTENT_SLUG,
        section: 'general',
        title: 'App Force Update Settings',
        excerpt: 'Minimum supported app version and force-update toggle',
        category: 'app-config',
        metadata: {
          forceUpdate: {
            enabled: forceUpdateEnabled,
            minVersion: forceUpdateMinVersion.trim(),
          },
        },
      })
      showToast('Force update settings saved to CMS')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save force update settings')
    }
  }

  const sortedPropertyTypes = useMemo(
    () => [...propertyTypes].sort((a, b) => a.order - b.order),
    [propertyTypes],
  )

  const buyVisibleCount = useMemo(
    () => propertyTypes.filter((p) => p.showOnBuy).length,
    [propertyTypes],
  )

  const sellVisibleCount = useMemo(
    () => propertyTypes.filter((p) => p.showOnSell).length,
    [propertyTypes],
  )

  const applyShowOnBuy = (id: string, next: boolean) => {
    setPropertyTypes((prev) =>
      prev.map((p) => (p.id === id ? { ...p, showOnBuy: next, active: next } : p)),
    )
  }

  const applyShowOnSell = (id: string, next: boolean) => {
    setPropertyTypes((prev) =>
      prev.map((p) => (p.id === id ? { ...p, showOnSell: next } : p)),
    )
  }

  const toggleShowOnBuy = (id: string, next: boolean) => {
    const target = propertyTypes.find((p) => p.id === id)
    if (!target) return
    if (!next && buyVisibleCount <= 1) return
    if (next && target.typeName === 'Interior') {
      setVisibilityConfirm({ type: 'interior-buy', id })
      return
    }
    applyShowOnBuy(id, next)
  }

  const toggleShowOnSell = (id: string, next: boolean) => {
    const target = propertyTypes.find((p) => p.id === id)
    if (!target) return
    if (!next && sellVisibleCount <= 1) return
    if (next && target.typeName === 'Fractional Ownership') {
      setVisibilityConfirm({ type: 'fractional-sell', id })
      return
    }
    applyShowOnSell(id, next)
  }

  const confirmVisibilityChange = () => {
    if (!visibilityConfirm) return
    if (visibilityConfirm.type === 'interior-buy') {
      applyShowOnBuy(visibilityConfirm.id, true)
    } else {
      applyShowOnSell(visibilityConfirm.id, true)
    }
    setVisibilityConfirm(null)
  }

  const updatePropertyTypeField = (
    id: string,
    field: 'displayName' | 'order',
    value: string | number,
  ) => {
    setPropertyTypes((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    )
  }

  const movePropertyType = (id: string, direction: 'up' | 'down') => {
    const sorted = [...propertyTypes].sort((a, b) => a.order - b.order)
    const index = sorted.findIndex((p) => p.id === id)
    if (index < 0) return
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= sorted.length) return
    const a = sorted[index]
    const b = sorted[swapIndex]
    setPropertyTypes((prev) =>
      prev.map((p) => {
        if (p.id === a.id) return { ...p, order: b.order }
        if (p.id === b.id) return { ...p, order: a.order }
        return p
      }),
    )
  }

  const savePropertyTypeRow = (id: string) => {
    const row = propertyTypes.find((p) => p.id === id)
    if (!row?.displayName.trim()) {
      showToast('Display name is required')
      return
    }
    showToast(`Saved ${row.typeName}`)
  }

  const saveAllPropertyTypes = async () => {
    if (buyVisibleCount === 0 || sellVisibleCount === 0) return
    const visibility = Object.fromEntries(
      propertyTypes.map((pt) => [
        pt.slug,
        { buy: pt.showOnBuy, sell: pt.showOnSell },
      ]),
    )
    const orderedPropertyTypes = [...propertyTypes].sort((a, b) => a.order - b.order)
    try {
      await upsertToolsContentConfig({
        slug: PROPERTY_TYPE_VISIBILITY_CONTENT_SLUG,
        section: 'general',
        title: 'Property Type Visibility',
        excerpt: 'Buy and sell screen property type visibility settings',
        category: 'property-types',
        metadata: {
          visibility,
          propertyTypes: orderedPropertyTypes,
        },
      })
      setPropertyTypes(orderedPropertyTypes)
      showToast(
        'Property type visibility updated. Changes will reflect in app (B-01 and SL-01)',
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save property type visibility')
    }
  }

  const saveHomeLayout = async () => {
    const ordered = [...sections]
      .sort((a, b) => a.order - b.order)
      .map((s, i) => ({ ...s, order: i + 1 }))
    try {
      await upsertToolsContentConfig({
        slug: HOME_SCREEN_LAYOUT_CONTENT_SLUG,
        section: 'home',
        title: 'Home Screen Section Layout',
        excerpt: 'Customer app home section order and visibility',
        category: 'home-layout',
        metadata: { sections: ordered },
      })
      setSections(ordered)
      showToast('Layout saved. App home screen updated.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save home layout')
    }
  }

  const saveArticle = async () => {
    if (!articleDraft.title.trim() || !articleDraft.content.trim()) {
      showToast('Title and content are required')
      return
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to save article')
      return
    }
    const payload = {
      section: 'news' as const,
      title: articleDraft.title.trim(),
      body: articleDraft.content.trim(),
      category: articleDraft.category,
      imageUrl: articleDraft.imageUrl.trim() || null,
      status: articleDraft.active ? 'published' as const : 'draft' as const,
      metadata: { readTime: '4 min' },
    }
    try {
      if (editingArticleId && editingArticleId !== 'new') {
        const saved = await updateAdminContent(session.accessToken, editingArticleId, payload)
        setContentItems((prev) => prev.map((item) => (contentId(item) === editingArticleId ? saved : item)))
        setNewsArticles((prev) => prev.map((a) => (a.id === editingArticleId ? toNewsArticle(saved) : a)))
        showToast('Article saved to CMS')
      } else {
        const saved = await createAdminContent(session.accessToken, payload)
        setContentItems((prev) => [saved, ...prev])
        setNewsArticles((prev) => [toNewsArticle(saved), ...prev])
        showToast('Article added to CMS')
      }
      setEditingArticleId(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save article')
    }
  }

  const formatArticleDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const sendBulk = async () => {
    if (bulkRecipientCount === 0) return
    if (!bulkBody.trim()) {
      showToast('Message body required')
      return
    }
    if (bulkSchedule === 'later' && bulkScheduleAt) {
      if (new Date(bulkScheduleAt) < new Date()) {
        showToast('Cannot schedule in the past')
        return
      }
    }
    const session = readAdminSession()
    if (!session?.accessToken) {
      showToast('Sign in again to send bulk message')
      return
    }
    try {
      const saved = await sendAdminBulkMessage(session.accessToken, {
        audience: bulkAudience,
        channel: bulkChannel,
        title: bulkTitle.trim() || undefined,
        message: bulkBody.trim(),
        scheduledAt: bulkSchedule === 'later' && bulkScheduleAt ? new Date(bulkScheduleAt).toISOString() : undefined,
      })
      setBulkHistory((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)].slice(0, 20))
      setBulkConfirmOpen(false)
      setBulkBody('')
      setBulkTitle('')
      showToast(`Bulk message queued for ${saved.recipients} recipient${saved.recipients === 1 ? '' : 's'}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not queue bulk message')
    }
  }

  const renderOnboardingSlidesSection = () => (
    <div className="border-t border-border pt-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ImageIcon className="size-5 text-blue-600" />
            <h2 className="text-xl font-semibold">Onboarding Slides</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">📱 App screen: S-02</p>
          <p className="text-sm text-muted-foreground">
            Edit slides shown to new users on first app launch
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOnboardingSlideAddOpen(true)}
        >
          <Plus className="mr-1 size-4" /> Add Slide
        </Button>
      </div>

      {sortedOnboardingSlides.length < 2 && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Minimum 2 slides required
        </div>
      )}
      {!sortedOnboardingSlides.some((s) => s.isActive) && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          No active slides. At least 1 must be active.
        </div>
      )}
      {sortedOnboardingSlides.length > 4 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          More than 4 slides reduces completion rate
        </div>
      )}

      <div className="grid grid-cols-[1fr_300px] gap-6">
        <div className="space-y-3">
          {sortedOnboardingSlides.map((slide, idx) => (
            <div
              key={slide.id}
              draggable
              onDragStart={() => setOnboardingSlideDragIndex(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleOnboardingSlideDrop(idx)}
              className="mb-3 grid grid-cols-[40px_80px_1fr_120px] items-start gap-3 rounded-xl border border-border p-4"
            >
              <GripVertical className="mt-2 size-5 cursor-grab text-muted-foreground" />
              <div className="h-[60px] w-20 overflow-hidden rounded-lg bg-muted">
                {slide.imageUrl && !onboardingSlideImageWarnings[slide.id] ? (
                  <img
                    src={slide.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() =>
                      setOnboardingSlideImageWarnings((prev) => ({
                        ...prev,
                        [slide.id]: true,
                      }))
                    }
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No img
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <input
                  value={slide.title}
                  maxLength={50}
                  onChange={(e) =>
                    updateOnboardingSlide(slide.id, { title: e.target.value })
                  }
                  className="w-full border-0 bg-transparent px-1 text-sm font-semibold focus:rounded focus:border focus:border-border focus:bg-white"
                />
                <textarea
                  value={slide.description}
                  maxLength={120}
                  rows={2}
                  onChange={(e) =>
                    updateOnboardingSlide(slide.id, { description: e.target.value })
                  }
                  className="w-full resize-none border-0 bg-transparent px-1 text-sm text-muted-foreground focus:rounded focus:border focus:border-border focus:bg-white"
                />
                <input
                  value={slide.imageUrl}
                  placeholder="Image URL..."
                  onChange={(e) => {
                    setOnboardingSlideImageWarnings((prev) => {
                      const next = { ...prev }
                      delete next[slide.id]
                      return next
                    })
                    updateOnboardingSlide(slide.id, { imageUrl: e.target.value })
                  }}
                  className="w-full border-0 bg-transparent px-1 text-xs text-muted-foreground focus:rounded focus:border focus:border-border focus:bg-white"
                />
                {onboardingSlideImageWarnings[slide.id] && (
                  <p className="text-xs text-amber-700">Image may not load</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <label className="flex items-center gap-1 text-xs text-blue-700">
                  <input
                    type="checkbox"
                    checked={slide.isActive}
                    onChange={(e) =>
                      updateOnboardingSlide(slide.id, { isActive: e.target.checked })
                    }
                  />
                  Active
                </label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={idx === 0}
                    onClick={() => moveOnboardingSlide(slide.id, 'up')}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={idx === sortedOnboardingSlides.length - 1}
                    onClick={() => moveOnboardingSlide(slide.id, 'down')}
                  >
                    ↓
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs text-destructive"
                  onClick={() => deleteOnboardingSlide(slide.id)}
                >
                  🗑
                </Button>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">First slide = first screen shown</p>

          {onboardingSlideAddOpen && (
            <div className="space-y-2 rounded-lg border border-border p-4">
              <input
                placeholder="Title (required, max 50)"
                maxLength={50}
                value={onboardingSlideAddDraft.title}
                onChange={(e) =>
                  setOnboardingSlideAddDraft((d) => ({ ...d, title: e.target.value }))
                }
                className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              />
              <textarea
                placeholder="Description (required, max 120)"
                maxLength={120}
                rows={2}
                value={onboardingSlideAddDraft.description}
                onChange={(e) =>
                  setOnboardingSlideAddDraft((d) => ({ ...d, description: e.target.value }))
                }
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
              />
              <input
                placeholder="Image URL (optional)"
                value={onboardingSlideAddDraft.imageUrl}
                onChange={(e) =>
                  setOnboardingSlideAddDraft((d) => ({ ...d, imageUrl: e.target.value }))
                }
                className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={addOnboardingSlide}>
                  Add Slide
                </Button>
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline"
                  onClick={() => {
                    setOnboardingSlideAddOpen(false)
                    setOnboardingSlideAddDraft({ title: '', description: '', imageUrl: '' })
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <Button type="button" onClick={saveOnboardingSlides}>
            Save Onboarding Slides
          </Button>
        </div>

        <div className="flex flex-col items-center">
          <div className="w-[280px] overflow-hidden rounded-[40px] border-2 border-gray-800 bg-white shadow-xl">
            <div className="flex h-6 items-center justify-center bg-gray-800">
              <div className="h-4 w-20 rounded-b-xl bg-gray-900" />
            </div>
            <div className="p-4">
              {onboardingPreviewSlide?.imageUrl &&
              !onboardingSlideImageWarnings[onboardingPreviewSlide.id] ? (
                <img
                  src={onboardingPreviewSlide.imageUrl}
                  alt=""
                  className="mb-3 h-32 w-full rounded-lg object-cover"
                />
              ) : (
                <div className="mb-3 flex h-32 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Home className="size-8" />
                </div>
              )}
              <p className="font-semibold">
                {onboardingPreviewSlide?.title || 'Slide title'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {onboardingPreviewSlide?.description || 'Slide description'}
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Preview updates as you edit</p>
        </div>
      </div>
    </div>
  )

  const getContentSectionStatus = (id: AppContentSection) => {
    switch (id) {
      case 'home':
        return `${activeHomeBannerCount} banners · ${buyVisibleCount} buy · ${sellVisibleCount} sell`
      case 'onboarding':
        return `${onboardingSlides.length} slides`
      case 'faq':
        return `${faqs.filter((f) => f.active).length} FAQs`
      case 'terms':
        return termsContent.trim() ? 'Content saved' : 'Empty'
      case 'privacy':
        return privacyContent.trim() ? 'Content saved' : 'Empty'
      case 'about':
        return `v${aboutApp.appVersion}`
      case 'push':
        return `${pushHistory.length} sent · ${scheduledNotifications.length} scheduled`
      default:
        return ''
    }
  }

  const renderAppContentSection = () => {
    switch (contentSection) {
      case 'home':
        return (
          <div className="space-y-6">
            <AppContentSectionHeader
              title="Home Banners"
              screen="H-01"
              description="Manage promotional carousel banners on the app home screen."
            />

            {activeHomeBannerCount === 0 && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                No active banners. Home screen will show no carousel.
              </div>
            )}
            {homeBanners.length > 5 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                More than 5 banners may slow app loading. Consider removing older ones.
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  resetBannerDraft()
                  setBannerFormOpen(true)
                  setEditingBannerId(null)
                }}
              >
                <Plus className="mr-1 size-4" /> Add Banner
              </Button>
            </div>

            {bannerFormOpen && (
              <div className="space-y-4 rounded-lg border border-border p-4">
                <p className="text-sm font-semibold">Section A: Content</p>
                <div>
                  <label className="text-sm">Banner Title *</label>
                  <input
                    value={bannerDraft.title}
                    maxLength={40}
                    onChange={(e) => setBannerDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="e.g. New Launches in HSR!"
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{bannerDraft.title.length}/40</p>
                </div>
                <div>
                  <label className="text-sm">Subtitle / Description</label>
                  <input
                    value={bannerDraft.subtitle}
                    maxLength={60}
                    onChange={(e) => setBannerDraft((d) => ({ ...d, subtitle: e.target.value }))}
                    placeholder="e.g. Starting ₹45L onwards"
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{bannerDraft.subtitle.length}/60</p>
                </div>
                <div>
                  <label className="text-sm">CTA Button Text</label>
                  <input
                    value={bannerDraft.ctaText}
                    maxLength={20}
                    onChange={(e) => setBannerDraft((d) => ({ ...d, ctaText: e.target.value }))}
                    placeholder="e.g. View Properties"
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{bannerDraft.ctaText.length}/20</p>
                </div>

                <p className="text-sm font-semibold">Section B: Design</p>
                <div>
                  <label className="text-sm">Background Color</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {BANNER_BG_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        className={cn(
                          'rounded-md border px-2 py-1 text-xs',
                          bannerDraft.bgColor === preset.value && 'ring-2 ring-primary',
                        )}
                        style={{ backgroundColor: preset.value, color: '#fff' }}
                        onClick={() =>
                          setBannerDraft((d) => ({
                            ...d,
                            bgColor: preset.value,
                            textColor: suggestTextColor(preset.value),
                          }))
                        }
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="color"
                      value={bannerDraft.bgColor}
                      onChange={(e) =>
                        setBannerDraft((d) => ({
                          ...d,
                          bgColor: e.target.value,
                          textColor: suggestTextColor(e.target.value),
                        }))
                      }
                      className="h-9 w-12 cursor-pointer rounded border border-border"
                    />
                    <input
                      value={bannerDraft.bgColor}
                      onChange={(e) =>
                        setBannerDraft((d) => ({
                          ...d,
                          bgColor: e.target.value,
                          textColor: suggestTextColor(e.target.value),
                        }))
                      }
                      className="h-9 flex-1 rounded-md border border-border bg-input px-3 text-sm font-mono"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="font-medium">Text Color:</span>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={bannerDraft.textColor === 'white'}
                      onChange={() => setBannerDraft((d) => ({ ...d, textColor: 'white' }))}
                    />
                    White
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={bannerDraft.textColor === 'dark'}
                      onChange={() => setBannerDraft((d) => ({ ...d, textColor: 'dark' }))}
                    />
                    Dark
                  </label>
                </div>
                <div>
                  <label className="text-sm">CTA Button Color</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {BANNER_CTA_PRESETS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={cn(
                          'size-8 rounded-full border-2',
                          bannerDraft.ctaColor === color && 'border-primary ring-2 ring-primary/30',
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => setBannerDraft((d) => ({ ...d, ctaColor: color }))}
                        aria-label={`CTA color ${color}`}
                      />
                    ))}
                    <input
                      type="color"
                      value={bannerDraft.ctaColor}
                      onChange={(e) => setBannerDraft((d) => ({ ...d, ctaColor: e.target.value }))}
                      className="h-8 w-12 cursor-pointer rounded border border-border"
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium">Live Preview</p>
                  <div
                    className="mx-auto max-w-sm overflow-hidden rounded-2xl border border-border shadow-sm"
                    style={{
                      backgroundColor: bannerDraft.useImage && bannerDraft.imageUrl
                        ? undefined
                        : bannerDraft.bgColor,
                      backgroundImage:
                        bannerDraft.useImage && bannerDraft.imageUrl
                          ? `url(${bannerDraft.imageUrl})`
                          : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  >
                    <div
                      className="min-h-[140px] p-5"
                      style={{
                        backgroundColor:
                          bannerDraft.useImage && bannerDraft.imageUrl
                            ? 'rgba(0,0,0,0.45)'
                            : 'transparent',
                      }}
                    >
                      <p
                        className={cn(
                          'text-lg font-bold',
                          bannerDraft.textColor === 'white' ? 'text-white' : 'text-slate-900',
                        )}
                      >
                        {bannerDraft.title || 'Banner title'}
                      </p>
                      {bannerDraft.subtitle && (
                        <p
                          className={cn(
                            'mt-1 text-sm',
                            bannerDraft.textColor === 'white' ? 'text-white/90' : 'text-slate-700',
                          )}
                        >
                          {bannerDraft.subtitle}
                        </p>
                      )}
                      {bannerDraft.ctaText && (
                        <span
                          className="mt-4 inline-block rounded-md px-3 py-1.5 text-sm font-medium"
                          style={{
                            backgroundColor: bannerDraft.ctaColor,
                            color: suggestTextColor(bannerDraft.ctaColor),
                          }}
                        >
                          {bannerDraft.ctaText}
                        </span>
                      )}
                    </div>
                    <div className="bg-black/20 px-4 py-2">
                      <p className="text-xs text-white/80">Tap → {bannerTapPreviewLabel}</p>
                    </div>
                  </div>
                </div>

                <p className="text-sm font-semibold">Section C: Image (optional)</p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bannerDraft.useImage}
                    onChange={(e) => setBannerDraft((d) => ({ ...d, useImage: e.target.checked }))}
                  />
                  Add Background Image (optional)
                </label>
                {bannerDraft.useImage && (
                  <div className="space-y-2">
                    <input
                      value={bannerDraft.imageUrl}
                      onChange={(e) => {
                        setBannerImageTest('idle')
                        setBannerDraft((d) => ({ ...d, imageUrl: e.target.value }))
                      }}
                      placeholder="https://... JPG or PNG"
                      className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Recommended: 800×400px, max 2MB
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => testBannerImage(bannerDraft.imageUrl)}
                    >
                      Test Image
                    </Button>
                    {bannerImageTest === 'error' && (
                      <p className="text-xs text-red-600">Image not accessible</p>
                    )}
                    {bannerImageTest === 'ok' && (
                      <p className="text-xs text-green-600">Image loaded successfully</p>
                    )}
                  </div>
                )}

                <p className="text-sm font-semibold">Section D: Navigation</p>
                <p className="text-xs text-muted-foreground">When user taps banner, go to:</p>
                <fieldset className="space-y-3">
                  {(
                    [
                      ['property', 'Specific Property', 'Opens property detail page (B-04)'],
                      [
                        'featured',
                        'Featured Properties List',
                        'Takes buyer to featured properties section',
                      ],
                      [
                        'upcoming',
                        'Upcoming Properties List',
                        'Takes buyer to upcoming launches section',
                      ],
                      ['buy', 'Buy Screen', 'Opens property type selection (B-01)'],
                      ['sell', 'Sell Screen', 'Opens property type selection for selling (SL-01)'],
                      ['url', 'External URL', 'Opens link in app browser'],
                      ['none', 'No Action', 'Banner is decorative only, no tap action'],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <label key={value} className="flex cursor-pointer items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="bannerNavigateTo"
                        className="mt-0.5"
                        checked={bannerDraft.navigateTo === value}
                        onChange={() =>
                          setBannerDraft((d) => ({
                            ...d,
                            navigateTo: value,
                            sectionLinkMode:
                              value === 'featured' || value === 'upcoming'
                                ? (d.sectionLinkMode ?? 'scroll')
                                : null,
                            sellPrefilterType:
                              value === 'sell' ? (d.sellPrefilterType ?? 'all') : d.sellPrefilterType,
                          }))
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{label}</span>
                        <p className="text-xs text-muted-foreground">{hint}</p>
                        {value === 'property' && bannerDraft.navigateTo === 'property' && (
                          <div className="mt-2 space-y-2">
                            {selectableProperties.length === 1 && (
                              <p className="text-xs text-blue-700">
                                Only 1 available property found
                              </p>
                            )}
                            {bannerDraft.propertyId && selectedBannerProperty ? (
                              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                                <div className="flex gap-3">
                                  <img
                                    src={getPropertyThumbnail(selectedBannerProperty)}
                                    alt=""
                                    className="size-12 shrink-0 rounded-md object-cover"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="font-semibold">{selectedBannerProperty.title}</p>
                                    <p className="text-sm">{formatPrice(selectedBannerProperty.price)}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {getDomainPropertyTypeLabel(selectedBannerProperty.type)} ·{' '}
                                      {selectedBannerProperty.city} ·{' '}
                                      {selectedBannerProperty.referenceId}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="mt-2 text-xs font-medium text-blue-700 underline"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    setBannerDraft((d) => ({
                                      ...d,
                                      propertyId: null,
                                      propertyTitle: null,
                                    }))
                                    setPropertySearch('')
                                  }}
                                >
                                  Change
                                </button>
                              </div>
                            ) : (
                              <>
                                <input
                                  value={propertySearch}
                                  onChange={(e) => setPropertySearch(e.target.value)}
                                  placeholder="Search by title, city or reference ID..."
                                  className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                                />
                                {bannerPropertySearchResults.length > 0 && (
                                  <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-1">
                                    {bannerPropertySearchResults.map((p) => (
                                      <li key={p.id}>
                                        <button
                                          type="button"
                                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            setBannerDraft((d) => ({
                                              ...d,
                                              propertyId: p.id,
                                              propertyTitle: p.title,
                                            }))
                                            setPropertySearch('')
                                          }}
                                        >
                                          <img
                                            src={getPropertyThumbnail(p)}
                                            alt=""
                                            className="size-12 shrink-0 rounded object-cover"
                                          />
                                          <span className="min-w-0 flex-1">
                                            <span className="block font-semibold">{p.title}</span>
                                            <span className="text-xs text-muted-foreground">
                                              {formatPrice(p.price)} · {p.city}
                                            </span>
                                          </span>
                                          <Badge variant="default" className="shrink-0 text-[10px]">
                                            {getDomainPropertyTypeLabel(p.type)}
                                          </Badge>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            )}
                            {bannerDraft.propertyTitle && (
                              <p className="text-xs text-blue-600">
                                📱 Opens: B-04 {bannerDraft.propertyTitle}
                              </p>
                            )}
                          </div>
                        )}
                        {value === 'featured' && bannerDraft.navigateTo === 'featured' && (
                          <div className="mt-2 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">View Mode:</p>
                            <label className="flex items-start gap-2 text-xs">
                              <input
                                type="radio"
                                name="featuredLinkMode"
                                className="mt-0.5"
                                checked={(bannerDraft.sectionLinkMode ?? 'scroll') === 'scroll'}
                                onChange={() =>
                                  setBannerDraft((d) => ({ ...d, sectionLinkMode: 'scroll' }))
                                }
                              />
                              <span>
                                Scroll to section on Home (H-01)
                                <span className="mt-0.5 block text-muted-foreground">
                                  Banner taps → home screen scrolls to Featured section
                                </span>
                              </span>
                            </label>
                            <label className="flex items-start gap-2 text-xs">
                              <input
                                type="radio"
                                name="featuredLinkMode"
                                className="mt-0.5"
                                checked={bannerDraft.sectionLinkMode === 'full_list'}
                                onChange={() =>
                                  setBannerDraft((d) => ({ ...d, sectionLinkMode: 'full_list' }))
                                }
                              />
                              <span>
                                Open full Featured list
                                <span className="mt-0.5 block text-muted-foreground">
                                  Opens dedicated featured properties screen
                                </span>
                              </span>
                            </label>
                            <p className="text-xs text-blue-600">
                              📱 Opens: Featured Properties ({featuredProperties.length} listings)
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Manage featured list in the Featured Properties section below.
                            </p>
                          </div>
                        )}
                        {value === 'upcoming' && bannerDraft.navigateTo === 'upcoming' && (
                          <div className="mt-2 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">View Mode:</p>
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="radio"
                                name="upcomingLinkMode"
                                checked={(bannerDraft.sectionLinkMode ?? 'scroll') === 'scroll'}
                                onChange={() =>
                                  setBannerDraft((d) => ({ ...d, sectionLinkMode: 'scroll' }))
                                }
                              />
                              Scroll to section on Home (H-01)
                            </label>
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="radio"
                                name="upcomingLinkMode"
                                checked={bannerDraft.sectionLinkMode === 'full_list'}
                                onChange={() =>
                                  setBannerDraft((d) => ({ ...d, sectionLinkMode: 'full_list' }))
                                }
                              />
                              Open full Upcoming list
                            </label>
                            <p className="text-xs text-orange-700">
                              📱 Opens: Upcoming Properties ({upcomingProperties.length} launches)
                            </p>

                            <p className="text-xs text-muted-foreground">
                              Manage upcoming list in the Upcoming Properties section below.
                            </p>
                          </div>
                        )}
                        {value === 'buy' && bannerDraft.navigateTo === 'buy' && (
                          <div className="mt-2 space-y-2">
                            <label className="text-xs text-muted-foreground">
                              Pre-filter by type (optional):
                            </label>
                            <select
                              value={bannerDraft.buyPrefilterType ?? 'all'}
                              onChange={(e) =>
                                setBannerDraft((d) => ({
                                  ...d,
                                  buyPrefilterType: e.target.value,
                                }))
                              }
                              className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                            >
                              <option value="all">All Types</option>
                              {buyBannerTypeOptions.map((opt) => (
                                <option key={opt.slug} value={opt.slug}>
                                  {opt.displayName}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-blue-600">
                              📱 Opens:{' '}
                              {buyDraftTypeLabel
                                ? `Buy → ${buyDraftTypeLabel}`
                                : 'Buy Screen'}
                            </p>
                          </div>
                        )}
                        {value === 'sell' && bannerDraft.navigateTo === 'sell' && (
                          <div className="mt-2 space-y-2">
                            <label className="text-xs text-muted-foreground">
                              Pre-select property type (optional):
                            </label>
                            <select
                              value={bannerDraft.sellPrefilterType ?? 'all'}
                              onChange={(e) =>
                                setBannerDraft((d) => ({
                                  ...d,
                                  sellPrefilterType: e.target.value,
                                }))
                              }
                              className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                            >
                              <option value="all">All Types</option>
                              {sellBannerTypeOptions.map((opt) => (
                                <option key={opt.slug} value={opt.slug}>
                                  {opt.displayName}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-green-700">📱 Opens: Sell Screen</p>
                          </div>
                        )}
                        {value === 'url' && bannerDraft.navigateTo === 'url' && (
                          <div className="mt-2 space-y-1">
                            <input
                              value={bannerDraft.externalUrl ?? ''}
                              onChange={(e) =>
                                setBannerDraft((d) => ({ ...d, externalUrl: e.target.value }))
                              }
                              placeholder="https://..."
                              className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                            />
                            {bannerUrlInvalid && (
                              <p className="text-xs text-red-600">URL must start with https://</p>
                            )}
                            <p className="text-xs text-muted-foreground">📱 Opens: External URL</p>
                          </div>
                        )}
                        {value === 'none' && bannerDraft.navigateTo === 'none' && (
                          <p className="mt-1 text-xs text-muted-foreground">📱 Tap: No action</p>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>

                <p className="text-sm font-semibold">Section E: Schedule</p>
                <label className="block text-sm">
                  Start Date (optional)
                  <input
                    type="datetime-local"
                    value={bannerDraft.startDate?.slice(0, 16) ?? ''}
                    onChange={(e) =>
                      setBannerDraft((d) => ({
                        ...d,
                        startDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                      }))
                    }
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Banner shows from this date. Leave empty to show immediately.
                  </span>
                </label>
                <label className="block text-sm">
                  Expiry Date (optional)
                  <input
                    type="datetime-local"
                    value={bannerDraft.expiryDate?.slice(0, 16) ?? ''}
                    onChange={(e) =>
                      setBannerDraft((d) => ({
                        ...d,
                        expiryDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                      }))
                    }
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Banner auto-hides after this date.
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bannerDraft.isActive}
                    onChange={(e) => setBannerDraft((d) => ({ ...d, isActive: e.target.checked }))}
                  />
                  Active
                </label>
                <div className="flex gap-2">
                  <Button type="button" onClick={saveHomeBanner}>
                    Save Banner
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setBannerFormOpen(false)
                      setEditingBannerId(null)
                      resetBannerDraft()
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {sortedHomeBanners.map((banner, idx) => {
                const status = getHomeBannerStatus(banner)
                const missingProperty =
                  banner.navigateTo === 'property' &&
                  !propertyExists(banner.propertyId, appProperties)
                const soldProperty =
                  banner.navigateTo === 'property' &&
                  isLinkedPropertySold(banner.propertyId, appProperties)
                const featuredCount = featuredProperties.length
                const upcomingCount = upcomingProperties.length
                const buyTypeLabel = resolveTypeSlugLabel(
                  banner.buyPrefilterType,
                  buyBannerTypeOptions,
                )
                const sellTypeLabel = resolveTypeSlugLabel(
                  banner.sellPrefilterType,
                  sellBannerTypeOptions,
                )
                const imageBad = bannerImageTests[banner.id] === 'error'
                return (
                  <div
                    key={banner.id}
                    draggable
                    onDragStart={() => setBannerDragIndex(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleBannerDrop(idx)}
                    className="flex gap-3 rounded-lg border border-border p-3"
                  >
                    <button
                      type="button"
                      className="mt-2 cursor-grab text-muted-foreground hover:text-foreground"
                      aria-label="Drag to reorder"
                    >
                      <GripVertical className="size-5" />
                    </button>
                    <div
                      className="h-24 w-40 shrink-0 overflow-hidden rounded-lg border border-border"
                      style={{
                        backgroundColor: banner.useImage && banner.imageUrl ? undefined : banner.bgColor,
                        backgroundImage:
                          banner.useImage && banner.imageUrl ? `url(${banner.imageUrl})` : undefined,
                        backgroundSize: 'cover',
                      }}
                    >
                      <div className="flex h-full flex-col justify-end p-2">
                        <p
                          className={cn(
                            'truncate text-xs font-semibold',
                            banner.textColor === 'white' ? 'text-white' : 'text-slate-900',
                          )}
                        >
                          {banner.title}
                        </p>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{banner.title}</p>
                        <span className="text-xs text-muted-foreground">#{banner.order}</span>
                        <span className="text-xs text-muted-foreground">
                          Banner {idx + 1} of {sortedHomeBanners.length}
                        </span>
                        {status === 'active' && (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                        )}
                        {status === 'scheduled' && (
                          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
                            Scheduled
                            {banner.startDate ? ` · ${formatBannerDateLabel(banner.startDate)}` : ''}
                          </Badge>
                        )}
                        {status === 'expired' && (
                          <Badge className="bg-muted text-muted-foreground hover:bg-muted">Expired</Badge>
                        )}
                        {status === 'inactive' && (
                          <Badge className="bg-muted text-muted-foreground hover:bg-muted">Inactive</Badge>
                        )}
                        {imageBad && (
                          <Badge variant="red">Image unreachable</Badge>
                        )}
                      </div>
                      <div className="mt-1">
                        {banner.navigateTo === 'property' && (
                          <p className="text-xs text-blue-700">
                            🏠 &quot;{banner.propertyTitle ?? 'Property not selected'}&quot;
                          </p>
                        )}
                        {banner.navigateTo === 'featured' && (
                          <p className="text-xs text-purple-700">
                            ⭐ Featured Properties ({featuredCount})
                          </p>
                        )}
                        {banner.navigateTo === 'upcoming' && (
                          <p className="text-xs text-orange-700">
                            🚀 Upcoming Properties ({upcomingCount})
                          </p>
                        )}
                        {banner.navigateTo === 'buy' && (
                          <p className="text-xs text-blue-700">
                            🔵 Buy Screen
                            {buyTypeLabel ? ` · ${buyTypeLabel}` : ''}
                          </p>
                        )}
                        {banner.navigateTo === 'sell' && (
                          <p className="text-xs text-green-700">
                            🟢 Sell Screen
                            {sellTypeLabel ? ` · ${sellTypeLabel}` : ''}
                          </p>
                        )}
                        {banner.navigateTo === 'url' && (
                          <p className="text-xs text-muted-foreground">
                            🔗 {truncateUrl(banner.externalUrl ?? 'https://...')}
                          </p>
                        )}
                        {banner.navigateTo === 'none' && (
                          <p className="text-xs text-muted-foreground">No action</p>
                        )}
                      </div>
                      {banner.startDate && (
                        <p className="text-xs text-muted-foreground">
                          Start: {formatBannerDateLabel(banner.startDate)}
                        </p>
                      )}
                      {banner.expiryDate && (
                        <p className="text-xs text-muted-foreground">
                          Expiry: {formatBannerDateLabel(banner.expiryDate)}
                        </p>
                      )}
                      {soldProperty && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant="red">⚠️ Property sold</Badge>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs"
                            onClick={() => {
                              setEditingBannerId(banner.id)
                              setBannerDraft(homeBannerToDraft(banner))
                              setPropertySearch('')
                              setBannerFormOpen(true)
                            }}
                          >
                            Update Link
                          </Button>
                        </div>
                      )}
                      {missingProperty && !soldProperty && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant="red">⚠️ Property missing</Badge>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs"
                            onClick={() => {
                              setEditingBannerId(banner.id)
                              setBannerDraft(homeBannerToDraft(banner))
                              setPropertySearch('')
                              setBannerFormOpen(true)
                            }}
                          >
                            Update Link
                          </Button>
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => testBannerImage(banner.imageUrl, banner.id)}
                        >
                          Test
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingBannerId(banner.id)
                            setBannerDraft(homeBannerToDraft(banner))
                            setPropertySearch(banner.propertyTitle ?? '')
                            setBannerFormOpen(true)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          onClick={() =>
                            setHomeBanners((prev) => {
                              const next = prev.filter((x) => x.id !== banner.id)
                              return next.map((b, i) => ({ ...b, order: i + 1 }))
                            })
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              App shows banners in this order. Auto-cycles every 3 seconds.
            </p>
            <Button type="button" className="w-full" onClick={saveAllHomeBanners}>
              Save All Banners
            </Button>

            <div className="border-t border-border pt-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">Property Type Visibility</h2>
                  <Badge variant="default" className="bg-blue-100 font-normal text-blue-800 hover:bg-blue-100">
                    Buy Screen
                  </Badge>
                  <Badge variant="default" className="bg-green-100 font-normal text-green-800 hover:bg-green-100">
                    Sell Screen
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  📱 App screens: B-01 Buy + SL-01 Sell
                </p>
              </div>
              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                Control which property types appear on the Buy and Sell screens. Changes reflect
                immediately in app.
              </div>

              {buyVisibleCount === 0 && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  No property types visible on Buy screen. At least 1 must be active.
                </div>
              )}
              {sellVisibleCount === 0 && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  No property types visible on Sell screen. At least 1 must be active.
                </div>
              )}

              <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[880px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Icon</th>
                      <th className="px-3 py-2 font-medium">Type Name</th>
                      <th className="px-3 py-2 font-medium">Display Name</th>
                      <th className="px-3 py-2 font-medium">
                        <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                          Buy Screen
                        </span>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          Sell Screen
                        </span>
                      </th>
                      <th className="px-3 py-2 font-medium">Order</th>
                      <th className="px-3 py-2 font-medium">Save</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPropertyTypes.map((pt, idx) => (
                      <tr key={pt.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-xl">{pt.icon}</td>
                        <td className="px-3 py-2 font-medium">{pt.typeName}</td>
                        <td className="px-3 py-2">
                          <input
                            value={pt.displayName}
                            onChange={(e) =>
                              updatePropertyTypeField(pt.id, 'displayName', e.target.value)
                            }
                            placeholder="e.g. CMDA Plots"
                            className="h-8 w-full min-w-[140px] rounded-md border border-border bg-input px-2 text-sm"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-blue-700">📱 B-01 Buy</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={pt.showOnBuy}
                              aria-label={`${pt.typeName} on Buy screen`}
                              disabled={pt.showOnBuy && buyVisibleCount <= 1}
                              className={cn(
                                'relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                pt.showOnBuy ? 'bg-blue-500' : 'bg-muted',
                              )}
                              onClick={() => toggleShowOnBuy(pt.id, !pt.showOnBuy)}
                            >
                              <span
                                className={cn(
                                  'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
                                  pt.showOnBuy ? 'left-5' : 'left-0.5',
                                )}
                              />
                            </button>
                            <span className="text-xs text-muted-foreground">Buy</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-green-700">📱 SL-01 Sell</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={pt.showOnSell}
                              aria-label={`${pt.typeName} on Sell screen`}
                              disabled={pt.showOnSell && sellVisibleCount <= 1}
                              className={cn(
                                'relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                pt.showOnSell ? 'bg-green-500' : 'bg-muted',
                              )}
                              onClick={() => toggleShowOnSell(pt.id, !pt.showOnSell)}
                            >
                              <span
                                className={cn(
                                  'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
                                  pt.showOnSell ? 'left-5' : 'left-0.5',
                                )}
                              />
                            </button>
                            <span className="text-xs text-muted-foreground">Sell</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <GripVertical className="size-4 text-muted-foreground" />
                            <span className="w-6 text-center font-medium">{pt.order}</span>
                            <div className="flex flex-col">
                              <button
                                type="button"
                                className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                disabled={idx === 0}
                                onClick={() => movePropertyType(pt.id, 'up')}
                                aria-label="Move up"
                              >
                                <ChevronUp className="size-4" />
                              </button>
                              <button
                                type="button"
                                className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                disabled={idx === sortedPropertyTypes.length - 1}
                                onClick={() => movePropertyType(pt.id, 'down')}
                                aria-label="Move down"
                              >
                                <ChevronDown className="size-4" />
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => savePropertyTypeRow(pt.id)}
                          >
                            Save
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                type="button"
                className="mt-4 w-full"
                disabled={buyVisibleCount === 0 || sellVisibleCount === 0}
                onClick={saveAllPropertyTypes}
              >
                Save All Property Types
              </Button>
            </div>

            {visibilityConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
                  {visibilityConfirm.type === 'interior-buy' ? (
                    <>
                      <h3 className="font-semibold">Enable Interior on Buy screen?</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Interior is a service, not a buyable property. Are you sure?
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="font-semibold">Enable Fractional on Sell screen?</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Fractional ownership is managed by Builtglory only. Enabling allows sellers
                        to list. Are you sure?
                      </p>
                    </>
                  )}
                  <div className="mt-4 flex gap-2">
                    <Button type="button" onClick={confirmVisibilityChange}>
                      Confirm
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setVisibilityConfirm(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-border pt-6">
              <AppContentSectionHeader
                title="Section Visibility"
                screen="H-01"
                description="Drag to reorder sections and control visibility on the app home screen"
              />
              <ul className="mt-4 space-y-3">
                {sortedSections.map((section, idx) => (
                  <li
                    key={section.id}
                    draggable={section.canDisable}
                    onDragStart={() => section.canDisable && setSectionDragIndex(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleSectionDrop(idx)}
                    className="flex items-start gap-3 rounded-lg border border-border p-4"
                  >
                    <div className="flex shrink-0 flex-col items-center pt-1">
                      {section.canDisable ? (
                        <span title="Drag to reorder">
                          <GripVertical className="size-5 cursor-grab text-muted-foreground" />
                        </span>
                      ) : (
                        <span title="This section cannot be moved or disabled" className="text-base">
                          🔒
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{section.label}</p>
                      <p className="text-sm text-muted-foreground">{section.description}</p>
                      {!section.canDisable && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          This section cannot be moved or disabled
                        </p>
                      )}
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={section.isActive}
                        disabled={!section.canDisable}
                        onChange={(e) =>
                          setSections((prev) =>
                            prev.map((s) =>
                              s.id === section.id ? { ...s, isActive: e.target.checked } : s,
                            ),
                          )
                        }
                      />
                      {section.isActive ? 'On' : 'Off'}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex justify-end">
                <Button type="button" onClick={saveHomeLayout}>
                  Save Layout
                </Button>
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <div className="mb-4">
                <h2 className="text-xl font-semibold">⭐ Featured Properties</h2>
                <p className="text-sm text-muted-foreground">📱 App screen: H-01</p>
                <p className="text-sm text-muted-foreground">
                  Manage properties shown in Featured carousel on app home
                </p>
              </div>
              <div className="grid grid-cols-[1fr_300px] gap-6">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800">
                      ⭐ {featuredStats.count} Featured
                    </span>
                    <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                      🏠 {featuredStats.availableToAdd} Can add
                    </span>
                    <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                      📍 {featuredStats.topCity}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                      💰 Avg {featuredStats.avgPrice ? formatPrice(featuredStats.avgPrice) : '—'}
                    </span>
                  </div>

                  {featuredProperties.length >= 20 && (
                    <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                      ⚠️ Maximum 20 featured. Remove one first.
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Current Featured List
                    </p>
                    {featuredProperties.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border py-8 text-center">
                        <p className="text-3xl">⭐</p>
                        <p className="mt-2 font-medium">No featured properties</p>
                        <p className="text-xs text-muted-foreground">
                          Search and add your first →
                        </p>
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {featuredProperties.map((p, fIdx) => (
                          <li
                            key={p.id}
                            draggable
                            onDragStart={() => setFeaturedDragIndex(fIdx)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleFeaturedDrop(fIdx)}
                            className="rounded-lg border border-border p-3"
                          >
                            <div className="flex gap-3">
                              <GripVertical className="mt-2 size-4 shrink-0 cursor-grab text-muted-foreground" />
                              <img
                                src={getPropertyThumbnail(p)}
                                alt=""
                                className="size-12 shrink-0 rounded object-cover"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="font-semibold">{p.title}</p>
                                    <p className="text-sm">{formatPrice(p.price)}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {getDomainPropertyTypeLabel(p.type)} · {p.city}
                                    </p>
                                    {isPropertyVerified(p) && (
                                      <Badge className="mt-1 bg-green-100 text-green-800 hover:bg-green-100">
                                        ✅ Verified
                                      </Badge>
                                    )}
                                    {p.isUpcoming && (
                                      <Badge className="ml-1 mt-1 bg-orange-100 text-orange-800 hover:bg-orange-100">
                                        🚀 Upcoming
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-xs"
                                      disabled={fIdx === 0}
                                      onClick={() => moveFeatured(p.id, 'up')}
                                    >
                                      ↑
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-xs"
                                      disabled={fIdx === featuredProperties.length - 1}
                                      onClick={() => moveFeatured(p.id, 'down')}
                                    >
                                      ↓
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-xs text-destructive"
                                      onClick={() => removeFromFeatured(p.id)}
                                    >
                                      × Remove
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      First property = first card shown
                    </p>
                  </div>

                  <div className="space-y-2">
                    <input
                      value={featuredAddSearch}
                      onChange={(e) => setFeaturedAddSearch(e.target.value)}
                      placeholder="🔍 Search property to feature..."
                      className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                    {featuredPanelAddResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {featuredStats.availableToAdd === 0
                          ? 'All available properties are already featured'
                          : 'No matching properties'}
                      </p>
                    ) : (
                      <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1">
                        {featuredPanelAddResults.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              disabled={featuredProperties.length >= 20}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
                              onClick={() => addToFeatured(p.id)}
                            >
                              <img
                                src={getPropertyThumbnail(p)}
                                alt=""
                                className="size-12 shrink-0 rounded object-cover"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium">{p.title}</span>
                                <span className="text-xs text-muted-foreground">
                                  {formatPrice(p.price)} · {getDomainPropertyTypeLabel(p.type)} · {p.city}
                                  {isPropertyVerified(p) ? ' · ✅ Verified' : ''}
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <AppPhonePreview type="featured" properties={featuredProperties} />
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <div className="mb-4">
                <h2 className="text-xl font-semibold">🚀 Upcoming Properties</h2>
                <p className="text-sm text-muted-foreground">📱 App screen: H-01</p>
                <p className="text-sm text-muted-foreground">
                  Manage properties shown in Upcoming Launches section
                </p>
              </div>
              <div className="grid grid-cols-[1fr_300px] gap-6">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-orange-100 px-2 py-1 text-xs text-orange-800">
                      🚀 {upcomingStats.count} Upcoming
                    </span>
                    <span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800">
                      📅 Next:{' '}
                      {upcomingStats.nextLaunch
                        ? formatLaunchDateLabel(upcomingStats.nextLaunch)
                        : '—'}
                    </span>
                    {upcomingStats.missingDates > 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-800">
                        ⚠️ {upcomingStats.missingDates} No date
                      </span>
                    )}
                    <span className="rounded-full bg-green-100 px-2 py-1 text-xs text-green-800">
                      ✅ {upcomingStats.launchingThisMonth} This month
                    </span>
                  </div>

                  {allUpcomingLaunchesPassed && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      All upcoming launches passed! Update dates or remove listings.
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Current Upcoming List
                    </p>
                    {upcomingProperties.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border py-8 text-center">
                        <p className="text-3xl">🚀</p>
                        <p className="mt-2 font-medium">No upcoming properties yet</p>
                        <p className="text-xs text-muted-foreground">
                          Add your first upcoming launch →
                        </p>
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {upcomingProperties.map((p) => {
                          const launchBadge = getUpcomingRowBadge(p.launchDate)
                          return (
                            <li key={p.id} className="rounded-lg border border-border p-3">
                              <div className="flex gap-3">
                                <img
                                  src={getPropertyThumbnail(p)}
                                  alt=""
                                  className="size-12 shrink-0 rounded object-cover"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <p className="font-semibold">{p.title}</p>
                                      <p className="text-sm">{formatPrice(p.price)}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {getDomainPropertyTypeLabel(p.type)} · {p.city}
                                      </p>
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {p.isFeatured && (
                                          <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">
                                            ⭐ Featured
                                          </Badge>
                                        )}
                                        <Badge className={launchBadge.className}>
                                          {launchBadge.label}
                                        </Badge>
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-xs text-destructive"
                                      onClick={() => removeFromUpcoming(p.id)}
                                    >
                                      × Remove
                                    </Button>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Launch:</span>
                                    <input
                                      type="date"
                                      min={new Date().toISOString().slice(0, 10)}
                                      value={toDateInputValue(p.launchDate)}
                                      onChange={(e) =>
                                        updateUpcomingLaunchDate(
                                          p.id,
                                          e.target.value
                                            ? new Date(e.target.value).toISOString()
                                            : null,
                                        )
                                      }
                                      className="h-8 rounded-md border border-border bg-input px-2 text-xs"
                                    />
                                    <span className="text-xs">📅</span>
                                    {isLaunchDatePast(p.launchDate) && (
                                      <button
                                        type="button"
                                        className="text-xs font-medium text-primary underline"
                                        onClick={() => moveUpcomingToAvailable(p.id)}
                                      >
                                        Move to Available
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setUpcomingAddOpen((o) => !o)
                      setUpcomingAddSelectedId(null)
                      setUpcomingAddLaunchDate('')
                      setUpcomingAddDateError(false)
                    }}
                  >
                    <Plus className="mr-1 size-4" /> Add Upcoming Launch
                  </Button>

                  {upcomingAddOpen && (
                    <div className="space-y-3 rounded-lg border border-border p-3">
                      {!upcomingAddSelectedId ? (
                        <>
                          <input
                            value={upcomingAddSearch}
                            onChange={(e) => setUpcomingAddSearch(e.target.value)}
                            placeholder="Search property..."
                            className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                          />
                          {upcomingAddResults.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No matching properties</p>
                          ) : (
                            <ul className="max-h-64 space-y-1 overflow-y-auto">
                              {upcomingAddResults.map((p) => (
                                <li key={p.id}>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                                    onClick={() => {
                                      setUpcomingAddSelectedId(p.id)
                                      setUpcomingAddSearch(p.title)
                                    }}
                                  >
                                    <img
                                      src={getPropertyThumbnail(p)}
                                      alt=""
                                      className="size-12 shrink-0 rounded object-cover"
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="block font-medium">{p.title}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {formatPrice(p.price)} · {getDomainPropertyTypeLabel(p.type)} ·{' '}
                                        {p.city}
                                      </span>
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            {appProperties.find((x) => x.id === upcomingAddSelectedId)?.title}
                          </p>
                          <label className="block text-sm">
                            Set Launch Date:
                            <input
                              type="date"
                              min={new Date().toISOString().slice(0, 10)}
                              value={upcomingAddLaunchDate}
                              onChange={(e) => {
                                setUpcomingAddLaunchDate(e.target.value)
                                setUpcomingAddDateError(
                                  Boolean(
                                    e.target.value && isLaunchDatePast(e.target.value),
                                  ),
                                )
                              }}
                              className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                            />
                          </label>
                          {upcomingAddDateError && (
                            <p className="text-xs text-red-600">Launch date must be in the future</p>
                          )}
                          <p className="text-xs text-muted-foreground">Launch date required</p>
                          <div className="flex gap-2">
                            <Button type="button" onClick={confirmAddToUpcoming}>
                              Add to Upcoming 🚀
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setUpcomingAddSelectedId(null)
                                setUpcomingAddLaunchDate('')
                                setUpcomingAddDateError(false)
                              }}
                            >
                              Back
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <AppPhonePreview type="upcoming" properties={upcomingProperties} />
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <AppContentSectionHeader
                  title="News & Insights"
                  screen="H-01"
                  description="Articles shown on the home screen when News & Insights is enabled"
                />
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setEditingArticleId('new')
                    setArticleDraft({
                      title: '',
                      category: 'Market News',
                      content: '',
                      imageUrl: '',
                      active: true,
                    })
                  }}
                >
                  <Plus className="mr-1 size-4" /> Add Article
                </Button>
              </div>

              {(editingArticleId === 'new' || editingArticleId) && (
                <div className="mt-4 space-y-2 rounded-lg border border-border p-4">
                  <input
                    placeholder="Title (required)"
                    value={articleDraft.title}
                    onChange={(e) => setArticleDraft((d) => ({ ...d, title: e.target.value }))}
                    className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <select
                    value={articleDraft.category}
                    onChange={(e) =>
                      setArticleDraft((d) => ({
                        ...d,
                        category: e.target.value as NewsCategory,
                      }))
                    }
                    className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  >
                    <option value="Market News">Market News</option>
                    <option value="Tips">Tips</option>
                    <option value="Legal">Legal</option>
                    <option value="Investment">Investment</option>
                  </select>
                  <textarea
                    placeholder="Content"
                    value={articleDraft.content}
                    onChange={(e) => setArticleDraft((d) => ({ ...d, content: e.target.value }))}
                    className="min-h-[100px] w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="Image URL"
                    value={articleDraft.imageUrl}
                    onChange={(e) => setArticleDraft((d) => ({ ...d, imageUrl: e.target.value }))}
                    className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={articleDraft.active}
                      onChange={(e) =>
                        setArticleDraft((d) => ({ ...d, active: e.target.checked }))
                      }
                    />
                    Active
                  </label>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={saveArticle}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingArticleId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-3">
                {newsArticles.map((article) => (
                  <div
                    key={article.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <img
                      src={
                        article.imageUrl ||
                        'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=96'
                      }
                      alt=""
                      className="size-12 shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{article.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${NEWS_CATEGORY_STYLES[article.category]}`}
                        >
                          {article.category}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatArticleDate(article.publishedAt)}
                        </span>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={article.active}
                        onChange={async () => {
                          const session = readAdminSession()
                          if (!session?.accessToken) return showToast('Sign in again to update article')
                          try {
                            const saved = await updateAdminContent(session.accessToken, article.id, {
                              status: article.active ? 'draft' : 'published',
                            })
                            setContentItems((prev) => prev.map((item) => (contentId(item) === article.id ? saved : item)))
                            setNewsArticles((prev) => prev.map((a) => (a.id === article.id ? toNewsArticle(saved) : a)))
                          } catch (error) {
                            showToast(error instanceof Error ? error.message : 'Could not update article')
                          }
                        }}
                      />
                      Active
                    </label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingArticleId(article.id)
                          setArticleDraft({
                            title: article.title,
                            category: article.category,
                            content: article.content,
                            imageUrl: article.imageUrl,
                            active: article.active,
                          })
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={async () => {
                          const session = readAdminSession()
                          if (!session?.accessToken) return showToast('Sign in again to delete article')
                          try {
                            await deleteAdminContent(session.accessToken, article.id)
                            setContentItems((prev) => prev.filter((item) => contentId(item) !== article.id))
                            setNewsArticles((prev) => prev.filter((a) => a.id !== article.id))
                          } catch (error) {
                            showToast(error instanceof Error ? error.message : 'Could not delete article')
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {renderOnboardingSlidesSection()}
          </div>
        )
      case 'onboarding':
        return <div className="space-y-6">{renderOnboardingSlidesSection()}</div>
      case 'faq':
        return (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <AppContentSectionHeader
                title="FAQ"
                screen="H-05, P-11"
                description="Manage frequently asked questions in the app help section."
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingFaqId('new')
                  setFaqDraft({ question: '', answer: '', category: 'General' })
                }}
              >
                <Plus className="size-4" /> Add FAQ
              </Button>
            </div>
            <div className="space-y-3">
              {(editingFaqId === 'new' || editingFaqId) && (
                <div className="space-y-2 rounded-lg border border-border p-4">
                  <input
                    placeholder="Question"
                    value={faqDraft.question}
                    onChange={(e) => setFaqDraft((d) => ({ ...d, question: e.target.value }))}
                    className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <textarea
                    placeholder="Answer"
                    value={faqDraft.answer}
                    onChange={(e) => setFaqDraft((d) => ({ ...d, answer: e.target.value }))}
                    className="min-h-[80px] w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <select
                    value={faqDraft.category}
                    onChange={(e) =>
                      setFaqDraft((d) => ({ ...d, category: e.target.value as FaqCategory }))
                    }
                    className="h-9 w-full rounded-md border border-border bg-input px-2 text-sm"
                  >
                    {(['General', 'Buying', 'Selling', 'Payment'] as FaqCategory[]).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={saveFaq}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingFaqId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {faqs.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3 last:border-0"
                >
                  <div>
                    <p className="font-medium">{f.question}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{f.answer}</p>
                    <Badge variant="default" className="mt-1">
                      {f.category}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs">
                      <input
                        type="checkbox"
                        checked={f.active}
                        onChange={async () => {
                          const session = readAdminSession()
                          if (!session?.accessToken) return showToast('Sign in again to update FAQ')
                          try {
                            const saved = await updateAdminContent(session.accessToken, f.id, {
                              status: f.active ? 'draft' : 'published',
                            })
                            setContentItems((prev) => prev.map((item) => (contentId(item) === f.id ? saved : item)))
                            setFaqs((prev) => prev.map((x) => (x.id === f.id ? toFaqItem(saved) : x)))
                          } catch (error) {
                            showToast(error instanceof Error ? error.message : 'Could not update FAQ')
                          }
                        }}
                      />
                      Active
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingFaqId(f.id)
                        setFaqDraft({
                          question: f.question,
                          answer: f.answer,
                          category: f.category,
                        })
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={async () => {
                        const session = readAdminSession()
                        if (!session?.accessToken) return showToast('Sign in again to delete FAQ')
                        try {
                          await deleteAdminContent(session.accessToken, f.id)
                          setContentItems((prev) => prev.filter((item) => contentId(item) !== f.id))
                          setFaqs((prev) => prev.filter((x) => x.id !== f.id))
                        } catch (error) {
                          showToast(error instanceof Error ? error.message : 'Could not delete FAQ')
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      case 'terms':
        return (
          <div className="space-y-6">
            <AppContentSectionHeader
              title="Terms & Conditions"
              screen="A-06"
              description="Legal terms displayed in the app. Changes update the app immediately."
            />
            <Badge variant="blue" className="font-normal">
              Changes here update the app immediately
            </Badge>
            <textarea
              value={termsContent}
              onChange={(e) => setTermsContent(e.target.value)}
              className="min-h-[300px] w-full rounded-md border border-border bg-input px-3 py-2 text-sm leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">Last updated: {termsLastUpdated}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={saveTerms}>
                Save Changes
              </Button>
              <Button type="button" variant="outline" onClick={() => setLegalPreview('terms')}>
                Preview in App
              </Button>
            </div>
          </div>
        )
      case 'privacy':
        return (
          <div className="space-y-6">
            <AppContentSectionHeader
              title="Privacy Policy"
              screen="A-07"
              description="Privacy policy content shown to users in the app."
            />
            <Badge variant="blue" className="font-normal">
              Changes here update the app immediately
            </Badge>
            <textarea
              value={privacyContent}
              onChange={(e) => setPrivacyContent(e.target.value)}
              className="min-h-[300px] w-full rounded-md border border-border bg-input px-3 py-2 text-sm leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">Last updated: {privacyLastUpdated}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={savePrivacy}>
                Save Changes
              </Button>
              <Button type="button" variant="outline" onClick={() => setLegalPreview('privacy')}>
                Preview
              </Button>
            </div>
          </div>
        )
      case 'about':
        return (
          <div className="space-y-6">
            <AppContentSectionHeader
              title="About App"
              screen="A-05"
              description="App version, company details, and force-update settings."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                App Version
                <input
                  value={aboutApp.appVersion}
                  onChange={(e) => setAboutApp((a) => ({ ...a, appVersion: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                />
              </label>
              <label className="block text-sm">
                Build Number
                <input
                  value={aboutApp.buildNumber}
                  onChange={(e) => setAboutApp((a) => ({ ...a, buildNumber: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                />
              </label>
              <label className="block text-sm">
                Release Date
                <input
                  type="date"
                  value={aboutApp.releaseDate}
                  onChange={(e) => setAboutApp((a) => ({ ...a, releaseDate: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                />
              </label>
              <label className="block text-sm">
                Company Name
                <input
                  value={aboutApp.companyName}
                  onChange={(e) => setAboutApp((a) => ({ ...a, companyName: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                Company Website
                <input
                  value={aboutApp.companyWebsite}
                  onChange={(e) =>
                    setAboutApp((a) => ({ ...a, companyWebsite: e.target.value }))
                  }
                  className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                />
              </label>
              <label className="block text-sm">
                Support Email
                <input
                  type="email"
                  value={aboutApp.supportEmail}
                  onChange={(e) => setAboutApp((a) => ({ ...a, supportEmail: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                />
              </label>
              <label className="block text-sm">
                Support Phone
                <input
                  value={aboutApp.supportPhone}
                  onChange={(e) => setAboutApp((a) => ({ ...a, supportPhone: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                App Description
                <textarea
                  value={aboutApp.appDescription}
                  onChange={(e) =>
                    setAboutApp((a) => ({ ...a, appDescription: e.target.value }))
                  }
                  rows={3}
                  className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Social Links</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['instagram', 'Instagram URL', 'https://instagram.com/...'],
                    ['linkedin', 'LinkedIn URL', 'https://linkedin.com/...'],
                    ['twitter', 'Twitter/X URL', 'https://x.com/...'],
                    ['whatsapp', 'WhatsApp Business', '+91...'],
                  ] as const
                ).map(([key, label, placeholder]) => (
                  <label key={key} className="block text-sm">
                    {label}
                    <input
                      value={aboutApp[key]}
                      onChange={(e) =>
                        setAboutApp((a) => ({ ...a, [key]: e.target.value }))
                      }
                      placeholder={placeholder}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
            <Button type="button" onClick={saveAboutInfo}>
              Save About Info
            </Button>
            <div className="border-t border-border pt-6">
              <h3 className="font-semibold">Force Update</h3>
              <p className="text-sm text-muted-foreground">Force users to update app</p>
              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  Min Required Version
                  <input
                    value={forceUpdateMinVersion}
                    onChange={(e) => setForceUpdateMinVersion(e.target.value)}
                    placeholder="1.0.0"
                    className="mt-1 h-9 w-full max-w-xs rounded-md border border-border bg-input px-3 text-sm"
                  />
                </label>
                <label className="flex items-center justify-between gap-4 text-sm">
                  <span>Enable Force Update</span>
                  <input
                    type="checkbox"
                    checked={forceUpdateEnabled}
                    onChange={(e) => setForceUpdateEnabled(e.target.checked)}
                  />
                </label>
                {forceUpdateEnabled && (
                  <p className="text-xs text-amber-700">
                    Users below min version will be forced to update
                  </p>
                )}
                <Button type="button" variant="outline" onClick={saveForceUpdateSettings}>
                  Save Update Settings
                </Button>
              </div>
            </div>
          </div>
        )
      case 'push':
        return (
          <div className="space-y-6">
            <AppContentSectionHeader
              title="Push Notifications"
              screen="P-08"
              description="Send push notifications to app users and view recent history."
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-sm">
                  Title{' '}
                  <span className="text-muted-foreground">({pushTitle.length}/50)</span>
                  <input
                    maxLength={50}
                    value={pushTitle}
                    onChange={(e) => setPushTitle(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  Message{' '}
                  <span
                    className={cn(
                      pushMessage.length >= 100
                        ? 'text-red-600'
                        : pushMessage.length >= 90
                          ? 'text-orange-600'
                          : 'text-muted-foreground',
                    )}
                  >
                    ({pushMessage.length}/100)
                  </span>
                  <textarea
                    maxLength={100}
                    value={pushMessage}
                    onChange={(e) => setPushMessage(e.target.value)}
                    className="mt-1 min-h-[80px] w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                </label>
                <fieldset className="text-sm">
                  <legend className="mb-1 text-muted-foreground">Target audience</legend>
                  {['all', 'buyers', 'sellers', 'nri', 'specific'].map((a) => (
                    <label key={a} className="mr-3">
                      <input
                        type="radio"
                        name="pushAud"
                        checked={pushAudience === a}
                        onChange={() => setPushAudience(a)}
                      />{' '}
                      {a === 'all'
                        ? 'All Users'
                        : a === 'specific'
                          ? 'Specific User'
                          : `${a.charAt(0).toUpperCase()}${a.slice(1)} Only`}
                    </label>
                  ))}
                  {pushAudience === 'specific' && (
                    <input
                      placeholder="Phone"
                      value={pushPhone}
                      onChange={(e) => setPushPhone(e.target.value)}
                      className="mt-2 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  )}
                </fieldset>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={pushScheduleLater}
                    onChange={(e) => setPushScheduleLater(e.target.checked)}
                  />
                  Schedule for later
                </label>
                {pushScheduleLater && (
                  <label className="block text-sm">
                    Send on:
                    <input
                      type="datetime-local"
                      min={new Date().toISOString().slice(0, 16)}
                      value={pushScheduleAt}
                      onChange={(e) => setPushScheduleAt(e.target.value)}
                      className="mt-1 block h-9 w-full rounded-md border border-border bg-input px-2 text-sm"
                    />
                  </label>
                )}
                <p className="text-xs text-muted-foreground">WhatsApp limit: 1,000/day (bulk sends)</p>
                <Button
                  type="button"
                  disabled={!pushTitle.trim() || !pushMessage.trim() || pushMessage.length > 100}
                  onClick={() => setPushConfirmOpen(true)}
                >
                  {pushScheduleLater ? 'Schedule' : 'Send Now'}
                </Button>
              </div>
              <div className="rounded-xl border-8 border-foreground bg-muted p-4">
                <p className="text-center text-xs text-muted-foreground">Preview</p>
                <div className="mt-2 rounded-lg bg-card p-3 shadow">
                  <p className="text-xs font-semibold">BuiltGlory</p>
                  <p className="font-medium">{pushTitle || 'Notification title'}</p>
                  <p className="text-sm text-muted-foreground">
                    {pushMessage || 'Message preview…'}
                  </p>
                </div>
              </div>
            </div>
            {scheduledNotifications.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">
                  ⏰ Scheduled ({scheduledNotifications.length})
                </p>
                <ul className="space-y-2">
                  {scheduledNotifications.map((n) => (
                    <li
                      key={n.id}
                      className="rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <p className="font-medium">{n.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{n.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Target: {n.target} · Sends:{' '}
                        {new Date(n.scheduledAt).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 px-2 text-xs"
                        onClick={() => cancelScheduledNotification(n.id)}
                      >
                        Cancel
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-medium">Recent notifications</p>
              <ul className="space-y-2">
                {pushHistory.map((p) => (
                  <li
                    key={p.id}
                    className="flex justify-between rounded border border-border px-3 py-2 text-sm"
                  >
                    <span>
                      <strong>{p.title}</strong> · {p.audience}
                    </span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {formatPushDate(p.sentAt)}{' '}
                      <Badge
                        variant={
                          p.status === 'Sent'
                            ? 'responded'
                            : p.status === 'Failed'
                              ? 'red'
                              : 'pending'
                        }
                      >
                        {p.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-border pt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BarChart2 className="size-5 text-primary" />
                  <h3 className="text-lg font-semibold">Delivery Reports</h3>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => showToast('Downloading report...')}
                >
                  Export Reports
                </Button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">Notification</th>
                      <th className="px-3 py-2">Target</th>
                      <th className="px-3 py-2">Sent</th>
                      <th className="px-3 py-2 text-green-700">Delivered</th>
                      <th className="px-3 py-2 text-blue-700">Opened</th>
                      <th className="px-3 py-2 text-red-700">Failed</th>
                      <th className="px-3 py-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryReports.map((r) => {
                      const deliveryRate = Math.round((r.deliveredCount / r.sentCount) * 100)
                      const openRate = Math.round((r.openedCount / r.deliveredCount) * 100)
                      const expanded = expandedReportId === r.id
                      return (
                        <Fragment key={r.id}>
                          <tr
                            className="cursor-pointer border-b border-border hover:bg-muted/30"
                            onClick={() =>
                              setExpandedReportId(expanded ? null : r.id)
                            }
                          >
                            <td className="px-3 py-2 font-medium">{r.title}</td>
                            <td className="px-3 py-2">{r.targetType}</td>
                            <td className="px-3 py-2">{r.sentCount.toLocaleString('en-IN')}</td>
                            <td className="px-3 py-2 text-green-700">
                              {r.deliveredCount.toLocaleString('en-IN')}
                            </td>
                            <td className="px-3 py-2 text-blue-700">
                              {r.openedCount.toLocaleString('en-IN')}
                            </td>
                            <td className="px-3 py-2 text-red-700">
                              {r.failedCount.toLocaleString('en-IN')}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{r.sentAt}</td>
                          </tr>
                          {expanded && (
                            <tr className="border-b border-border bg-muted/20">
                              <td colSpan={7} className="px-3 py-3 text-sm">
                                <p className="text-muted-foreground">{r.body}</p>
                                <p className="mt-2 text-xs">
                                  Delivery rate:{' '}
                                  <span className="font-medium text-green-700">
                                    {deliveryRate}%
                                  </span>
                                  {' · '}
                                  Open rate:{' '}
                                  <span className="font-medium text-blue-700">{openRate}%</span>
                                  {' · '}
                                  Failed:{' '}
                                  <span className="font-medium text-red-700">
                                    {r.failedCount}
                                  </span>
                                </p>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
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

      <h1 className="text-2xl font-bold text-foreground">Tools</h1>

      {tab === 'content' && (
        <div>
          <select
            className="mb-4 h-10 w-full rounded-md border border-border bg-white px-3 text-sm lg:hidden"
            value={contentSection}
            onChange={(e) => setContentSection(e.target.value as AppContentSection)}
          >
            {APP_CONTENT_NAV.map((item) => (
              <option key={item.id} value={item.id}>
                {item.icon} {item.label}
              </option>
            ))}
          </select>

          <div className="flex min-h-[calc(100vh-180px)] overflow-hidden rounded-xl border border-border bg-card">
            <aside className="hidden h-full w-[240px] shrink-0 flex-col border-r border-border bg-white lg:flex">
              <p className="p-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                App Sections
              </p>
              <nav className="flex-1 space-y-0.5 px-2 pb-4">
                {APP_CONTENT_NAV.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setContentSection(item.id)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left transition-colors',
                      contentSection === item.id
                        ? 'border-l-2 border-primary bg-sidebar-accent text-primary'
                        : 'border-l-2 border-transparent hover:bg-muted',
                    )}
                  >
                    <span className="text-lg leading-none" aria-hidden>
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span className="block text-xs text-muted-foreground">{item.description}</span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {getContentSectionStatus(item.id)}
                      </span>
                    </span>
                  </button>
                ))}
              </nav>
            </aside>

            <div className="flex-1 overflow-y-auto bg-white p-6 lg:rounded-r-xl">
              {renderAppContentSection()}
            </div>
          </div>
        </div>
      )}

      {tab === 'mastersheet' && (
        <div className="mx-auto mt-8 max-w-[900px] space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="size-5 text-blue-600" />
                Upload
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-sm text-muted-foreground">
                Upload and manage property data using the Builtglory Master Sheet
              </p>
              <Button
                type="button"
                className="mt-4"
                onClick={() => navigate('/admin/properties/upload')}
              >
                Go to Bulk Upload →
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                The Master Sheet bulk upload is managed under Properties section for better organization.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="size-5 text-blue-600" />
                Import History
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">Date</th>
                    <th>File Name</th>
                    <th>Rows Imported</th>
                    <th>Success</th>
                    <th>Failed</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {importHistory.map((entry) => (
                    <Fragment key={entry.id}>
                      <tr className="border-b border-border">
                        <td className="py-2 whitespace-nowrap">{entry.date}</td>
                        <td className="font-mono text-xs">{entry.fileName}</td>
                        <td>{entry.rowsTotal}</td>
                        <td className="text-green-600">{entry.rowsSuccess}</td>
                        <td className={entry.rowsFailed > 0 ? 'text-red-600' : ''}>
                          {entry.rowsFailed}
                        </td>
                        <td>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-xs',
                              entry.status === 'completed' && 'bg-green-100 text-green-700',
                              entry.status === 'partial' && 'bg-amber-100 text-amber-800',
                              entry.status === 'failed' && 'bg-red-100 text-red-700',
                              entry.status === 'reverted' && 'bg-slate-100 text-slate-700',
                            )}
                          >
                            {getImportStatusBadge(entry.status)}
                          </span>
                        </td>
                        <td className="space-x-2 py-2 whitespace-nowrap">
                          <button
                            type="button"
                            className="text-primary text-xs"
                            onClick={() =>
                              setExpandedImportId((id) =>
                                id === entry.id ? null : entry.id,
                              )
                            }
                          >
                            View Details
                          </button>
                          {entry.canUndo && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 border-destructive px-2 text-xs text-destructive"
                              onClick={() => setUndoConfirmId(entry.id)}
                            >
                              Undo
                            </Button>
                          )}
                        </td>
                      </tr>
                      {expandedImportId === entry.id && (
                        <tr className="border-b bg-muted/30">
                          <td colSpan={7} className="p-4">
                            <p className="text-xs text-muted-foreground">
                              Imported by {entry.importedBy}
                            </p>
                            {entry.properties && entry.properties.length > 0 && (
                              <div className="mt-3">
                                <p className="text-xs font-medium">Imported properties</p>
                                <ul className="mt-1 space-y-1 text-xs">
                                  {entry.properties.map((p) => (
                                    <li key={p.id}>
                                      {p.id} — {p.title}
                                      {p.status ? ` (${p.status})` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {entry.failedRows && entry.failedRows.length > 0 && (
                              <div className="mt-3">
                                <p className="text-xs font-medium text-red-600">Failed rows</p>
                                <ul className="mt-1 space-y-1 text-xs text-red-600">
                                  {entry.failedRows.map((row) => (
                                    <li key={row.row}>
                                      Row {row.row} · {row.propertyId}: {row.reason}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                      {undoConfirmId === entry.id && (
                        <tr className="border-b bg-red-50/50">
                          <td colSpan={7} className="p-4">
                            <p className="text-sm font-medium">Undo this import?</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              This will remove {entry.rowsSuccess} properties added by this import
                            </p>
                            <div className="mt-3 flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => handleUndoImport(entry)}
                              >
                                Undo Import
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setUndoConfirmId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertCircle className="size-5 text-red-600" />
                Import Error Log
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (importErrors.length === 0) return
                    if (window.confirm('Clear all import errors?')) {
                      setImportErrors([])
                      showToast('Error log cleared')
                    }
                  }}
                >
                  Clear Error Log
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => showToast('Downloading error log...')}
                >
                  Export Error Log
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {importErrors.length === 0 ? (
                <p className="rounded-lg bg-green-50 p-4 text-center text-sm text-green-700">
                  No import errors
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2">Row #</th>
                      <th>Property ID</th>
                      <th>Error Reason</th>
                      <th>Import Date</th>
                      <th>File Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importErrors.map((err) => (
                      <tr key={err.id} className="border-b border-border">
                        <td className="py-2">{err.row}</td>
                        <td className="font-mono text-xs">{err.propertyId}</td>
                        <td className="text-red-600">{err.errorReason}</td>
                        <td>{err.importDate}</td>
                        <td className="font-mono text-xs">{err.fileName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'locations' && (
        <div className="mx-auto max-w-[900px] space-y-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Cities</CardTitle>
              <Button type="button" size="sm" onClick={() => { setCityFormOpen(true); setEditingCityId(null); setCityDraft({ city: '', state: '', active: true }) }}><Plus className="size-4" /> Add City</Button>
            </CardHeader>
            <CardContent>
              {cityFormOpen && (
                <div className="mb-4 space-y-2 rounded-lg border border-border p-4">
                  <input placeholder="City" value={cityDraft.city} onChange={(e) => setCityDraft((d) => ({ ...d, city: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm" />
                  <input placeholder="State" value={cityDraft.state} onChange={(e) => setCityDraft((d) => ({ ...d, state: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm" />
                  <label className="text-sm"><input type="checkbox" checked={cityDraft.active} onChange={(e) => setCityDraft((d) => ({ ...d, active: e.target.checked }))} /> Active</label>
                  <div className="flex gap-2"><Button type="button" size="sm" onClick={saveCity}>Save</Button><Button type="button" size="sm" variant="outline" onClick={() => setCityFormOpen(false)}>Cancel</Button></div>
                </div>
              )}
              {citiesWithCounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cities yet. Add a city or import properties to seed locations automatically.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-2">City</th><th>State</th><th>Properties</th><th>Active</th><th>Actions</th></tr></thead>
                  <tbody>
                    {citiesWithCounts.map((c) => (
                      <tr key={c.id} className="border-b border-border">
                        <td className="py-2 font-medium">{c.city}</td><td>{c.state}</td><td>{c.propertiesCount}</td>
                        <td>{c.active ? 'Active' : 'Inactive'}</td>
                        <td className="space-x-2 py-2">
                          <button type="button" className="text-primary text-xs" onClick={() => { setEditingCityId(c.id); setCityDraft({ city: c.city, state: c.state, active: c.active }); setCityFormOpen(true) }}>Edit</button>
                          <button type="button" className="text-destructive text-xs" onClick={() => deleteCity(c)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Localities</CardTitle>
              <div className="flex gap-2">
                {cities.length > 0 && (
                  <select value={effectiveLocalityCityFilter} onChange={(e) => setLocalityCityFilter(e.target.value)} className="h-8 rounded-md border border-border bg-input px-2 text-sm">
                    {cities.map((c) => <option key={c.id} value={c.city}>{c.city}</option>)}
                  </select>
                )}
                <Button type="button" size="sm" disabled={!cities.length} onClick={() => { setLocalityFormOpen(true); setEditingLocalityId(null); setLocalityDraft({ locality: '', city: effectiveLocalityCityFilter || cities[0]?.city || '', active: true }) }}><Plus className="size-4" /> Add Locality</Button>
              </div>
            </CardHeader>
            <CardContent>
              {!cities.length ? (
                <p className="text-sm text-muted-foreground">Add a city before managing localities.</p>
              ) : (
                <>
                  {localityFormOpen && (
                    <div className="mb-4 space-y-2 rounded-lg border border-border p-4">
                      <input placeholder="Locality" value={localityDraft.locality} onChange={(e) => setLocalityDraft((d) => ({ ...d, locality: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm" />
                      <select value={localityDraft.city || effectiveLocalityCityFilter} onChange={(e) => setLocalityDraft((d) => ({ ...d, city: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-input px-2 text-sm">{cities.map((c) => <option key={c.id} value={c.city}>{c.city}</option>)}</select>
                      <label className="text-sm"><input type="checkbox" checked={localityDraft.active} onChange={(e) => setLocalityDraft((d) => ({ ...d, active: e.target.checked }))} /> Active</label>
                      <div className="flex gap-2"><Button type="button" size="sm" onClick={saveLocality}>Save</Button><Button type="button" size="sm" variant="outline" onClick={() => setLocalityFormOpen(false)}>Cancel</Button></div>
                    </div>
                  )}
                  {filteredLocalities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No localities for {effectiveLocalityCityFilter || 'this city'} yet.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-2">Locality</th><th>City</th><th>Properties</th><th>Active</th><th>Actions</th></tr></thead>
                      <tbody>
                        {filteredLocalities.map((l) => (
                          <tr key={l.id} className="border-b border-border">
                            <td className="py-2 font-medium">{l.locality}</td><td>{l.city}</td><td>{l.propertiesCount}</td><td>{l.active ? 'Active' : 'Inactive'}</td>
                            <td className="space-x-2 py-2">
                              <button type="button" className="text-primary text-xs" onClick={() => { setEditingLocalityId(l.id); setLocalityDraft({ locality: l.locality, city: l.city, active: l.active }); setLocalityFormOpen(true) }}>Edit</button>
                              <button type="button" className="text-destructive text-xs" onClick={() => deleteLocality(l)}>Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Map Zones</CardTitle>
              <Button type="button" size="sm" disabled={!cities.length} onClick={() => { setZoneFormOpen(true); setEditingZoneId(null); setZoneDraft({ name: '', city: effectiveLocalityCityFilter || cities[0]?.city || '', coordinates: '', active: true }) }}><Plus className="size-4" /> Add Zone</Button>
            </CardHeader>
            <CardContent>
              <p className="mb-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground">Map zones define searchable areas in the app map view (B-17)</p>
              {zoneFormOpen && (
                <div className="mb-4 space-y-2 rounded-lg border border-border p-4">
                  <input placeholder="Zone name" value={zoneDraft.name} onChange={(e) => setZoneDraft((d) => ({ ...d, name: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm" />
                  <select value={zoneDraft.city || effectiveLocalityCityFilter} onChange={(e) => setZoneDraft((d) => ({ ...d, city: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-input px-2 text-sm">{cities.map((c) => <option key={c.id} value={c.city}>{c.city}</option>)}</select>
                  <input placeholder="Coordinates (lat,lng or polygon)" value={zoneDraft.coordinates} onChange={(e) => setZoneDraft((d) => ({ ...d, coordinates: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm" />
                  <label className="text-sm"><input type="checkbox" checked={zoneDraft.active} onChange={(e) => setZoneDraft((d) => ({ ...d, active: e.target.checked }))} /> Active</label>
                  <div className="flex gap-2"><Button type="button" size="sm" onClick={saveZone}>Save</Button><Button type="button" size="sm" variant="outline" onClick={() => setZoneFormOpen(false)}>Cancel</Button></div>
                </div>
              )}
              {zones.length === 0 ? (
                <p className="text-sm text-muted-foreground">No map zones yet. Add zones to power searchable areas in the customer app map.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-2">Zone Name</th><th>City</th><th>Coordinates</th><th>Active</th><th>Actions</th></tr></thead>
                  <tbody>
                    {zones.map((z) => (
                      <tr key={z.id} className="border-b border-border">
                        <td className="py-2 font-medium">{z.name}</td><td>{z.city}</td><td>{z.coordinates}</td><td>{z.active ? 'Active' : 'Inactive'}</td>
                        <td className="space-x-2 py-2">
                          <button type="button" className="text-primary text-xs" onClick={() => { setEditingZoneId(z.id); setZoneDraft({ name: z.name, city: z.city, coordinates: z.coordinates, active: z.active }); setZoneFormOpen(true) }}>Edit</button>
                          <button type="button" className="text-destructive text-xs" onClick={() => deleteZone(z)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'pricing' && (
        <div className="mx-auto max-w-[960px] space-y-6">
          <div className="rounded-xl border border-border bg-gradient-to-br from-primary/5 via-card to-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-primary">
                  Pricing &amp; Monetization
                </p>
                <h2 className="mt-1 text-xl font-semibold text-foreground">
                  Manage boost plans, packages, and active orders
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Configure seller boost tiers shown in the app (SL-14), interior packages, coupon
                  codes, and monitor featured listing boosts in one place.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border bg-card px-4 py-3 text-center shadow-sm">
                  <p className="text-2xl font-bold text-foreground">{boostOrderStats.total}</p>
                  <p className="text-xs text-muted-foreground">Total orders</p>
                </div>
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-center shadow-sm dark:border-green-900 dark:bg-green-950/40">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                    {boostOrderStats.active}
                  </p>
                  <p className="text-xs text-green-700/80 dark:text-green-400/80">Active</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-center shadow-sm">
                  <p className="text-2xl font-bold text-muted-foreground">
                    {boostOrderStats.expired}
                  </p>
                  <p className="text-xs text-muted-foreground">Expired</p>
                </div>
              </div>
            </div>
          </div>

          <Card className="overflow-hidden border-primary/10">
            <CardHeader className="border-b border-border bg-muted/30">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Rocket className="size-5 text-primary" />
                    Boost Plans
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    App screen: SL-14 · {boostPlans.filter((plan) => plan.active).length} active
                    tiers
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 p-6 md:grid-cols-3">
              {boostPlans.length === 0 ? (
                <p className="col-span-full rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No boost plans configured yet.
                </p>
              ) : (
                boostPlans.map((plan, idx) => (
                  <div
                    key={plan.id}
                    className={cn(
                      'relative flex flex-col rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md',
                      plan.active ? 'border-primary/20' : 'border-border opacity-80',
                    )}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <input
                          value={plan.name}
                          onChange={(e) =>
                            setBoostPlans((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, name: e.target.value } : p,
                              ),
                            )
                          }
                          className="h-8 w-full rounded-md border border-transparent bg-transparent px-0 text-base font-semibold focus:border-border focus:bg-input focus:px-2"
                        />
                        <input
                          value={plan.priceLabel}
                          onChange={(e) =>
                            setBoostPlans((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, priceLabel: e.target.value } : p,
                              ),
                            )
                          }
                          className="mt-1 h-7 w-full rounded-md border border-transparent bg-transparent px-0 text-sm font-medium text-primary focus:border-border focus:bg-input focus:px-2"
                          placeholder="Price"
                        />
                      </div>
                      <Badge variant={plan.active ? 'default' : 'secondary'}>
                        {plan.active ? 'Live' : 'Hidden'}
                      </Badge>
                    </div>
                    <textarea
                      value={plan.description}
                      onChange={(e) =>
                        setBoostPlans((prev) =>
                          prev.map((p, i) =>
                            i === idx ? { ...p, description: e.target.value } : p,
                          ),
                        )
                      }
                      className="mb-3 min-h-[52px] w-full rounded-md border border-border bg-input/50 px-3 py-2 text-sm"
                    />
                    <div className="mb-4 space-y-1.5">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Benefits
                      </p>
                      {plan.benefits.map((benefit, bi) => (
                        <input
                          key={bi}
                          value={benefit}
                          onChange={(e) =>
                            setBoostPlans((prev) =>
                              prev.map((p, i) =>
                                i === idx
                                  ? {
                                      ...p,
                                      benefits: p.benefits.map((x, j) =>
                                        j === bi ? e.target.value : x,
                                      ),
                                    }
                                  : p,
                              ),
                            )
                          }
                          className="h-8 w-full rounded-md border border-border bg-input px-2 text-xs"
                        />
                      ))}
                    </div>
                    <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={plan.active}
                        onChange={() =>
                          setBoostPlans((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, active: !p.active } : p)),
                          )
                        }
                      />
                      Show in app
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-auto w-full"
                      onClick={() => showToast(`${plan.name} saved`)}
                    >
                      Save plan
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-5 text-amber-500" />
                  Active Boost Orders
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Live featured listings with a {BOOST_DURATION_DAYS}-day boost window
                </p>
              </div>
              <div className="flex rounded-lg border border-border bg-muted/50 p-1">
                {(['all', 'active', 'expired'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                      boostOrderFilter === filter
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setBoostOrderFilter(filter)}
                  >
                    {filter}
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      (
                      {filter === 'all'
                        ? boostOrderStats.total
                        : filter === 'active'
                          ? boostOrderStats.active
                          : boostOrderStats.expired}
                      )
                    </span>
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {filteredBoostOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                  <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
                    <Rocket className="size-5 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-foreground">No boost orders found</p>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    {boostOrderFilter === 'active'
                      ? 'Featured properties will appear here as active boosts. Mark a property as featured from App Content → Home Screen.'
                      : boostOrderFilter === 'expired'
                        ? 'Expired or deactivated boosts will show up here.'
                        : 'Boost orders are created when properties are featured in the app.'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3">Property</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Started</th>
                      <th className="px-4 py-3">Expires</th>
                      <th className="px-4 py-3">Days left</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBoostOrders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-b border-border transition-colors hover:bg-muted/20"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{order.property}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="font-normal">
                            {order.plan}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{order.started}</td>
                        <td className="px-4 py-3 text-muted-foreground">{order.expires}</td>
                        <td className="px-4 py-3">
                          {order.status === 'expired' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={cn(
                                'font-medium',
                                order.daysLeft <= 2 ? 'text-amber-600' : 'text-foreground',
                              )}
                            >
                              {order.daysLeft} days
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                              order.status === 'active'
                                ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                                : 'bg-muted text-muted-foreground',
                            )}
                          >
                            {order.status === 'active' ? 'Active' : 'Expired'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {order.status === 'active' ? (
                            <button
                              type="button"
                              className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                              disabled={boostOrderActionId === order.id}
                              onClick={() => void deactivateBoostOrder(order)}
                            >
                              {boostOrderActionId === order.id ? 'Deactivating…' : 'Deactivate'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="text-xs font-medium text-primary hover:underline"
                              onClick={() =>
                                showToast('Renew boost — open boost modal (SL-14)')
                              }
                            >
                              Renew
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="size-5 text-blue-600" />
                Interior Design Packages
              </CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setInteriorPkgs((prev) => [
                    ...prev,
                    { id: `i${Date.now()}`, name: 'New', priceRange: '', timeline: '', active: true },
                  ])
                }
              >
                <Plus className="size-4" /> Add package
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {interiorPkgs.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No interior packages yet.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase text-muted-foreground">
                      <th className="py-2 text-left">Package</th>
                      <th>Price range</th>
                      <th>Timeline</th>
                      <th>Active</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {interiorPkgs.map((pkg, i) => (
                      <tr key={pkg.id} className="border-b border-border">
                        <td className="py-2">
                          <input
                            value={pkg.name}
                            onChange={(e) =>
                              setInteriorPkgs((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                              )
                            }
                            className="h-8 w-full min-w-[120px] rounded-md border border-border bg-input px-2"
                          />
                        </td>
                        <td>
                          <input
                            value={pkg.priceRange}
                            onChange={(e) =>
                              setInteriorPkgs((prev) =>
                                prev.map((x, j) =>
                                  j === i ? { ...x, priceRange: e.target.value } : x,
                                ),
                              )
                            }
                            className="h-8 w-full min-w-[100px] rounded-md border border-border bg-input px-2"
                          />
                        </td>
                        <td>
                          <input
                            value={pkg.timeline}
                            onChange={(e) =>
                              setInteriorPkgs((prev) =>
                                prev.map((x, j) =>
                                  j === i ? { ...x, timeline: e.target.value } : x,
                                ),
                              )
                            }
                            className="h-8 w-full min-w-[90px] rounded-md border border-border bg-input px-2"
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={pkg.active}
                            onChange={() =>
                              setInteriorPkgs((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, active: !x.active } : x)),
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-destructive text-xs hover:underline"
                            onClick={() =>
                              setInteriorPkgs((prev) => prev.filter((x) => x.id !== pkg.id))
                            }
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Tag className="size-5 text-violet-600" />
                Interior Designers
              </CardTitle>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setDesignerFormOpen(true)
                  setDesignerDraft({ name: '', phone: '', email: '', specialization: [] })
                }}
              >
                <Plus className="size-4" /> Add Designer
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {designerFormOpen && (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <input
                    placeholder="Name"
                    value={designerDraft.name}
                    onChange={(e) =>
                      setDesignerDraft((d) => ({ ...d, name: e.target.value }))
                    }
                    className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <input
                    placeholder="Phone"
                    value={designerDraft.phone}
                    onChange={(e) =>
                      setDesignerDraft((d) => ({ ...d, phone: e.target.value }))
                    }
                    className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <input
                    placeholder="Email"
                    value={designerDraft.email}
                    onChange={(e) =>
                      setDesignerDraft((d) => ({ ...d, email: e.target.value }))
                    }
                    className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                  />
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Specialization</p>
                    <div className="flex flex-wrap gap-2">
                      {DESIGNER_SPECIALIZATIONS.map((spec) => (
                        <label
                          key={spec}
                          className={cn(
                            'cursor-pointer rounded-full border px-2 py-1 text-xs',
                            designerDraft.specialization.includes(spec)
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={designerDraft.specialization.includes(spec)}
                            onChange={() =>
                              setDesignerDraft((d) => ({
                                ...d,
                                specialization: d.specialization.includes(spec)
                                  ? d.specialization.filter((s) => s !== spec)
                                  : [...d.specialization, spec],
                              }))
                            }
                          />
                          {spec}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={addDesigner}>
                      Add Designer
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setDesignerFormOpen(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {designers.map((designer) => (
                  <div
                    key={designer.id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {getDesignerInitials(designer.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{designer.name}</p>
                        <p className="text-xs text-muted-foreground">{designer.email}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {designer.specialization.map((spec) => (
                            <span
                              key={spec}
                              className="rounded-full bg-muted px-2 py-0.5 text-[10px]"
                            >
                              {spec}
                            </span>
                          ))}
                        </div>
                        <Badge variant="default" className="mt-2 font-normal">
                          {designer.activeProjects} active projects
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={designer.isAvailable}
                          onChange={() => void toggleDesignerAvailability(designer)}
                        />
                        {designer.isAvailable ? 'Available' : 'Busy'}
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="text-primary text-xs"
                          onClick={() => showToast(`Edit ${designer.name}`)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-destructive text-xs"
                          onClick={() => void removeDesigner(designer)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Ticket className="size-5 text-emerald-600" />
                Coupon Codes
              </CardTitle>
              <Button type="button" size="sm" onClick={() => setCouponFormOpen(true)}>
                <Plus className="size-4" /> Create coupon
              </Button>
            </CardHeader>
            <CardContent>
              {couponFormOpen && (
                <div className="mb-4 grid gap-2 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
                  <input placeholder="CODE" value={couponDraft.code} onChange={(e) => setCouponDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))} className="h-9 rounded-md border border-border bg-input px-3 text-sm uppercase" />
                  <select value={couponDraft.discountType} onChange={(e) => setCouponDraft((d) => ({ ...d, discountType: e.target.value as '%' | 'flat' }))} className="h-9 rounded-md border border-border bg-input px-2 text-sm"><option value="%">% discount</option><option value="flat">Flat ₹</option></select>
                  <input placeholder="Value" value={couponDraft.discountValue} onChange={(e) => setCouponDraft((d) => ({ ...d, discountValue: e.target.value }))} className="h-9 rounded-md border border-border bg-input px-3 text-sm" />
                  <select value={couponDraft.appliesTo} onChange={(e) => setCouponDraft((d) => ({ ...d, appliesTo: e.target.value }))} className="h-9 rounded-md border border-border bg-input px-2 text-sm"><option>Boost Plans</option><option>Interior</option><option>Both</option></select>
                  <input placeholder="Max uses" value={couponDraft.maxUses} onChange={(e) => setCouponDraft((d) => ({ ...d, maxUses: e.target.value }))} className="h-9 rounded-md border border-border bg-input px-3 text-sm" />
                  <input type="date" value={couponDraft.expiry} onChange={(e) => setCouponDraft((d) => ({ ...d, expiry: e.target.value }))} className="h-9 rounded-md border border-border bg-input px-3 text-sm" />
                  <label className="flex items-center text-sm sm:col-span-2"><input type="checkbox" checked={couponDraft.active} onChange={(e) => setCouponDraft((d) => ({ ...d, active: e.target.checked }))} /> Active</label>
                  <Button type="button" onClick={createCoupon}>Create</Button>
                </div>
              )}
              {coupons.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No coupon codes yet.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase text-muted-foreground">
                      <th className="py-2 text-left">Code</th>
                      <th>Discount</th>
                      <th>Type</th>
                      <th>Applies to</th>
                      <th>Uses</th>
                      <th>Expiry</th>
                      <th>Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coupons.map((c) => (
                      <tr key={c.id} className="border-b border-border">
                        <td className="py-2 font-mono font-medium">{c.code}</td>
                        <td>{c.discount}</td>
                        <td>{c.type}</td>
                        <td>{c.appliesTo}</td>
                        <td>{c.uses}</td>
                        <td>{c.expiry}</td>
                        <td>
                          <Badge variant={c.active ? 'default' : 'secondary'}>
                            {c.active ? 'Yes' : 'No'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'templates' && (
        <div className="mx-auto max-w-[900px] space-y-4">
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            These templates are used across the dashboard for WhatsApp, Email and SMS communications.
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
            {(['whatsapp', 'email', 'sms'] as TemplateChannel[]).map((ch) => (
              <button key={ch} type="button" className={cn('rounded-full px-4 py-1.5 text-sm font-medium capitalize', templateChannel === ch ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')} onClick={() => { setTemplateChannel(ch); cancelTemplateEdit(); setDeleteTemplateId(null) }}>{ch === 'sms' ? 'SMS' : ch.charAt(0).toUpperCase() + ch.slice(1)}</button>
            ))}
            </div>
            <Button type="button" size="sm" onClick={startCreateTemplate}>
              <Plus className="size-4" />
              Add Template
            </Button>
          </div>
          <div className="space-y-3">
            {creatingTemplate && (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={templateDraft.name}
                      onChange={(e) => setTemplateDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="Template name"
                      className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm font-semibold"
                    />
                    <input
                      value={templateDraft.category}
                      onChange={(e) => setTemplateDraft((d) => ({ ...d, category: e.target.value }))}
                      placeholder="Category"
                      className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  </div>
                  {templateChannel === 'email' && (
                    <input
                      value={templateDraft.subject}
                      onChange={(e) => setTemplateDraft((d) => ({ ...d, subject: e.target.value }))}
                      placeholder="Email subject"
                      className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  )}
                  <textarea
                    value={templateDraft.body}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, body: e.target.value }))}
                    placeholder="Template body"
                    className="min-h-[120px] w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                  />
                  {findUnknownTemplateVars(templateDraft.body).length > 0 && (
                    <p className="text-xs text-amber-700">
                      Unknown variables: {findUnknownTemplateVars(templateDraft.body).join(', ')}.
                      These won&apos;t be replaced in messages
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Click to insert:</p>
                  <div className="flex flex-wrap gap-1">
                    {TEMPLATE_VARS.map((v) => (
                      <button key={v} type="button" className="rounded bg-muted px-2 py-0.5 text-xs text-primary" onClick={() => insertVar(v, 'template')}>{v}</button>
                    ))}
                  </div>
                  {!templateHasVars && <p className="text-xs italic text-muted-foreground">No variables used</p>}
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={saveTemplate}>Create</Button>
                    <Button type="button" size="sm" variant="outline" onClick={cancelTemplateEdit}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {filteredTemplates.map((t) => (
              <Card key={t.id}>
                <CardContent className="p-4">
                  {editingTemplateId === t.id ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input value={templateDraft.name} onChange={(e) => setTemplateDraft((d) => ({ ...d, name: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm font-semibold" />
                        <input value={templateDraft.category} onChange={(e) => setTemplateDraft((d) => ({ ...d, category: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm" />
                      </div>
                      {t.channel === 'email' && (
                        <input value={templateDraft.subject} onChange={(e) => setTemplateDraft((d) => ({ ...d, subject: e.target.value }))} placeholder="Email subject" className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm" />
                      )}
                      <textarea value={templateDraft.body} onChange={(e) => setTemplateDraft((d) => ({ ...d, body: e.target.value }))} className="min-h-[100px] w-full rounded-md border border-border bg-input px-3 py-2 text-sm" />
                      {findUnknownTemplateVars(templateDraft.body).length > 0 && (
                        <p className="mt-1 text-xs text-amber-700">
                          Unknown variables: {findUnknownTemplateVars(templateDraft.body).join(', ')}. These
                          won&apos;t be replaced in messages
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">Click to insert:</p>
                      <div className="flex flex-wrap gap-1">{TEMPLATE_VARS.map((v) => (<button key={v} type="button" className="rounded bg-muted px-2 py-0.5 text-xs text-primary" onClick={() => insertVar(v, 'template')}>{v}</button>))}</div>
                      {!templateHasVars && editingTemplateId === t.id && <p className="text-xs text-muted-foreground italic">No variables used</p>}
                      <div className="flex gap-2"><Button type="button" size="sm" onClick={saveTemplate}>Save</Button><Button type="button" size="sm" variant="outline" onClick={cancelTemplateEdit}>Cancel</Button></div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{t.name}</p>
                        <Badge variant="default">{t.category}</Badge>
                        <Badge variant="blue">{t.channel}</Badge>
                      </div>
                      <p className="mt-2 rounded-md bg-muted p-3 text-sm">{highlightVariables(t.body)}</p>
                      {t.subject && <p className="mt-1 text-xs text-muted-foreground">Subject: {t.subject}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => startEditTemplate(t)}>Edit</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void duplicateTemplate(t)}>Duplicate</Button>
                        <Button type="button" size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => setDeleteTemplateId(t.id)}>
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
            {filteredTemplates.length === 0 && !creatingTemplate && (
              <Card>
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  No {templateChannel === 'sms' ? 'SMS' : templateChannel} templates yet.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === 'bulkmessage' && (
        <div className="mx-auto max-w-[1000px] space-y-6">
          <div className="flex gap-2 border-b border-border">
            <button
              type="button"
              className={cn(
                'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                bulkSubTab === 'compose'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setBulkSubTab('compose')}
            >
              Compose
            </button>
            <button
              type="button"
              className={cn(
                'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                bulkSubTab === 'history'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setBulkSubTab('history')}
            >
              Message History
            </button>
          </div>

          {bulkSubTab === 'history' && (
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-base">All Outgoing Messages</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {(['all', 'whatsapp', 'email'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={cn(
                        'rounded-full px-3 py-1 text-xs capitalize',
                        msgLogFilter === f
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                      onClick={() => setMsgLogFilter(f)}
                    >
                      {f === 'all' ? 'All' : f === 'whatsapp' ? '💬 WhatsApp' : '📧 Email'}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <input
                  type="search"
                  placeholder="Search by name or message…"
                  value={msgLogSearch}
                  onChange={(e) => setMsgLogSearch(e.target.value)}
                  className="h-9 w-full max-w-md rounded-md border border-border bg-input px-3 text-sm"
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs uppercase text-muted-foreground">
                        <th className="py-2 text-left">Channel</th>
                        <th className="py-2 text-left">To</th>
                        <th className="py-2 text-left">Message</th>
                        <th className="py-2 text-left">Related To</th>
                        <th className="py-2 text-left">Sent By</th>
                        <th className="py-2 text-left">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardMessages.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-muted-foreground">
                            No messages logged yet. Sends from user, enquiry, visit, and other detail pages appear here.
                          </td>
                        </tr>
                      ) : (
                        dashboardMessages.map((m) => (
                          <tr key={m.id} className="border-b align-top">
                            <td className="py-2 pr-2 whitespace-nowrap">
                              {formatChannel(m.channel)}
                            </td>
                            <td className="py-2 pr-2">
                              <p className="font-medium">{m.toName}</p>
                              <p className="text-xs text-muted-foreground">{m.to}</p>
                            </td>
                            <td className="max-w-[240px] py-2 pr-2">
                              {m.subject && (
                                <p className="text-xs font-medium text-muted-foreground">
                                  {m.subject}
                                </p>
                              )}
                              <p className="line-clamp-2">{m.message}</p>
                            </td>
                            <td className="py-2 pr-2">
                              <p className="capitalize text-xs text-muted-foreground">
                                {m.relatedTo.type}
                              </p>
                              <p>{m.relatedTo.title}</p>
                            </td>
                            <td className="py-2 pr-2 whitespace-nowrap">{m.sentBy}</td>
                            <td className="py-2 whitespace-nowrap text-muted-foreground">
                              {formatMessageTimeAgo(m.sentAt)}
                              <span className="mt-0.5 block text-xs">
                                {new Date(m.sentAt).toLocaleString('en-IN', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {bulkSubTab === 'compose' && (
        <div className="space-y-8">
          <Card>
            <CardHeader><CardTitle className="text-base">Select Recipients</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { key: 'all', label: `All Users (${users.length} users)` },
                { key: 'buyers', label: `All Buyers (${countBuyers(users)} users)` },
                { key: 'sellers', label: `All Sellers (${countSellers(users)} users)` },
                { key: 'nri', label: `NRI Users (${countNri(users)} users)` },
                { key: 'custom', label: 'Custom Filter' },
              ].map((opt) => (
                <label key={opt.key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="radio" name="bulkAud" checked={bulkAudience === opt.key} onChange={() => { setBulkAudience(opt.key); setBulkCustomFilter(opt.key === 'custom') }} />
                  {opt.label}
                </label>
              ))}
              {bulkAudience === 'custom' && (
                <div className="space-y-2 rounded-lg border border-dashed border-border p-4 text-sm">
                  <p className="font-medium">Custom filters</p>
                  <div className="flex flex-wrap gap-3">
                    {['Resident', 'NRI', 'PIO'].map((t) => (
                      <label key={t}><input type="checkbox" defaultChecked /> {t}</label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {['Buyer', 'Seller'].map((r) => (
                      <label key={r}><input type="checkbox" defaultChecked /> {r}</label>
                    ))}
                  </div>
                  <input type="date" className="h-9 rounded-md border border-border bg-input px-2" aria-label="Registered after" />
                </div>
              )}
              <p className="pt-2 text-sm font-medium text-primary">Message will be sent to {bulkRecipientCount} users</p>
              {bulkRecipientCount > 1000 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">⚠️ Large audience: {bulkRecipientCount} users</p>
                  <p className="mt-1 text-xs">
                    WhatsApp Business API limit: 1,000 messages/day
                  </p>
                  <label className="mt-3 block text-xs">
                    Type CONFIRM to proceed:
                    <input
                      value={bulkConfirmText}
                      onChange={(e) => setBulkConfirmText(e.target.value)}
                      placeholder="Type CONFIRM"
                      className="mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
                    />
                  </label>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row justify-between">
              <CardTitle className="text-base">Compose Message</CardTitle>
              <Button type="button" size="sm" variant="outline" onClick={() => setTemplatePickerOpen(true)}>Use Template</Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(['whatsapp', 'email', 'sms', 'all'] as BulkChannel[]).map((ch) => (
                  <button key={ch} type="button" className={cn('rounded-full px-3 py-1 text-sm capitalize', bulkChannel === ch ? 'bg-primary text-primary-foreground' : 'bg-muted')} onClick={() => setBulkChannel(ch)}>{ch}</button>
                ))}
              </div>
              {(bulkChannel === 'email' || bulkChannel === 'all') && (
                <input placeholder="Message title (email)" maxLength={100} value={bulkTitle} onChange={(e) => setBulkTitle(e.target.value)} className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm" />
              )}
              <textarea placeholder="Message body" value={bulkBody} onChange={(e) => setBulkBody(e.target.value)} className="min-h-[120px] w-full rounded-md border border-border bg-input px-3 text-sm" />
              <p className="text-xs text-muted-foreground">{bulkBody.length} / {bulkMaxChars} characters{bulkChannel === 'sms' && bulkBody.length > 160 && <span className="text-orange-600"> — Will split into {smsParts} messages</span>}</p>
              <div className="flex flex-wrap gap-1">{BULK_VARS.map((v) => (<button key={v} type="button" className="rounded bg-muted px-2 py-0.5 text-xs" onClick={() => insertVar(v, 'bulk')}>{v}</button>))}</div>
              <div className="rounded-lg bg-muted/50 p-3 text-sm"><strong>Preview:</strong> Hi Rajesh Kumar, {bulkBody || 'your message…'}</div>
              <fieldset className="text-sm">
                <label className="mr-4"><input type="radio" checked={bulkSchedule === 'now'} onChange={() => setBulkSchedule('now')} /> Send Now</label>
                <label><input type="radio" checked={bulkSchedule === 'later'} onChange={() => setBulkSchedule('later')} /> Schedule for Later</label>
                {bulkSchedule === 'later' && <input type="datetime-local" value={bulkScheduleAt} onChange={(e) => setBulkScheduleAt(e.target.value)} className="mt-2 block h-9 w-full rounded-md border border-border bg-input px-2" />}
              </fieldset>
              <Button
                type="button"
                className="w-full"
                disabled={
                  bulkRecipientCount === 0 ||
                  !bulkBody.trim() ||
                  (bulkRecipientCount > 1000 && bulkConfirmText !== 'CONFIRM')
                }
                onClick={() => setBulkConfirmOpen(true)}
              >
                Send to {bulkRecipientCount} Users
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Bulk Send History</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="border-b text-xs uppercase text-muted-foreground"><th className="py-2 text-left">Message</th><th>Channel</th><th>Recipients</th><th>Sent By</th><th>Date</th><th>Status</th></tr></thead>
                <tbody>{bulkHistory.map((h) => (<tr key={h.id} className="border-b"><td className="py-2">{h.message}</td><td>{h.channel}</td><td>{h.recipients}</td><td>{h.sentBy}</td><td>{h.date}</td><td><Badge variant="responded">{h.status}</Badge></td></tr>))}</tbody>
              </table>
            </CardContent>
          </Card>
        </div>
          )}
        </div>
      )}

      {pushConfirmOpen && (
        <ModalShell
          title={pushScheduleLater ? 'Schedule notification?' : 'Send notification?'}
          onClose={() => setPushConfirmOpen(false)}
        >
          <p className="text-sm">
            {pushScheduleLater ? 'Schedule for' : 'Send to'} {pushAudienceLabel}?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPushConfirmOpen(false)}>Cancel</Button>
            <Button onClick={sendPush}>Confirm</Button>
          </div>
        </ModalShell>
      )}

      {bulkConfirmOpen && (
        <ModalShell title="Confirm bulk send" onClose={() => setBulkConfirmOpen(false)}>
          <p className="text-sm">Send message to {bulkRecipientCount} users via {bulkChannel}?</p>
          <p className="mt-1 text-sm text-muted-foreground">This cannot be undone.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBulkConfirmOpen(false)}>Cancel</Button>
            <Button onClick={sendBulk}>Confirm</Button>
          </div>
        </ModalShell>
      )}

      {deleteTemplateId && (
        <ModalShell title="Delete template?" onClose={() => setDeleteTemplateId(null)}>
          <p className="text-sm">
            Delete{' '}
            <span className="font-semibold">
              {templates.find((t) => t.id === deleteTemplateId)?.name ?? 'this template'}
            </span>
            ? This removes it from the template list and bulk message picker.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTemplateId(null)}>Cancel</Button>
            <Button className="bg-red-600 text-white hover:bg-red-700" onClick={confirmDeleteTemplate}>
              Delete
            </Button>
          </div>
        </ModalShell>
      )}

      {templatePickerOpen && (
        <ModalShell title="Select template" onClose={() => setTemplatePickerOpen(false)}>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {templates.filter((t) => bulkChannel === 'all' || t.channel === bulkChannel).map((t) => (
              <li key={t.id}>
                <button type="button" className="w-full rounded border border-border px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setBulkBody(t.body); setTemplatePickerOpen(false) }}>{t.name}</button>
              </li>
            ))}
          </ul>
        </ModalShell>
      )}

      {legalPreview && (
        <ModalShell
          title={legalPreview === 'terms' ? 'Terms & Conditions (A-06)' : 'Privacy Policy (A-07)'}
          onClose={() => setLegalPreview(null)}
        >
          <div className="mx-auto max-w-[280px] rounded-[2rem] border-8 border-foreground bg-muted p-2">
            <div className="rounded-[1.25rem] bg-card p-4">
              <p className="text-center text-xs font-semibold text-primary">BuiltGlory</p>
              <p className="mt-2 text-center text-sm font-semibold">
                {legalPreview === 'terms' ? 'Terms & Conditions' : 'Privacy Policy'}
              </p>
              <div className="mt-3 max-h-[360px] overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {legalPreview === 'terms' ? termsContent : privacyContent}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="outline" onClick={() => setLegalPreview(null)}>
              Close
            </Button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}

function AppContentSectionHeader({
  title,
  screen,
  description,
}: {
  title: string
  screen: string
  description: string
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        <Badge variant="default" className="font-normal">
          📱 App screen: {screen}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  )
}
