import { readAdminSession } from '@/api/admin'
import { sendWorkflowPush, type WorkflowEntityType } from '@/api/adminWorkflow'

export type NotificationAudience = 'buyer' | 'seller'

export type NotificationTemplate = {
  title: string
  body: string
  deepLink: string
  audience?: NotificationAudience
}

/**
 * Master Document Part 8 — audience-specific deep links for N-01..N-08.
 */
export const MASTER_NOTIFICATION_DEEP_LINKS: Record<
  string,
  { buyer?: string; seller?: string }
> = {
  'N-01': { buyer: 'P-08' },
  'N-02': { buyer: 'P-08', seller: 'P-05' },
  'N-03': { buyer: 'B-12' },
  'N-04': { seller: 'SL-12', buyer: 'SL-12' },
  'N-05': { buyer: 'B-13', seller: 'SL-14' },
  'N-06': { buyer: 'B-14', seller: 'SL-11' },
  'N-07': { buyer: 'B-15', seller: 'SL-15' },
  'N-08': { buyer: 'B-16', seller: 'SL-16' },
}

export function resolveMasterDeepLink(
  notificationType: string,
  audience: NotificationAudience = 'buyer',
): string {
  const normalized = notificationType.trim().toUpperCase().replace(/^N(\d)$/, 'N-0$1')
  const digits = normalized.replace(/\D/g, '')
  const code = digits.length ? `N-${digits.padStart(2, '0')}` : normalized
  const entry = MASTER_NOTIFICATION_DEEP_LINKS[code]
  if (!entry) return ''
  return (audience === 'seller' && entry.seller) || entry.buyer || entry.seller || ''
}

/**
 * Master Document Part 8 — Notification Map.
 * Buyer: N-01→P-08, N-02→P-08, N-03→B-12, N-05→B-13, N-06→B-14, N-07→B-15, N-08→B-16
 * Seller: N-02→P-05, N-04→SL-12, N-05→SL-14, N-06→SL-11, N-07→SL-15, N-08→SL-16
 */
