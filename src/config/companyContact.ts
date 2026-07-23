const DEFAULT_SUPPORT_PHONE_DISPLAY = '+91 8667769670'
const DEFAULT_WHATSAPP_DIGITS = '918667769670'

export const phoneDigits = (phone: string) => phone.replace(/\D/g, '')

const configuredPhone =
  (import.meta.env.VITE_COMPANY_SUPPORT_PHONE as string | undefined)?.trim() ||
  DEFAULT_SUPPORT_PHONE_DISPLAY

export const COMPANY_SUPPORT_PHONE_DISPLAY = configuredPhone

export const COMPANY_SUPPORT_PHONE_E164 = `+${phoneDigits(configuredPhone)}`

export const COMPANY_WHATSAPP_DIGITS =
  (import.meta.env.VITE_COMPANY_WHATSAPP_NUMBER as string | undefined)?.trim() ||
  phoneDigits(configuredPhone) ||
  DEFAULT_WHATSAPP_DIGITS

export const COMPANY_WHATSAPP_URL = `https://wa.me/${COMPANY_WHATSAPP_DIGITS}`

export const COMPANY_TEL_URL = `tel:${COMPANY_SUPPORT_PHONE_E164}`

export const COMPANY_SUPPORT_WHATSAPP_MESSAGE =
  'Hi BuiltGlory team, I need support regarding '

export function buildCompanyWhatsAppUrl(message = COMPANY_SUPPORT_WHATSAPP_MESSAGE) {
  const text = message.trim()
  return text
    ? `${COMPANY_WHATSAPP_URL}?text=${encodeURIComponent(text)}`
    : COMPANY_WHATSAPP_URL
}

export function openCompanyWhatsApp(message = COMPANY_SUPPORT_WHATSAPP_MESSAGE) {
  window.open(buildCompanyWhatsAppUrl(message), '_blank', 'noopener,noreferrer')
}

export function openCompanyCall() {
  window.location.href = COMPANY_TEL_URL
}
