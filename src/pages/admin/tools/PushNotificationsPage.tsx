import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, RefreshCw, Send } from 'lucide-react'
import { readAdminSession } from '@/api/admin'
import {
  listAdminPushNotifications,
  retryAdminPushNotification,
  sendAdminPushNotification,
  type AdminPushNotification,
  type PushAudience,
  type PushNotificationType,
} from '@/api/adminPushNotifications'
import { listAdminUsers, type User } from '@/api/adminUsers'
import { resolveMasterDeepLink } from '@/utils/notifications'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const NOTIFICATION_TYPES: Array<{ value: PushNotificationType; label: string; screen: string }> = [
  { value: 'N-01', label: 'N-01 Enquiry Submitted (Buyer → P-08)', screen: 'P-08' },
  { value: 'N-02', label: 'N-02 Executive Call (Buyer P-08 / Seller P-05)', screen: 'P-08' },
  { value: 'N-03', label: 'N-03 Visit Scheduled (Buyer → B-12)', screen: 'B-12' },
  { value: 'N-04', label: 'N-04 Offer Sent (Seller → SL-12)', screen: 'SL-12' },
  { value: 'N-05', label: 'N-05 Deal Confirmed (Buyer B-13 / Seller SL-14)', screen: 'B-13' },
  { value: 'N-06', label: 'N-06 Docs / Re-upload (Buyer B-14 / Seller SL-11)', screen: 'B-14' },
  { value: 'N-07', label: 'N-07 Payment (Buyer B-15 / Seller SL-15)', screen: 'B-15' },
  { value: 'N-08', label: 'N-08 Registration (Buyer B-16 / Seller SL-16)', screen: 'B-16' },
  { value: 'MANUAL', label: 'Manual', screen: 'home' },
]

const fieldClass = 'mt-1 h-9 w-full rounded-md border border-border bg-input px-3 text-sm'
const labelClass = 'text-sm font-medium text-slate-700'

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'sent' || status === 'delivered') return 'default'
  if (status === 'failed' || status === 'dead_letter') return 'destructive'
  return 'secondary'
}

function formatWhen(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function PushNotificationsPage() {
  const session = readAdminSession()
  const [users, setUsers] = useState<User[]>([])
  const [history, setHistory] = useState<AdminPushNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [audience, setAudience] = useState<PushAudience>('buyer')
  const [userId, setUserId] = useState('')
  const [notificationType, setNotificationType] = useState<PushNotificationType>('MANUAL')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [listingId, setListingId] = useState('')
  const [enquiryId, setEnquiryId] = useState('')
  const [dealId, setDealId] = useState('')
  const [propertyId, setPropertyId] = useState('')

  const [statusFilter, setStatusFilter] = useState<string>('')

  const selectedType = useMemo(
    () => NOTIFICATION_TYPES.find((item) => item.value === notificationType) ?? NOTIFICATION_TYPES[0],
    [notificationType],
  )

  const resolvedDeepLink = useMemo(
    () =>
      notificationType === 'MANUAL'
        ? selectedType.screen
        : resolveMasterDeepLink(notificationType, audience) || selectedType.screen,
    [audience, notificationType, selectedType.screen],
  )

  const filteredUsers = useMemo(
    () =>
      users.filter((user) => {
        if (audience === 'buyer') return user.role === 'buyer' || user.role === 'both'
        return user.role === 'seller' || user.role === 'both'
      }),
    [audience, users],
  )

  const loadData = useCallback(async () => {
    if (!session?.accessToken) {
      setError('Admin session expired. Please sign in again.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [usersResult, historyResult] = await Promise.all([
        listAdminUsers(session.accessToken, { limit: 100 }),
        listAdminPushNotifications(session.accessToken, {
          limit: 50,
          channel: 'push',
          ...(statusFilter ? { status: statusFilter } : {}),
        }),
      ])
      setUsers(usersResult.data ?? [])
      setHistory(historyResult.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load push notifications.')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, statusFilter])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSend = async () => {
    if (!session?.accessToken) return
    if (!userId || !title.trim() || !message.trim()) {
      setError('User, title, and message are required.')
      return
    }
    setSending(true)
    setError('')
    setSuccess('')
    try {
      await sendAdminPushNotification(session.accessToken, {
        userId,
        audience,
        notificationType,
        title: title.trim(),
        message: message.trim(),
        screen: resolvedDeepLink,
        listingId: listingId || undefined,
        enquiryId: enquiryId || undefined,
        dealId: dealId || undefined,
        propertyId: propertyId || undefined,
      })
      setSuccess('Push notification sent.')
      setTitle('')
      setMessage('')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send push notification.')
    } finally {
      setSending(false)
    }
  }

  const handleRetry = async (notificationId: string) => {
    if (!session?.accessToken) return
    setError('')
    try {
      await retryAdminPushNotification(session.accessToken, notificationId)
      setSuccess('Notification retry queued.')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.')
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Push Notifications</h1>
          <p className="text-sm text-slate-500">
            Send manual notifications, review delivery history, and retry failed pushes.
          </p>
        </div>
        <Button variant="outline" onClick={() => loadData()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Send className="h-5 w-5" />
              Send Notification
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className={labelClass}>Audience</label>
              <select className={fieldClass} value={audience} onChange={(event) => setAudience(event.target.value as PushAudience)}>
                <option value="buyer">Buyer</option>
                <option value="seller">Seller</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>User</label>
              <select className={fieldClass} value={userId} onChange={(event) => setUserId(event.target.value)}>
                <option value="">Select user</option>
                {filteredUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.phone})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Notification Type</label>
              <select
                className={fieldClass}
                value={notificationType}
                onChange={(event) => setNotificationType(event.target.value as PushNotificationType)}
              >
                {NOTIFICATION_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Title</label>
              <input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Notification title" />
            </div>

            <div>
              <label className={labelClass}>Message</label>
              <textarea
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Notification message"
                rows={4}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Listing ID</label>
                <input className={fieldClass} value={listingId} onChange={(event) => setListingId(event.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Enquiry ID</label>
                <input className={fieldClass} value={enquiryId} onChange={(event) => setEnquiryId(event.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Deal ID</label>
                <input className={fieldClass} value={dealId} onChange={(event) => setDealId(event.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Property ID</label>
                <input className={fieldClass} value={propertyId} onChange={(event) => setPropertyId(event.target.value)} />
              </div>
            </div>

            <Button onClick={handleSend} disabled={sending} className="w-full">
              {sending ? 'Sending...' : 'Send Push Notification'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bell className="h-5 w-5" />
              Notification History
            </CardTitle>
            <div className="mt-3">
              <label className={labelClass}>Delivery Status</label>
              <select
                className={fieldClass}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">All statuses</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="failed">Failed</option>
                <option value="dead_letter">Dead Letter</option>
                <option value="queued">Queued</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? <p className="text-sm text-slate-500">Loading notification history...</p> : null}
            {!loading && history.length === 0 ? (
              <p className="text-sm text-slate-500">No push notifications yet.</p>
            ) : null}
            <div className="space-y-3">
              {history.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900">{item.title}</p>
                        <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{item.message}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        {item.notificationType || 'MANUAL'} • Screen {item.screen || '—'} • Sent {formatWhen(item.sentAt || item.createdAt)}
                      </p>
                      {item.failureReason ? (
                        <p className="mt-1 text-xs text-red-600">{item.failureReason}</p>
                      ) : null}
                    </div>
                    {item.status === 'failed' || item.status === 'dead_letter' ? (
                      <Button size="sm" variant="outline" onClick={() => handleRetry(item.id)}>
                        Retry
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