export const NOTIFICATION_TEMPLATES = {
  N01_ENQUIRY_SUBMITTED: (_buyerName: string, _propertyTitle?: string): NotificationTemplate => ({
    title: 'Enquiry Received',
    body: 'Your enquiry has been received. Our team will contact you within 24 hours.',
    deepLink: 'P-08',
    audience: 'buyer',
  }),

  N02_ENQUIRY_RESPONDED: (_buyerName: string, _propertyTitle?: string): NotificationTemplate => ({
    title: 'Executive Call',
    body: 'A Builtglory executive will call you shortly.',
    deepLink: 'P-08',
    audience: 'buyer',
  }),

  N02_SELLER_STATUS: (_sellerName: string, propertyTitle: string): NotificationTemplate => ({
    title: 'Listing Update',
    body: `A Builtglory executive will call you shortly about "${propertyTitle}".`,
    deepLink: 'P-05',
    audience: 'seller',
  }),

  N02_LISTING_APPROVED: (_sellerName: string, propertyTitle: string): NotificationTemplate => ({
    title: 'Listing Approved! 🎉',
    body: `Your listing "${propertyTitle}" is now live on Builtglory!`,
    deepLink: 'P-05',
    audience: 'seller',
  }),

  N03_VISIT_SCHEDULED: (
    _buyerName: string,
    propertyTitle: string,
    date?: string,
    time?: string,
  ): NotificationTemplate => ({
    title: 'Visit Scheduled',
    body:
      date && time
        ? `Your visit for ${propertyTitle} is scheduled for ${date} at ${time}. Tap to view details.`
        : `Your visit has been scheduled. Tap to view details.`,
    deepLink: 'B-12',
    audience: 'buyer',
  }),

  N03_VISIT_CONFIRMED: (
    _buyerName: string,
    propertyTitle: string,
    date: string,
    time: string,
  ): NotificationTemplate => ({
    title: 'Visit Confirmed! 📅',
    body: `Your visit for ${propertyTitle} is confirmed for ${date} at ${time}. Tap to view details.`,
    deepLink: 'B-12',
    audience: 'buyer',
  }),

  N03_VISIT_REMINDER: (
    _buyerName: string,
    propertyTitle: string,
    time: string,
  ): NotificationTemplate => ({
    title: 'Visit Reminder 🔔',
    body: `Reminder: Your visit for ${propertyTitle} is tomorrow at ${time}. See you there!`,
    deepLink: 'B-12',
    audience: 'buyer',
  }),

  N03_VISIT_CANCELLED: (
    _buyerName: string,
    propertyTitle: string,
    reason: string,
  ): NotificationTemplate => ({
    title: 'Visit Cancelled',
    body: `Your visit for ${propertyTitle} was cancelled. Reason: ${reason}`,
    deepLink: 'B-12',
    audience: 'buyer',
  }),

  N04_OFFER_SENT: (_sellerName: string, propertyTitle: string): NotificationTemplate => ({
    title: 'Offer Received',
    body: `Builtglory has sent you an offer for "${propertyTitle}". Valid for 48 hours. Tap to view.`,
    deepLink: 'SL-12',
    audience: 'seller',
  }),

  N05_DEAL_CONFIRMED_BUYER: (_buyerName: string, propertyTitle?: string): NotificationTemplate => ({
    title: 'Deal Confirmed',
    body: propertyTitle
      ? `Your deal for ${propertyTitle} has been confirmed. Tap to view next steps.`
      : 'Your deal has been confirmed. Tap to view next steps.',
    deepLink: 'B-13',
    audience: 'buyer',
  }),

  N05_DEAL_CONFIRMED_SELLER: (_sellerName: string, propertyTitle?: string): NotificationTemplate => ({
    title: 'Deal Confirmed',
    body: propertyTitle
      ? `Your deal for ${propertyTitle} has been confirmed. Tap to view next steps.`
      : 'Your deal has been confirmed. Tap to view next steps.',
    deepLink: 'SL-14',
    audience: 'seller',
  }),

  N06_DOCS_SHARED: (_buyerName: string, propertyTitle?: string): NotificationTemplate => ({
    title: 'Documents Ready',
    body: propertyTitle
      ? `Documents are ready for ${propertyTitle}.`
      : 'Documents are ready.',
    deepLink: 'B-14',
    audience: 'buyer',
  }),

  N06_REUPLOAD_REQUIRED: (
    _sellerName: string,
    propertyTitle: string,
    reason?: string,
  ): NotificationTemplate => ({
    title: 'Re-upload Required',
    body: reason
      ? `Action required: re-upload documents for "${propertyTitle}". ${reason}`
      : `Action required: re-upload documents for "${propertyTitle}".`,
    deepLink: 'SL-11',
    audience: 'seller',
  }),

  N07_PAYMENT_BUYER: (_buyerName: string, propertyTitle?: string): NotificationTemplate => ({
    title: 'Payment Update',
    body: propertyTitle
      ? `Complete your token payment for ${propertyTitle}.`
      : 'Complete your token payment.',
    deepLink: 'B-15',
    audience: 'buyer',
  }),

  N07_PAYMENT_SELLER: (_sellerName: string, propertyTitle?: string): NotificationTemplate => ({
    title: 'Payment Schedule',
    body: propertyTitle
      ? `View your payment schedule for "${propertyTitle}".`
      : 'View your payment schedule.',
    deepLink: 'SL-15',
    audience: 'seller',
  }),

  N08_REGISTRATION: (_name: string, audience: NotificationAudience = 'buyer'): NotificationTemplate => ({
    title: 'Registration Confirmed',
    body: 'Your registration appointment is confirmed. Tap to view details.',
    deepLink: audience === 'seller' ? 'SL-16' : 'B-16',
    audience,
  }),

  // Legacy aliases used by existing detail pages
  N06_LISTING_APPROVED: (_sellerName: string, propertyTitle: string): NotificationTemplate => ({
    title: 'Listing Approved! 🎉',
    body: `Your listing "${propertyTitle}" is now live on Builtglory!`,
    deepLink: 'P-05',
    audience: 'seller',
  }),

  N07_LISTING_REJECTED: (
    _sellerName: string,
    propertyTitle: string,
    reason: string,
  ): NotificationTemplate => ({
    title: 'Listing Needs Changes',
    body: `Your listing "${propertyTitle}" needs changes: ${reason}`,
    deepLink: 'SL-11',
    audience: 'seller',
  }),

  N04_VISIT_REMINDER: (
    buyerName: string,
    propertyTitle: string,
    time: string,
  ): NotificationTemplate =>
    NOTIFICATION_TEMPLATES.N03_VISIT_REMINDER(buyerName, propertyTitle, time),

  N05_VISIT_CANCELLED: (
    buyerName: string,
    propertyTitle: string,
    reason: string,
  ): NotificationTemplate =>
    NOTIFICATION_TEMPLATES.N03_VISIT_CANCELLED(buyerName, propertyTitle, reason),

  N09_INTERIOR_QUOTE: (_buyerName: string, propertyTitle: string): NotificationTemplate => ({
    title: 'Interior Quote Ready! 🛋️',
    body: `Your interior design quote for ${propertyTitle} is ready. Valid for 72 hours.`,
    deepLink: 'INT-05 Price Confirmation',
  }),

  N10_STAGE_PAYMENT_PLAN: (_buyerName: string, propertyTitle: string): NotificationTemplate => ({
    title: 'Payment Plan Ready! 💳',
    body: `Your stage payment plan for ${propertyTitle} is ready. Valid for 72 hours.`,
    deepLink: 'B-15',
    audience: 'buyer',
  }),

  N11_MILESTONE_VERIFIED: (_buyerName: string, stageName: string): NotificationTemplate => ({
    title: 'Milestone Verified! ✅',
    body: `${stageName} has been verified. Next payment stage is now active.`,
    deepLink: 'B-15',
    audience: 'buyer',
  }),

  N12_MILESTONE_REJECTED: (
    _buyerName: string,
    stageName: string,
    reason: string,
  ): NotificationTemplate => ({
    title: 'Proof Needs Resubmission',
    body: `${stageName} proof rejected: ${reason}. Please reupload.`,
    deepLink: 'B-15',
    audience: 'buyer',
  }),

  N15_UPCOMING_LAUNCH: (propertyTitle: string): NotificationTemplate => ({
    title: 'Property Launching Soon! 🏠',
    body: `"${propertyTitle}" launches in 24 hours! Be ready to enquire.`,
    deepLink: 'B-04 Property Detail',
  }),

  N16_PRICE_DROP: (
    propertyTitle: string,
    oldPrice: string,
    newPrice: string,
  ): NotificationTemplate => ({
    title: 'Price Dropped! 📉',
    body: `"${propertyTitle}" price reduced from ${oldPrice} to ${newPrice}.`,
    deepLink: 'B-04 Property Detail',
  }),

  N17_INTERIOR_CONFIRMED: (_buyerName: string): NotificationTemplate => ({
    title: 'Interior Order Confirmed! 🛋️',
    body: 'Your interior design order is confirmed. Work begins soon!',
    deepLink: 'INT-06 Deal Confirmed',
  }),

  N18_DOCUMENT_REQUESTED: (
    _partyName: string,
    documentName: string,
    propertyTitle: string,
  ): NotificationTemplate => ({
    title: 'Document Required 📄',
    body: `Please upload "${documentName}" for ${propertyTitle} on the app.`,
    deepLink: 'B-14',
    audience: 'buyer',
  }),
}

const recentNotificationKeys = new Map<string, number>()

export function wasNotificationSentRecently(
  key: string,
  windowMs = 30 * 60 * 1000,
): boolean {
  const last = recentNotificationKeys.get(key)
  return last != null && Date.now() - last < windowMs
}

export function markNotificationSent(key: string) {
  recentNotificationKeys.set(key, Date.now())
}

export type SendPushOptions = {
  skipDuplicateCheck?: boolean
  dedupeKey?: string
  userId?: string | null
  audience?: NotificationAudience
  relatedTo?: {
    type: WorkflowEntityType
    id: string
  }
}

/** Sends workflow-backed push notifications and returns a user-facing result message. */
export async function sendPushNotification(
  userName: string,
  template: NotificationTemplate,
  notificationId: string,
  options?: SendPushOptions,
): Promise<string> {
  const dedupeKey = options?.dedupeKey ?? `${notificationId}:${options?.relatedTo?.type ?? 'manual'}:${options?.relatedTo?.id ?? userName}`;
  if (!options?.skipDuplicateCheck && wasNotificationSentRecently(dedupeKey)) {
    return `Similar notification sent recently (${notificationId})`
  }

  const session = readAdminSession()
  if (!session?.accessToken || !options?.relatedTo) {
    return `Push notification not sent: backend workflow target is unavailable (${notificationId})`
  }

  try {
    await sendWorkflowPush(session.accessToken, options.relatedTo.type, options.relatedTo.id, {
      userId: options.userId,
      recipient: userName,
      notificationId,
      audience: options.audience || template.audience,
      template: {
        title: template.title,
        body: template.body,
        deepLink: template.deepLink,
      },
      dedupeKey,
      skipDuplicateCheck: true,
    })
    markNotificationSent(dedupeKey)
    return `Push notification sent to ${userName}: "${template.title}"`
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Push notification failed.'
    return `Push notification failed for ${userName}: ${message}`
  }
}
