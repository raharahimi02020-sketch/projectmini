import {
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import './App.css'
import {
  LANGUAGE_STORAGE_KEY,
  createTranslator,
  languageOptions,
  type AppLanguage,
} from './i18n'
import { getTelegramUser, initTelegramShell, pulseTelegram } from './lib/telegram'
import { loadPersistentState, savePersistentState } from './lib/storage'
import type {
  AdminTab,
  Campaign,
  CustomerSnapshot,
  FAQItem,
  Notice,
  Order,
  PaymentMethod,
  Plan,
  PlanCategory,
  Screen,
  Server,
  ServiceStatus,
  SupportTicket,
  UserProfile,
  UserService,
} from './types'

type PurchaseIntent =
  | { mode: 'buy' | 'renew' | 'upgrade'; planId: string; serviceId?: string }
  | null

type PurchaseNotificationPayload = {
  orderId: string
  createdAt: string
  kind: Order['kind']
  amount: number
  paymentMethod: PaymentMethod
  promoCode?: string
  user: {
    telegramId?: number
    firstName: string
    username: string
    city: string
  }
  plan: {
    id: string
    name: string
    durationDays: number
    deviceLimit: number
    protocols: string[]
    locations: string[]
  }
  service?: {
    region: string
    protocol: string
    expiresAt: string
    configCode: string
  }
}

type NewServiceDraft = {
  planId: string
  region: string
  protocol: string
  expiresAt: string
  devicesInUse: number
}

const navItems: Array<{ id: Exclude<Screen, 'admin'>; label: string; icon: typeof HomeIcon }> = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'plans', label: 'Plans', icon: LayersIcon },
  { id: 'services', label: 'Orders', icon: ShieldIcon },
  { id: 'support', label: 'Support', icon: ChatIcon },
  { id: 'profile', label: 'Profile', icon: UserIcon },
]

const adminTabs: Array<{ id: AdminTab; label: string }> = [
  { id: 'dashboard', label: 'داشبورد' },
  { id: 'services', label: 'سرویس‌ها' },
  { id: 'orders', label: 'سفارش‌ها' },
  { id: 'users', label: 'کاربران' },
  { id: 'plans', label: 'پلن‌ها' },
  { id: 'campaigns', label: 'تخفیف‌ها' },
  { id: 'broadcast', label: 'اطلاع‌رسانی' },
  { id: 'faq', label: 'FAQ' },
]

const planCategories: Array<{ id: PlanCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'starter', label: 'Starter' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'family', label: 'Family' },
  { id: 'unlimited', label: 'Unlimited' },
  { id: 'business', label: 'Business' },
]

const paymentOptions: Array<{ id: PaymentMethod; label: string }> = [
  { id: 'card', label: 'Card' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'wallet', label: 'Wallet' },
]

const bankTransferDetails = {
  note: 'Payment details',
  warning: 'Please upload the receipt after payment.',
  bank: 'Parsian Bank - Abedi',
  cardNumber: '6221061219677137',
  iban: 'IR280540109180021431636005',
} as const

const cryptoTransferDetails = {
  note: 'Wallet addresses',
  warning: 'Please upload the receipt after payment.',
  wallets: [
    { id: 'tron', asset: 'USDT', network: 'TRON', address: 'TFEgn9u5vV3tMUSaYeuWmkaAv5ec3nmGvd' },
    { id: 'ethereum', asset: 'USDT', network: 'Ethereum', address: '0x5eF41585E58E4DfF685e7bbDb7782E6741FcBA1B' },
    { id: 'ton', asset: 'USDT', network: 'TON', address: 'UQCijclDg_rAzZRjmlsgDA12YH2w3ABPlsH2vJOtoJVwjtRd' },
  ],
} as const

const orderStatusOptions: Array<Order['status']> = ['paid', 'processing']
const orderKindOptions: Array<Order['kind']> = ['purchase', 'renew', 'upgrade', 'trial']
const serviceStatusOptions: ServiceStatus[] = ['active', 'trial', 'expiring', 'expired']
const accentOptions = ['lime', 'ice', 'amber'] as const

const setupGuides = [
  {
    platform: 'iPhone',
    client: 'V2Box',
    linkLabel: 'App Store',
    url: 'https://apps.apple.com/us/app/v2box-v2ray-client/id6446814690',
    steps: ['Install from the App Store', 'Import your config', 'Tap connect'],
  },
  {
    platform: 'Android',
    client: 'v2rayNG',
    linkLabel: 'GitHub',
    url: 'https://github.com/2dust/v2rayNG/releases',
    steps: ['Install from GitHub', 'Import your config', 'Enable VPN'],
  },
  {
    platform: 'Windows',
    client: 'v2rayN',
    linkLabel: 'Releases',
    url: 'https://github.com/2dust/v2rayN/releases',
    steps: ['Download the desktop release', 'Import your config', 'Launch the app'],
  },
  {
    platform: 'macOS',
    client: 'v2rayN',
    linkLabel: 'Releases',
    url: 'https://github.com/2dust/v2rayN/releases',
    steps: ['Download the macOS release', 'Import your config', 'Enable system proxy'],
  },
]

const daysRemaining = (value: string) =>
  Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))

const averageLatency = (servers: Server[]) => {
  const live = servers.filter((s) => s.status !== 'maintenance')
  if (!live.length) return 0
  return Math.round(live.reduce((sum, s) => sum + s.latency, 0) / live.length)
}

const makeId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const splitCsv = (value: string) =>
  value.split(',').map((item) => item.trim()).filter(Boolean)

const joinCsv = (items: string[]) => items.join(', ')

const toDateInputValue = (value: string) => value.slice(0, 10)

const toIsoDate = (value: string) =>
  value ? new Date(`${value}T12:00:00.000Z`).toISOString() : new Date().toISOString()

const createEmptyPlanDraft = (): Plan => ({
  id: '',
  name: '',
  category: 'starter',
  subtitle: '',
  description: '',
  badge: '',
  featured: false,
  price: 189000,
  durationDays: 30,
  deviceLimit: 2,
  locations: ['Germany'],
  speedTier: 'Fast',
  dataCap: 'Unlimited',
  protocols: ['VLESS'],
  accent: 'lime',
  perks: ['Instant delivery'],
})

const createEmptyCampaignDraft = (): Campaign => ({
  id: '',
  title: '',
  description: '',
  code: '',
  discountPercent: 10,
  reward: '',
  active: true,
})

const createEmptyFaqDraft = (): FAQItem => ({ id: '', question: '', answer: '' })

const createEmptyServiceDraft = (plans: Plan[]): NewServiceDraft => ({
  planId: plans[0]?.id ?? '',
  region: 'Germany',
  protocol: 'VLESS',
  expiresAt: toIsoDate(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  ),
  devicesInUse: 1,
})

const resolvePrimaryService = (services: UserService[]) =>
  services.find((s) => s.status !== 'expired') ?? services[0]

const paidLifetimeValue = (orders: Order[]) =>
  orders.reduce((sum, o) => sum + (o.status === 'paid' ? o.amount : 0), 0)

const buildPrimaryCustomerSnapshot = (
  profile: UserProfile,
  services: UserService[],
  orders: Order[],
): CustomerSnapshot => {
  const primary = resolvePrimaryService(services)
  return {
    id: profile.id,
    name: profile.firstName,
    handle: `@${profile.username}`,
    city: profile.city,
    activePlan: primary?.planName ?? 'No active plan',
    status: primary?.status ?? 'expired',
    lifetimeValue: paidLifetimeValue(orders),
    walletCredit: profile.walletCredit,
  }
}

const syncPrimaryCustomer = (
  profile: UserProfile,
  services: UserService[],
  orders: Order[],
  customers: CustomerSnapshot[],
) => {
  const next = buildPrimaryCustomerSnapshot(profile, services, orders)
  return customers.some((c) => c.id === next.id)
    ? customers.map((c) => (c.id === next.id ? { ...c, ...next } : c))
    : [next, ...customers]
}

const buildConfigText = (service: UserService) =>
  [
    '# LIAN config',
    `plan=${service.planName}`,
    `region=${service.region}`,
    `protocol=${service.protocol}`,
    `code=${service.configCode}`,
    `devices=${service.deviceLimit}`,
    `expires_at=${service.expiresAt}`,
  ].join('\n')

const slugify = (value: string) => value.toLowerCase().replace(/\s+/g, '-')

const statusLabel = (status: ServiceStatus) => {
  switch (status) {
    case 'active': return 'Active'
    case 'trial': return 'Trial'
    case 'expiring': return 'Expiring'
    default: return 'Expired'
  }
}

const ticketStatusLabel = (status: SupportTicket['status']) => {
  switch (status) {
    case 'open': return 'Open'
    case 'pending': return 'Pending'
    default: return 'Resolved'
  }
}

const createExpiry = (base: Date, durationDays: number) => {
  const next = new Date(base)
  next.setDate(next.getDate() + durationDays)
  return next.toISOString()
}

const chooseBestServer = (servers: Server[], plan: Plan) => {
  const candidates = servers
    .filter(
      (s) =>
        s.status !== 'maintenance' &&
        plan.locations.some((loc) => loc === s.country),
    )
    .sort((a, b) => a.load - b.load || a.latency - b.latency)
  return candidates[0] ?? servers[0]
}

const buildServiceForOrder = (
  plan: Plan,
  servers: Server[],
  profile: UserProfile,
  orderId: string,
  serviceId: string,
): UserService => {
  const server = chooseBestServer(servers, plan)
  return {
    id: serviceId,
    planId: plan.id,
    planName: plan.name,
    status: plan.durationDays <= 30 ? 'expiring' : 'active',
    expiresAt: createExpiry(new Date(), plan.durationDays),
    devicesInUse: 1,
    deviceLimit: plan.deviceLimit,
    region: server.country,
    protocol: plan.protocols[0],
    configCode: `LIAN://${slugify(plan.name)}/${slugify(profile.username)}/${serviceId}`,
    orderId,
    latency: server.latency,
    uptime: '99.95%',
  }
}

const fulfillOrder = (
  services: UserService[],
  plans: Plan[],
  servers: Server[],
  profile: UserProfile,
  order: Order,
) => {
  const livePlan = plans.find((p) => p.id === order.planId)
  if (!livePlan) return { services, fulfilledService: undefined as UserService | undefined }

  if (order.kind === 'purchase' || order.kind === 'trial') {
    const next = buildServiceForOrder(
      livePlan,
      servers,
      profile,
      order.id,
      order.serviceId ?? makeId('svc'),
    )
    return {
      services: [next, ...services.filter((s) => s.orderId !== order.id && s.id !== next.id)],
      fulfilledService: next,
    }
  }

  if (!order.serviceId) return { services, fulfilledService: undefined as UserService | undefined }

  if (order.kind === 'renew') {
    let fulfilled: UserService | undefined
    const next = services.map((s) => {
      if (s.id !== order.serviceId) return s
      const base = new Date(s.expiresAt).getTime() > Date.now() ? new Date(s.expiresAt) : new Date()
      fulfilled = { ...s, status: 'active', expiresAt: createExpiry(base, livePlan.durationDays), orderId: order.id }
      return fulfilled
    })
    return { services: next, fulfilledService: fulfilled }
  }

  if (order.kind === 'upgrade') {
    const server = chooseBestServer(servers, livePlan)
    let fulfilled: UserService | undefined
    const next = services.map((s) => {
      if (s.id !== order.serviceId) return s
      fulfilled = {
        ...s,
        planId: livePlan.id,
        planName: livePlan.name,
        status: 'active',
        expiresAt: createExpiry(new Date(), livePlan.durationDays),
        deviceLimit: livePlan.deviceLimit,
        region: server.country,
        protocol: livePlan.protocols[0],
        configCode: `LIAN://${slugify(livePlan.name)}/${slugify(profile.username)}/${s.id}`,
        orderId: order.id,
        latency: server.latency,
        uptime: '99.98%',
      }
      return fulfilled
    })
    return { services: next, fulfilledService: fulfilled }
  }

  return { services, fulfilledService: undefined as UserService | undefined }
}

const getCheckoutBase = (plan: Plan, mode: NonNullable<PurchaseIntent>['mode']) =>
  mode === 'upgrade' ? Math.max(Math.round(plan.price * 0.65), 119000) : plan.price

const getPromo = (campaigns: Campaign[], promoCode: string) =>
  campaigns.find((c) => c.active && c.code === promoCode.trim().toUpperCase())

const downloadTextFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const copyText = async (value: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    return false
  }
  return false
}

const notifyPurchaseByEmail = async (payload: PurchaseNotificationPayload) => {
  try {
    await fetch('/api/purchase-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    })
  } catch {
    // ignore
  }
}

const readReceiptImage = (file: File) =>
  new Promise<{ image: string; name: string }>((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('invalid_file_type')); return }
    const reader = new FileReader()
    reader.onload = () => {
      const image = typeof reader.result === 'string' ? reader.result : ''
      if (!image) { reject(new Error('empty_image')); return }
      resolve({ image, name: file.name })
    }
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(file)
  })

function App() {
  const telegramUser = getTelegramUser()
  const [state, setState] = useState(() => loadPersistentState(telegramUser))
  const [language, setLanguage] = useState<AppLanguage>(() => {
    try {
      const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
      return saved === 'ar' || saved === 'en' ? saved : 'fa'
    } catch { return 'fa' }
  })
  const [screen, setScreen] = useState<Screen>('home')
  const [adminTab, setAdminTab] = useState<AdminTab>('dashboard')
  const [search] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [activeCategory, setActiveCategory] = useState<PlanCategory | 'all'>('all')
  const [purchaseIntent, setPurchaseIntent] = useState<PurchaseIntent>(null)
  const [promoInput, setPromoInput] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')
  const [checkoutReceiptDraft, setCheckoutReceiptDraft] = useState<{ image: string; name: string } | null>(null)
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketCategory, setTicketCategory] = useState<SupportTicket['category']>('setup')
  const [ticketMessage, setTicketMessage] = useState('')
  const [newPlanDraft, setNewPlanDraft] = useState<Plan>(() => createEmptyPlanDraft())
  const [newCampaignDraft, setNewCampaignDraft] = useState<Campaign>(() => createEmptyCampaignDraft())
  const [newFaqDraft, setNewFaqDraft] = useState<FAQItem>(() => createEmptyFaqDraft())
  const [newServiceDraft, setNewServiceDraft] = useState<NewServiceDraft>(() => createEmptyServiceDraft(state.plans))
  const [isPromoPanelOpen, setIsPromoPanelOpen] = useState(false)
  const [isCheckoutPromoPanelOpen, setIsCheckoutPromoPanelOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [adminNoticeTitle, setAdminNoticeTitle] = useState('')
  const [adminNoticeMessage, setAdminNoticeMessage] = useState('')
  const [adminNoticeTone, setAdminNoticeTone] = useState<Notice['tone']>('lime')
  const [broadcastTitle, setBroadcastTitle] = useState('')
  const [broadcastBody, setBroadcastBody] = useState('')
  const [broadcastSent, setBroadcastSent] = useState(false)
  const [topUpCustomerId, setTopUpCustomerId] = useState('')
  const [topUpAmount, setTopUpAmount] = useState(100000)

  const i18n = createTranslator(language)
  const compactLocale = language === 'fa' ? 'fa-IR' : language === 'ar' ? 'ar-SA' : 'en-US'
  const { tr, dir, formatMoney, formatDate, formatNumber, daysLeft, daysAccess, devicesCount, moreLocations, uptimeLabel, promoApplied, copiedMessage } = i18n

  const formatCompact = (value: number) =>
    new Intl.NumberFormat(compactLocale, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(value)

  useEffect(() => { initTelegramShell() }, [])

  useEffect(() => {
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language) } catch { /* ignore */ }
    document.documentElement.lang = language
    document.documentElement.dir = dir
  }, [dir, language])

  useEffect(() => { savePersistentState(state) }, [state])

  useEffect(() => {
    if (!toast) return undefined
    const t = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    const { body, documentElement } = document
    const bodyOv = body.style.overflow
    const htmlOv = documentElement.style.overflow
    if (purchaseIntent) { body.style.overflow = 'hidden'; documentElement.style.overflow = 'hidden' }
    return () => { body.style.overflow = bodyOv; documentElement.style.overflow = htmlOv }
  }, [purchaseIntent])

  const searchToken = deferredSearch.trim().toLowerCase()
  const planSearchToken = screen === 'plans' ? searchToken : ''
  const faqSearchToken = screen === 'support' ? searchToken : ''
  const activeServices = state.services.filter((s) => s.status !== 'expired')
  const openTicketCount = state.tickets.filter((t) => t.status !== 'resolved').length
  const filteredPlans = state.plans.filter((p) => {
    const matchesCat = activeCategory === 'all' || p.category === activeCategory
    const hay = [tr(p.name), tr(p.subtitle), tr(p.description), p.locations.map(tr).join(' '), p.perks.map(tr).join(' ')].join(' ').toLowerCase()
    return matchesCat && (!planSearchToken || hay.includes(planSearchToken))
  })
  const featuredPlans = filteredPlans.filter((p) => p.featured).slice(0, 3)
  const filteredFaqs = state.faqs.filter((f) => {
    if (!faqSearchToken) return true
    return `${tr(f.question)} ${tr(f.answer)}`.toLowerCase().includes(faqSearchToken)
  })
  const featuredCampaigns = state.campaigns.filter((c) => c.active)
  const selectedPlan = purchaseIntent ? state.plans.find((p) => p.id === purchaseIntent.planId) : undefined
  const selectedPromo = purchaseIntent ? getPromo(state.campaigns, promoInput) : undefined
  const checkoutAmount = selectedPlan && purchaseIntent
    ? Math.round(getCheckoutBase(selectedPlan, purchaseIntent.mode) * (1 - (selectedPromo?.discountPercent ?? 0) / 100))
    : 0
  const avgPing = averageLatency(state.servers)
  const revenue = paidLifetimeValue(state.orders)
  const activeUsers = state.customers.filter((c) => c.status === 'active' || c.status === 'expiring').length
  const nextExpiringService = [...activeServices].sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())[0]
  const primaryService = activeServices[0]
  const serviceTone: 'lime' | 'ice' | 'amber' | 'neutral' = primaryService
    ? (primaryService.status === 'active' || primaryService.status === 'trial' ? 'lime' : 'amber')
    : 'neutral'

  const showToast = (msg: string) => setToast(msg)
  const switchScreen = (next: Screen) => startTransition(() => setScreen(next))

  const openCheckout = (planId: string, mode: NonNullable<PurchaseIntent>['mode'], serviceId?: string) => {
    setPurchaseIntent({ planId, mode, serviceId })
    setPaymentMethod('card')
    setPromoInput('')
    setCheckoutReceiptDraft(null)
    setIsCheckoutPromoPanelOpen(false)
    pulseTelegram('light')
  }

  const closeCheckout = () => {
    setPurchaseIntent(null)
    setPromoInput('')
    setCheckoutReceiptDraft(null)
    setIsCheckoutPromoPanelOpen(false)
  }

  const copyPaymentDetail = async (value: string, label: string) => {
    const ok = await copyText(value)
    pulseTelegram('light')
    showToast(ok ? copiedMessage(label) : tr('Clipboard is not available'))
  }

  const applyOrderReceipt = async (orderId: string, file: File | null) => {
    if (!file) return
    try {
      const receipt = await readReceiptImage(file)
      setState((prev) => ({
        ...prev,
        orders: prev.orders.map((o) =>
          o.id === orderId
            ? { ...o, receiptImage: receipt.image, receiptFileName: receipt.name, receiptUploadedAt: new Date().toISOString() }
            : o,
        ),
      }))
      showToast(tr('Receipt uploaded'))
      pulseTelegram('light')
    } catch {
      showToast(tr('Please choose an image file'))
    }
  }

  const handleCheckoutReceiptChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!file) return
    try {
      const receipt = await readReceiptImage(file)
      setCheckoutReceiptDraft(receipt)
      showToast(tr('Receipt attached to this order'))
      pulseTelegram('light')
    } catch {
      showToast(tr('Please choose an image file'))
    }
  }

  const startTrial = () => {
    if (state.trialUsed) { showToast(tr('Trial was already activated on this account')); return }
    const starter = state.plans.find((p) => p.category === 'starter')
    if (!starter) return
    setState((prev) => {
      const server = chooseBestServer(prev.servers, starter)
      const orderId = makeId('ord')
      const serviceId = makeId('svc')
      const nextService: UserService = {
        id: serviceId,
        planId: starter.id,
        planName: `${starter.name} Trial`,
        status: 'trial',
        expiresAt: createExpiry(new Date(), 3),
        devicesInUse: 1,
        deviceLimit: starter.deviceLimit,
        region: server.country,
        protocol: starter.protocols[0],
        configCode: `LIAN://TRIAL/${slugify(prev.profile.username)}/${serviceId}`,
        orderId,
        latency: server.latency,
        uptime: '99.80%',
      }
      const existing = prev.customers.find((c) => c.id === prev.profile.id)
      const nextCustomers = existing
        ? prev.customers.map((c) => c.id === prev.profile.id ? { ...c, activePlan: nextService.planName, status: 'trial' as const } : c)
        : [{ id: prev.profile.id, name: prev.profile.firstName, handle: `@${prev.profile.username}`, city: prev.profile.city, activePlan: nextService.planName, status: 'trial' as const, lifetimeValue: 0, walletCredit: 0 }, ...prev.customers]
      return {
        ...prev,
        services: [nextService, ...prev.services],
        orders: [{ id: orderId, planId: starter.id, planName: starter.name, amount: 0, status: 'paid', paymentMethod: 'wallet', kind: 'trial', createdAt: new Date().toISOString(), serviceId }, ...prev.orders],
        customers: nextCustomers,
        trialUsed: true,
      }
    })
    pulseTelegram('medium')
    showToast(tr('3 day trial unlocked'))
    switchScreen('services')
  }

  const confirmCheckout = () => {
    if (!purchaseIntent || !selectedPlan) return
    let notifPayload: PurchaseNotificationPayload | null = null
    setState((prev) => {
      const livePlan = prev.plans.find((p) => p.id === purchaseIntent.planId)
      if (!livePlan) return prev
      const promo = getPromo(prev.campaigns, promoInput)
      const orderId = makeId('ord')
      const createdAt = new Date().toISOString()
      const targetServiceId = purchaseIntent.mode === 'buy' ? makeId('svc') : purchaseIntent.serviceId
      const manualFlow = paymentMethod === 'card' || paymentMethod === 'crypto'
      const orderKind: Order['kind'] = purchaseIntent.mode === 'buy' ? 'purchase' : purchaseIntent.mode === 'renew' ? 'renew' : 'upgrade'
      const amount = Math.round(getCheckoutBase(livePlan, purchaseIntent.mode) * (1 - (promo?.discountPercent ?? 0) / 100))
      let nextServices = prev.services
      let notifiedService: UserService | undefined
      if (!manualFlow) {
        const f = fulfillOrder(prev.services, prev.plans, prev.servers, prev.profile, { id: orderId, planId: livePlan.id, planName: livePlan.name, amount, status: 'paid', paymentMethod, kind: orderKind, createdAt, promoCode: promo?.code, serviceId: targetServiceId })
        nextServices = f.services
        notifiedService = f.fulfilledService
      }
      const nextOrder: Order = { id: orderId, planId: livePlan.id, planName: livePlan.name, amount, status: manualFlow ? 'processing' : 'paid', paymentMethod, kind: orderKind, createdAt, promoCode: promo?.code, serviceId: targetServiceId, receiptImage: manualFlow ? checkoutReceiptDraft?.image : undefined, receiptFileName: manualFlow ? checkoutReceiptDraft?.name : undefined, receiptUploadedAt: manualFlow && checkoutReceiptDraft ? createdAt : undefined }
      const nextOrders = [nextOrder, ...prev.orders]
      notifPayload = { orderId, createdAt, kind: orderKind, amount, paymentMethod, promoCode: promo?.code, user: { telegramId: telegramUser?.id, firstName: prev.profile.firstName, username: prev.profile.username, city: prev.profile.city }, plan: { id: livePlan.id, name: livePlan.name, durationDays: livePlan.durationDays, deviceLimit: livePlan.deviceLimit, protocols: livePlan.protocols, locations: livePlan.locations }, service: notifiedService ? { region: notifiedService.region, protocol: notifiedService.protocol, expiresAt: notifiedService.expiresAt, configCode: notifiedService.configCode } : undefined }
      return { ...prev, services: nextServices, orders: nextOrders, customers: syncPrimaryCustomer(prev.profile, nextServices, nextOrders, prev.customers) }
    })
    if (notifPayload) void notifyPurchaseByEmail(notifPayload)
    pulseTelegram('heavy')
    showToast(paymentMethod === 'card' || paymentMethod === 'crypto' ? tr('Order moved to Orders and is waiting for your payment receipt') : purchaseIntent.mode === 'renew' ? tr('Subscription renewed') : purchaseIntent.mode === 'upgrade' ? tr('Plan upgraded successfully') : tr('VPN service delivered instantly'))
    closeCheckout()
    switchScreen('services')
  }

  const downloadConfig = (service: UserService) => {
    downloadTextFile(`${slugify(service.planName)}-${service.id}.txt`, buildConfigText(service))
    pulseTelegram('light')
    showToast(tr('Config file downloaded'))
  }

  const copyConfig = async (service: UserService) => {
    const ok = await copyText(service.configCode)
    pulseTelegram('light')
    showToast(ok ? tr('Config copied to clipboard') : tr('Clipboard is not available'))
  }

  const openUpgrade = (service: UserService) => {
    const curr = state.plans.find((p) => p.id === service.planId)
    const upgrade = state.plans.filter((p) => (curr ? p.price > curr.price : true)).sort((a, b) => a.price - b.price)[0] ?? state.plans.at(-1)
    if (!upgrade) { showToast(tr('You are already on the highest plan')); return }
    openCheckout(upgrade.id, 'upgrade', service.id)
  }

  const submitTicket = () => {
    if (!ticketTitle.trim() || !ticketMessage.trim()) { showToast(tr('Fill in the ticket title and message')); return }
    setState((prev) => ({
      ...prev,
      tickets: [{ id: makeId('tkt'), title: ticketTitle.trim(), category: ticketCategory, status: 'open', lastMessageAt: new Date().toISOString(), messages: [{ id: makeId('msg'), from: 'user', text: ticketMessage.trim(), timestamp: new Date().toISOString() }] }, ...prev.tickets],
    }))
    setTicketTitle(''); setTicketMessage(''); setTicketCategory('setup')
    pulseTelegram('medium')
    showToast(tr('Ticket sent to support'))
  }

  const updateServiceField = <K extends keyof UserService>(id: string, field: K, value: UserService[K]) => {
    setState((prev) => {
      const curr = prev.services.find((s) => s.id === id)
      if (!curr) return prev
      let services = prev.services
      let orders = prev.orders
      if (field === 'planId') {
        const np = prev.plans.find((p) => p.id === value) ?? prev.plans.find((p) => p.id === curr.planId)
        services = prev.services.map((s) => s.id === id ? { ...s, planId: np?.id ?? s.planId, planName: np?.name ?? s.planName, deviceLimit: np?.deviceLimit ?? s.deviceLimit } : s)
        orders = prev.orders.map((o) => o.id === curr.orderId ? { ...o, planId: np?.id ?? o.planId, planName: np?.name ?? o.planName, amount: np?.price ?? o.amount } : o)
      } else {
        services = prev.services.map((s) => s.id === id ? { ...s, [field]: value } : s)
      }
      return { ...prev, services, orders, customers: syncPrimaryCustomer(prev.profile, services, orders, prev.customers) }
    })
  }

  const updateOrderField = <K extends keyof Order>(orderId: string, field: K, value: Order[K]) => {
    setState((prev) => {
      const curr = prev.orders.find((o) => o.id === orderId)
      if (!curr) return prev
      let orders = prev.orders
      let services = prev.services
      if (field === 'planId') {
        const np = prev.plans.find((p) => p.id === value) ?? prev.plans.find((p) => p.id === curr.planId)
        orders = prev.orders.map((o) => o.id === orderId ? { ...o, planId: np?.id ?? o.planId, planName: np?.name ?? o.planName, amount: np?.price ?? o.amount } : o)
        services = prev.services.map((s) => s.orderId === orderId ? { ...s, planId: np?.id ?? s.planId, planName: np?.name ?? s.planName, deviceLimit: np?.deviceLimit ?? s.deviceLimit } : s)
      } else if (field === 'promoCode') {
        orders = prev.orders.map((o) => o.id === orderId ? { ...o, promoCode: String(value).trim() ? String(value).trim().toUpperCase() : undefined } : o)
      } else if (field === 'status' && value === 'paid' && curr.status !== 'paid') {
        const nextOrder: Order = { ...curr, status: 'paid' }
        const f = fulfillOrder(prev.services, prev.plans, prev.servers, prev.profile, nextOrder)
        services = f.services
        orders = prev.orders.map((o) => o.id === orderId ? nextOrder : o)
      } else {
        orders = prev.orders.map((o) => o.id === orderId ? { ...o, [field]: value } : o)
      }
      return { ...prev, orders, services, customers: syncPrimaryCustomer(prev.profile, services, orders, prev.customers) }
    })
  }

  const updatePlanField = <K extends keyof Plan>(planId: string, field: K, value: Plan[K]) => {
    setState((prev) => {
      const curr = prev.plans.find((p) => p.id === planId)
      if (!curr) return prev
      const plans = prev.plans.map((p) => p.id === planId ? { ...p, [field]: value } : p)
      const np = plans.find((p) => p.id === planId) ?? curr
      const services = prev.services.map((s) => s.planId !== planId ? s : { ...s, planName: field === 'name' ? String(value) : np.name, deviceLimit: field === 'deviceLimit' ? Number(value) : np.deviceLimit })
      const orders = prev.orders.map((o) => o.planId === planId ? { ...o, planName: field === 'name' ? String(value) : np.name } : o)
      const customers = syncPrimaryCustomer(prev.profile, services, orders, prev.customers.map((c) => c.activePlan === curr.name ? { ...c, activePlan: np.name } : c))
      return { ...prev, plans, services, orders, customers }
    })
  }

  const updateCampaignField = <K extends keyof Campaign>(id: string, field: K, value: Campaign[K]) => {
    setState((prev) => ({ ...prev, campaigns: prev.campaigns.map((c) => c.id === id ? { ...c, [field]: field === 'code' ? String(value).trim().toUpperCase() : value } : c) }))
  }

  const updateNoticeField = <K extends keyof Notice>(id: string, field: K, value: Notice[K]) => {
    setState((prev) => ({ ...prev, notices: prev.notices.map((n) => n.id === id ? { ...n, [field]: value } : n) }))
  }

  const updateFaqField = <K extends keyof FAQItem>(id: string, field: K, value: FAQItem[K]) => {
    setState((prev) => ({ ...prev, faqs: prev.faqs.map((f) => f.id === id ? { ...f, [field]: value } : f) }))
  }

  const addPlan = () => {
    const trimmed = newPlanDraft.name.trim()
    if (!trimmed) { showToast(tr('Add a package name first')); return }
    const next: Plan = { ...newPlanDraft, id: newPlanDraft.id.trim() || slugify(trimmed) || makeId('plan'), name: trimmed, subtitle: newPlanDraft.subtitle.trim() || trimmed, description: newPlanDraft.description.trim() || trimmed, badge: newPlanDraft.badge?.trim() || undefined, price: Math.max(99000, Number(newPlanDraft.price) || 0), durationDays: Math.max(1, Number(newPlanDraft.durationDays) || 30), deviceLimit: Math.max(1, Number(newPlanDraft.deviceLimit) || 1), locations: newPlanDraft.locations.length ? newPlanDraft.locations : ['Germany'], protocols: newPlanDraft.protocols.length ? newPlanDraft.protocols : ['VLESS'], perks: newPlanDraft.perks.length ? newPlanDraft.perks : ['Instant delivery'] }
    setState((prev) => ({ ...prev, plans: [next, ...prev.plans] }))
    setNewPlanDraft(createEmptyPlanDraft())
    pulseTelegram('medium')
    showToast(tr('New package added'))
  }

  const deletePlan = (planId: string) => {
    setState((prev) => ({ ...prev, plans: prev.plans.filter((p) => p.id !== planId) }))
    showToast('پلن حذف شد')
  }

  const addCampaign = () => {
    const title = newCampaignDraft.title.trim()
    const code = newCampaignDraft.code.trim().toUpperCase()
    if (!title || !code) { showToast(tr('Add a title and discount code first')); return }
    const next: Campaign = { ...newCampaignDraft, id: newCampaignDraft.id.trim() || makeId('cmp'), title, description: newCampaignDraft.description.trim() || title, code, reward: newCampaignDraft.reward.trim() || `${Math.max(1, Number(newCampaignDraft.discountPercent) || 0)}% off`, discountPercent: Math.max(1, Number(newCampaignDraft.discountPercent) || 0) }
    setState((prev) => ({ ...prev, campaigns: [next, ...prev.campaigns] }))
    setNewCampaignDraft(createEmptyCampaignDraft())
    pulseTelegram('medium')
    showToast(tr('New discount code added'))
  }

  const deleteCampaign = (id: string) => {
    setState((prev) => ({ ...prev, campaigns: prev.campaigns.filter((c) => c.id !== id) }))
    showToast('کد تخفیف حذف شد')
  }

  const addFaq = () => {
    const q = newFaqDraft.question.trim()
    const a = newFaqDraft.answer.trim()
    if (!q || !a) { showToast(tr('Add a question and answer first')); return }
    setState((prev) => ({ ...prev, faqs: [{ id: newFaqDraft.id.trim() || makeId('faq'), question: q, answer: a }, ...prev.faqs] }))
    setNewFaqDraft(createEmptyFaqDraft())
    pulseTelegram('medium')
    showToast(tr('New FAQ added'))
  }

  const deleteFaq = (id: string) => {
    setState((prev) => ({ ...prev, faqs: prev.faqs.filter((f) => f.id !== id) }))
    showToast('سوال حذف شد')
  }

  const deleteNotice = (id: string) => {
    setState((prev) => ({ ...prev, notices: prev.notices.filter((n) => n.id !== id) }))
    showToast('اطلاعیه حذف شد')
  }

  const deleteService = (id: string) => {
    setState((prev) => ({ ...prev, services: prev.services.filter((s) => s.id !== id) }))
    showToast('سرویس حذف شد')
  }

  const deleteOrder = (id: string) => {
    setState((prev) => ({ ...prev, orders: prev.orders.filter((o) => o.id !== id) }))
    showToast('سفارش حذف شد')
  }

  const publishNotice = () => {
    if (!adminNoticeTitle.trim() || !adminNoticeMessage.trim()) { showToast(tr('Write a title and message before publishing')); return }
    setState((prev) => ({ ...prev, notices: [{ id: makeId('ntc'), title: adminNoticeTitle.trim(), message: adminNoticeMessage.trim(), tone: adminNoticeTone }, ...prev.notices] }))
    setAdminNoticeTitle(''); setAdminNoticeMessage(''); setAdminNoticeTone('lime')
    pulseTelegram('medium')
    showToast(tr('Broadcast notice published to the home screen'))
  }

  const sendBroadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastBody.trim()) { showToast('عنوان و متن پیام را وارد کنید'); return }
    const formatted = `📢 *${broadcastTitle.trim()}*\n\n${broadcastBody.trim()}`
    await copyText(formatted)
    setBroadcastSent(true)
    setState((prev) => ({ ...prev, notices: [{ id: makeId('ntc'), title: broadcastTitle.trim(), message: broadcastBody.trim(), tone: 'ice' }, ...prev.notices] }))
    pulseTelegram('heavy')
    showToast('پیام کپی شد و در فید home منتشر شد')
    setTimeout(() => setBroadcastSent(false), 3000)
  }

  const assignNewService = () => {
    const plan = state.plans.find((p) => p.id === newServiceDraft.planId)
    if (!plan) { showToast('پلن انتخاب‌شده یافت نشد'); return }
    const serviceId = makeId('svc')
    const orderId = makeId('ord')
    const newService: UserService = {
      id: serviceId,
      planId: plan.id,
      planName: plan.name,
      status: 'active',
      expiresAt: newServiceDraft.expiresAt,
      devicesInUse: newServiceDraft.devicesInUse,
      deviceLimit: plan.deviceLimit,
      region: newServiceDraft.region,
      protocol: newServiceDraft.protocol,
      configCode: `LIAN://${slugify(plan.name)}/${slugify(state.profile.username)}/${serviceId}`,
      orderId,
      latency: state.servers.find((s) => s.country === newServiceDraft.region)?.latency ?? 50,
      uptime: '99.95%',
    }
    const newOrder: Order = { id: orderId, planId: plan.id, planName: plan.name, amount: plan.price, status: 'paid', paymentMethod: 'wallet', kind: 'purchase', createdAt: new Date().toISOString(), serviceId }
    setState((prev) => {
      const services = [newService, ...prev.services]
      const orders = [newOrder, ...prev.orders]
      return { ...prev, services, orders, customers: syncPrimaryCustomer(prev.profile, services, orders, prev.customers) }
    })
    setNewServiceDraft(createEmptyServiceDraft(state.plans))
    pulseTelegram('medium')
    showToast('سرویس جدید اضافه شد')
  }

  const topUpWallet = () => {
    const amount = Math.max(0, Number(topUpAmount) || 0)
    if (!amount) { showToast('مبلغ شارژ را وارد کنید'); return }
    setState((prev) => {
      const isProfile = !topUpCustomerId || topUpCustomerId === prev.profile.id
      if (isProfile) {
        return { ...prev, profile: { ...prev.profile, walletCredit: prev.profile.walletCredit + amount }, customers: prev.customers.map((c) => c.id === prev.profile.id ? { ...c, walletCredit: prev.profile.walletCredit + amount } : c) }
      }
      return { ...prev, customers: prev.customers.map((c) => c.id === topUpCustomerId ? { ...c, walletCredit: (c.walletCredit ?? 0) + amount } : c) }
    })
    pulseTelegram('medium')
    showToast(`کیف پول ${formatMoney(amount)} شارژ شد`)
    setTopUpAmount(100000)
  }

  const copyReferral = async () => {
    const ok = await copyText(`https://t.me/lianvpn_bot?start=${state.profile.referralCode}`)
    showToast(ok ? tr('Referral link copied') : tr('Clipboard is not available'))
  }

  const copyPromoCode = async (code: string) => {
    const ok = await copyText(code)
    setPromoInput(code); setIsPromoPanelOpen(false); pulseTelegram('light')
    showToast(ok ? copiedMessage(code) : tr('Clipboard is not available'))
  }

  const applyCheckoutPromoCode = (code: string) => {
    setPromoInput(code); setIsCheckoutPromoPanelOpen(false); pulseTelegram('light')
  }

  const renderHome = () => (
    <>
      <section className="profile-card card-frame subscriber-card">
        <div className="profile-row subscriber-head">
          <div className="avatar-shell">
            {state.profile.avatarUrl
              ? <img src={state.profile.avatarUrl} alt={state.profile.firstName} />
              : <span>{state.profile.firstName.slice(0, 1)}</span>}
          </div>
          <div className="subscriber-copy">
            <p className="eyebrow">{tr('Subscriber')}</p>
            <h2>{state.profile.firstName}</h2>
            <p className="muted-copy">@{state.profile.username} • {tr(state.profile.city)}</p>
          </div>
          <StatusPill tone={serviceTone}>
            {primaryService ? tr(statusLabel(primaryService.status)) : tr('Inactive')}
          </StatusPill>
        </div>
      </section>

      {state.notices.length > 0 && (
        <section className="content-section">
          <div className="notice-list">
            {state.notices.map((notice) => (
              <div key={notice.id} className={`notice-card notice-${notice.tone}`}>
                <strong>{tr(notice.title)}</strong>
                <p>{tr(notice.message)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {featuredPlans.length > 0 && (
        <section className="content-section">
          <SectionHeader eyebrow={tr('Plans')} title={tr('Featured subscription cards')} />
          <div className="plan-grid">
            {featuredPlans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} actionLabel={tr('Buy now')} tr={tr} formatMoney={formatMoney} daysAccess={daysAccess} devicesCount={devicesCount} moreLocations={moreLocations} onAction={() => openCheckout(plan.id, 'buy')} />
            ))}
          </div>
        </section>
      )}
    </>
  )

  const renderPlans = () => (
    <>
      <section className="content-section">
        <div className="plans-header-stack">
          <SectionHeader
            eyebrow={tr('Catalog')}
            title={tr('VPN plans ready to sell')}
            action={
              <button className="ghost-button small icon-button" onClick={() => setIsPromoPanelOpen((o) => !o)} aria-label={isPromoPanelOpen ? tr('Close') : tr('Discount codes')} aria-expanded={isPromoPanelOpen} aria-controls="promo-panel">
                {isPromoPanelOpen ? <CloseIcon /> : <TagIcon />}
              </button>
            }
          />
          {isPromoPanelOpen && (
            <div className="promo-popover card-frame" id="promo-panel">
              <div className="promo-popover-head">
                <div>
                  <p className="eyebrow">{tr('Discount codes')}</p>
                  <h3>{tr('Copy and use in checkout')}</h3>
                </div>
                <button className="ghost-button small icon-button" onClick={() => setIsPromoPanelOpen(false)} aria-label={tr('Close')}><CloseIcon /></button>
              </div>
              <div className="promo-code-list">
                {featuredCampaigns.map((c) => (
                  <div key={c.id} className="promo-code-row">
                    <div><strong>{c.code}</strong><p className="muted-copy">{tr(c.reward)}</p></div>
                    <button className="primary-button" onClick={() => void copyPromoCode(c.code)}>{tr('Copy')}</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="tab-slider" role="tablist" aria-label={tr('Plans')}>
          {planCategories.map((cat) => (
            <button key={cat.id} className={`chip tab-chip ${activeCategory === cat.id ? 'chip-active' : ''}`} role="tab" aria-selected={activeCategory === cat.id} onClick={() => setActiveCategory(cat.id)}>{tr(cat.label)}</button>
          ))}
        </div>
      </section>
      <section className="content-section">
        <div className="plan-grid">
          {filteredPlans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} actionLabel={tr('Open checkout')} tr={tr} formatMoney={formatMoney} daysAccess={daysAccess} devicesCount={devicesCount} moreLocations={moreLocations} onAction={() => openCheckout(plan.id, 'buy')} />
          ))}
        </div>
      </section>
    </>
  )

  const renderServices = () => (
    <>
      <section className="content-section">
        <SectionHeader eyebrow={tr('Delivery')} title={tr('Configs, renewals, and upgrades')} />
        <div className="order-card-list">
          {state.orders.length ? state.orders.map((order) => {
            const linked = activeServices.find((s) => s.orderId === order.id)
            return (
              <OrderCard key={order.id} order={order} service={linked} tr={tr} formatDate={formatDate} formatMoney={formatMoney} formatNumber={formatNumber} daysLeft={daysLeft} uptimeLabel={uptimeLabel} onCopy={linked ? () => copyConfig(linked) : undefined} onDownload={linked ? () => downloadConfig(linked) : undefined} onCopyPaymentValue={copyPaymentDetail} onUploadReceipt={(file) => void applyOrderReceipt(order.id, file)} onRenew={linked ? () => openCheckout(linked.planId, 'renew', linked.id) : undefined} onUpgrade={linked ? () => openUpgrade(linked) : undefined} />
            )
          }) : (
            <div className="empty-card">
              <h3>{tr('Order history')}</h3>
              <p>{tr('Use the Plans tab to simulate the purchase flow and auto-delivery.')}</p>
              <button className="primary-button" onClick={() => switchScreen('plans')}>{tr('Browse plans')}</button>
            </div>
          )}
        </div>
      </section>

      <section className="content-section">
        <div className="orders-overview card-frame">
          <div className="orders-overview-head">
            <div className="orders-overview-copy">
              <p className="eyebrow">{tr('Orders')}</p>
              <h2>{tr('Order history')}</h2>
            </div>
            <button className="ghost-button small orders-overview-action" onClick={() => switchScreen('plans')}>{tr('Add plan')}</button>
          </div>
          <div className="mini-stats orders-overview-grid">
            <MetricTile label={tr('Orders')} value={formatNumber(state.orders.length)} icon={<ReceiptIcon />} iconOnly compact />
            <MetricTile label={tr('Services')} value={formatNumber(activeServices.length)} icon={<ShieldIcon />} iconOnly compact />
            <MetricTile label={tr('Total paid')} value={formatCompact(revenue)} icon={<WalletIcon />} iconOnly compact />
            <MetricTile label={tr('Next expiry')} value={nextExpiringService ? daysLeft(daysRemaining(nextExpiringService.expiresAt)) : tr('No expiry')} icon={<CalendarIcon />} iconOnly compact />
          </div>
        </div>
      </section>
    </>
  )

  const renderSupport = () => (
    <>
      <section className="content-section">
        <SectionHeader eyebrow={tr('Support')} title={tr('Tickets, guides, and FAQs')} />
        <div className="grid-two">
          {setupGuides.map((guide) => (
            <div key={guide.platform} className="content-card guide-card">
              <div className="guide-card-head">
                <div><p className="eyebrow">{tr(guide.platform)}</p><h3 className="guide-client">{guide.client}</h3></div>
                <a className="guide-link" href={guide.url} target="_blank" rel="noreferrer" aria-label={`${guide.client} ${tr('Open link')}`}>
                  <span>{tr(guide.linkLabel)}</span><LaunchIcon />
                </a>
              </div>
              <ul className="guide-steps">{guide.steps.map((step) => <li key={step}>{tr(step)}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="content-section">
        <div className="support-form card-frame">
          <div className="support-form-head">
            <p className="eyebrow">{tr('Open a ticket')}</p>
            <h2>{tr('Support inbox')}</h2>
          </div>
          <div className="form-grid">
            <input className="field" placeholder={tr('Ticket title')} value={ticketTitle} onChange={(e) => setTicketTitle(e.target.value)} />
            <select className="field" value={ticketCategory} onChange={(e) => setTicketCategory(e.target.value as SupportTicket['category'])}>
              <option value="setup">{tr('Setup')}</option>
              <option value="billing">{tr('Billing')}</option>
              <option value="speed">{tr('Speed')}</option>
              <option value="account">{tr('Account')}</option>
            </select>
            <textarea className="field field-area" placeholder={tr('Describe the issue')} value={ticketMessage} onChange={(e) => setTicketMessage(e.target.value)} />
            <button className="primary-button" onClick={submitTicket}>{tr('Send ticket')}</button>
          </div>
        </div>
      </section>

      <section className="content-section">
        <SectionHeader eyebrow={tr('Queue')} title={tr('Recent tickets')} />
        <div className="ticket-list">
          {state.tickets.map((ticket) => (
            <details key={ticket.id} className="ticket-card ticket-accordion">
              <summary className="ticket-summary">
                <div className="ticket-summary-copy">
                  <div className="stat-line">
                    <StatusPill tone={ticket.status === 'resolved' ? 'ice' : 'amber'}>{tr(ticketStatusLabel(ticket.status))}</StatusPill>
                    <span>{formatDate(ticket.lastMessageAt)}</span>
                  </div>
                  <h3>{tr(ticket.title)}</h3>
                </div>
                <span className="ticket-toggle" aria-hidden="true"><ChevronIcon /></span>
              </summary>
              <div className="ticket-thread">
                {ticket.messages.map((msg) => (
                  <div key={msg.id} className={`ticket-message ticket-${msg.from}`}>
                    <strong>{tr(msg.from)}</strong>
                    <p>{tr(msg.text)}</p>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="content-section">
        <SectionHeader eyebrow={tr('FAQ')} title={tr('Answer the most common questions')} />
        <div className="faq-list">
          {filteredFaqs.map((faq) => (
            <details key={faq.id} className="faq-item">
              <summary>{tr(faq.question)}</summary>
              <p>{tr(faq.answer)}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  )

  const renderProfile = () => (
    <>
      <section className="content-section">
        <div className="profile-card card-frame">
          <div className="profile-row">
            <div className="avatar-shell">
              {state.profile.avatarUrl
                ? <img src={state.profile.avatarUrl} alt={state.profile.firstName} />
                : <span>{state.profile.firstName.slice(0, 1)}</span>}
            </div>
            <div>
              <p className="eyebrow">{tr('Account')}</p>
              <h2>{state.profile.firstName}</h2>
              <p className="muted-copy">@{state.profile.username} • {tr(state.profile.city)} • {tr('member since')} {formatDate(state.profile.memberSince)}</p>
            </div>
          </div>
          <div className="mini-stats">
            <MetricTile label={tr('Wallet')} value={formatMoney(state.profile.walletCredit)} compact />
            <MetricTile label={tr('Referrals')} value={formatNumber(state.profile.referrals)} compact />
            <MetricTile label={tr('Preferred route')} value={tr(state.profile.preferredRegion)} compact />
          </div>
        </div>
      </section>

      <section className="content-section">
        <SectionHeader eyebrow={tr('Growth')} title={tr('Promos, referrals, and loyalty')} />
        <div className="grid-two">
          <div className="content-card">
            <p className="eyebrow">{tr('Referral')}</p>
            <h3>{state.profile.referralCode}</h3>
            <p className="muted-copy">{tr('Share the Telegram deep link and reward wallet credit on successful purchases.')}</p>
            <button className="ghost-button" onClick={copyReferral}>{tr('Copy referral link')}</button>
          </div>
          <div className="content-card">
            <p className="eyebrow">{tr('Live promo codes')}</p>
            <div className="coupon-tags">
              {featuredCampaigns.map((c) => (
                <button key={c.id} className="campaign-pill" onClick={async () => { const ok = await copyText(c.code); showToast(ok ? copiedMessage(c.code) : tr('Clipboard is not available')) }}>{c.code}</button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="content-section">
        <SectionHeader eyebrow={tr('Orders')} title={tr('Lifetime value view')} />
        <div className="customer-row card-frame">
          <strong>{tr('Total paid')}</strong>
          <span>{formatMoney(paidLifetimeValue(state.orders))}</span>
        </div>
      </section>

      <section className="content-section">
        <button className="primary-button full-width" onClick={() => { switchScreen('admin'); setAdminTab('dashboard') }}>{tr('Open admin console')}</button>
      </section>
    </>
  )

  const renderAdminDashboard = () => (
    <div className="admin-tab-content">
      <div className="admin-metrics-grid">
        <MetricTile label="درآمد کل" value={formatMoney(revenue)} />
        <MetricTile label="کاربران فعال" value={formatNumber(activeUsers)} />
        <MetricTile label="تیکت‌های باز" value={formatNumber(openTicketCount)} />
        <MetricTile label="میانگین پینگ" value={`${formatNumber(avgPing)}ms`} />
        <MetricTile label="سرویس‌ها" value={formatNumber(activeServices.length)} />
        <MetricTile label="سفارش‌های در انتظار" value={formatNumber(state.orders.filter((o) => o.status === 'processing').length)} />
      </div>

      <div className="admin-block">
        <p className="admin-block-label">وضعیت سرورها</p>
        <div className="admin-server-list">
          {state.servers.map((srv) => (
            <div key={srv.id} className="admin-server-row card-frame">
              <div className="admin-server-info">
                <StatusPill tone={srv.status === 'online' ? 'lime' : srv.status === 'busy' ? 'amber' : 'neutral'}>
                  {srv.status === 'online' ? 'آنلاین' : srv.status === 'busy' ? 'شلوغ' : 'نگهداری'}
                </StatusPill>
                <strong>{srv.city}</strong>
                <span className="muted-copy">{srv.country}</span>
              </div>
              <div className="admin-server-stats">
                <span className="plan-meta-chip">{srv.latency}ms</span>
                <span className="plan-meta-chip">{srv.load}%</span>
                <span className="plan-meta-chip">{srv.protocols.join(' / ')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {state.orders.filter((o) => o.status === 'processing').length > 0 && (
        <div className="admin-block">
          <p className="admin-block-label">سفارش‌های در انتظار تأیید</p>
          <div className="admin-stack">
            {state.orders.filter((o) => o.status === 'processing').map((order) => (
              <div key={order.id} className="admin-card card-frame admin-pending-row">
                <div>
                  <strong>{order.planName}</strong>
                  <p className="muted-copy">{formatMoney(order.amount)} • {formatDate(order.createdAt)}</p>
                </div>
                <button className="primary-button small" onClick={() => { updateOrderField(order.id, 'status', 'paid'); showToast('سفارش تأیید شد') }}>تأیید</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const renderAdminServices = () => (
    <div className="admin-tab-content">
      <div className="admin-block">
        <p className="admin-block-label">افزودن سرویس جدید</p>
        <div className="admin-card card-frame">
          <div className="admin-form-grid">
            <label className="field-label">
              <span>پلن</span>
              <select className="field" value={newServiceDraft.planId} onChange={(e) => setNewServiceDraft((d) => ({ ...d, planId: e.target.value }))}>
                {state.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="field-label">
              <span>سرور / کشور</span>
              <select className="field" value={newServiceDraft.region} onChange={(e) => setNewServiceDraft((d) => ({ ...d, region: e.target.value }))}>
                {state.servers.filter((s) => s.status !== 'maintenance').map((s) => <option key={s.id} value={s.country}>{s.city} — {s.country}</option>)}
              </select>
            </label>
            <label className="field-label">
              <span>پروتکل</span>
              <input className="field" value={newServiceDraft.protocol} onChange={(e) => setNewServiceDraft((d) => ({ ...d, protocol: e.target.value }))} placeholder="VLESS / Reality / Hysteria" />
            </label>
            <label className="field-label">
              <span>تاریخ انقضا</span>
              <input className="field" type="date" value={toDateInputValue(newServiceDraft.expiresAt)} onChange={(e) => setNewServiceDraft((d) => ({ ...d, expiresAt: toIsoDate(e.target.value) }))} />
            </label>
            <label className="field-label">
              <span>دستگاه‌های در حال استفاده</span>
              <input className="field" type="number" min="0" value={newServiceDraft.devicesInUse} onChange={(e) => setNewServiceDraft((d) => ({ ...d, devicesInUse: Math.max(0, Number(e.target.value)) }))} />
            </label>
          </div>
          <button className="primary-button" onClick={assignNewService}>ایجاد و اضافه کردن سرویس</button>
        </div>
      </div>

      <div className="admin-block">
        <p className="admin-block-label">سرویس‌های فعال</p>
        <div className="admin-stack">
          {state.services.length ? state.services.map((svc) => (
            <details key={svc.id} className="admin-card admin-plan-card admin-editor-card">
              <summary className="admin-plan-summary admin-editor-summary">
                <div className="admin-plan-copy admin-editor-copy">
                  <strong>{svc.planName}</strong>
                  <p>{statusLabel(svc.status)} • {svc.region} • {daysLeft(daysRemaining(svc.expiresAt))}</p>
                </div>
                <div className="admin-plan-summary-side">
                  <StatusPill tone={svc.status === 'active' ? 'lime' : svc.status === 'trial' ? 'ice' : svc.status === 'expiring' ? 'amber' : 'neutral'}>{statusLabel(svc.status)}</StatusPill>
                  <span className="ticket-toggle order-toggle" aria-hidden="true"><ChevronIcon /></span>
                </div>
              </summary>
              <div className="admin-plan-body admin-editor-body">
                <div className="admin-form-grid">
                  <label className="field-label">
                    <span>پلن</span>
                    <select className="field" value={svc.planId} onChange={(e) => updateServiceField(svc.id, 'planId', e.target.value)}>
                      {state.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="field-label">
                    <span>وضعیت</span>
                    <select className="field" value={svc.status} onChange={(e) => updateServiceField(svc.id, 'status', e.target.value as ServiceStatus)}>
                      {serviceStatusOptions.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </select>
                  </label>
                  <label className="field-label">
                    <span>انقضا</span>
                    <input className="field" type="date" value={toDateInputValue(svc.expiresAt)} onChange={(e) => updateServiceField(svc.id, 'expiresAt', toIsoDate(e.target.value))} />
                  </label>
                  <label className="field-label">
                    <span>سرور</span>
                    <input className="field" value={svc.region} onChange={(e) => updateServiceField(svc.id, 'region', e.target.value)} />
                  </label>
                  <label className="field-label">
                    <span>پروتکل</span>
                    <input className="field" value={svc.protocol} onChange={(e) => updateServiceField(svc.id, 'protocol', e.target.value)} />
                  </label>
                  <label className="field-label">
                    <span>دستگاه‌ها</span>
                    <input className="field" type="number" value={svc.devicesInUse} onChange={(e) => updateServiceField(svc.id, 'devicesInUse', Math.max(0, Number(e.target.value)))} />
                  </label>
                  <label className="field-label">
                    <span>پینگ (ms)</span>
                    <input className="field" type="number" value={svc.latency} onChange={(e) => updateServiceField(svc.id, 'latency', Math.max(0, Number(e.target.value)))} />
                  </label>
                  <label className="field-label">
                    <span>آپ‌تایم</span>
                    <input className="field" value={svc.uptime} onChange={(e) => updateServiceField(svc.id, 'uptime', e.target.value)} />
                  </label>
                  <label className="field-label admin-span-full">
                    <span>کد کانفیگ</span>
                    <textarea className="field field-area admin-compact-area" value={svc.configCode} onChange={(e) => updateServiceField(svc.id, 'configCode', e.target.value)} />
                  </label>
                </div>
                <button className="admin-delete-btn" onClick={() => deleteService(svc.id)}>حذف سرویس</button>
              </div>
            </details>
          )) : <div className="empty-card"><p>هیچ سرویس فعالی وجود ندارد</p></div>}
        </div>
      </div>
    </div>
  )

  const renderAdminOrders = () => (
    <div className="admin-tab-content">
      <div className="admin-stack">
        {state.orders.length ? state.orders.map((order) => (
          <details key={order.id} className="admin-card admin-plan-card admin-editor-card">
            <summary className="admin-plan-summary admin-editor-summary">
              <div className="admin-plan-copy admin-editor-copy">
                <strong>{order.planName}</strong>
                <p>{formatMoney(order.amount)} • {order.kind} • {formatDate(order.createdAt)}</p>
              </div>
              <div className="admin-plan-summary-side">
                <StatusPill tone={order.status === 'paid' ? 'lime' : 'amber'}>{order.status === 'paid' ? 'پرداخت‌شده' : 'در انتظار'}</StatusPill>
                <span className="ticket-toggle order-toggle" aria-hidden="true"><ChevronIcon /></span>
              </div>
            </summary>
            <div className="admin-plan-body admin-editor-body">
              {order.receiptImage && (
                <div className="admin-receipt-preview">
                  <img src={order.receiptImage} alt="رسید" />
                  <p className="muted-copy">{order.receiptFileName} — {order.receiptUploadedAt ? formatDate(order.receiptUploadedAt) : ''}</p>
                </div>
              )}
              <div className="admin-form-grid">
                <label className="field-label">
                  <span>پلن</span>
                  <select className="field" value={order.planId} onChange={(e) => updateOrderField(order.id, 'planId', e.target.value)}>
                    {state.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  <span>مبلغ (ریال)</span>
                  <input className="field" type="number" value={order.amount} onChange={(e) => updateOrderField(order.id, 'amount', Math.max(0, Number(e.target.value)))} />
                </label>
                <label className="field-label">
                  <span>وضعیت</span>
                  <select className="field" value={order.status} onChange={(e) => updateOrderField(order.id, 'status', e.target.value as Order['status'])}>
                    {orderStatusOptions.map((s) => <option key={s} value={s}>{s === 'paid' ? 'پرداخت‌شده' : 'در انتظار'}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  <span>روش پرداخت</span>
                  <select className="field" value={order.paymentMethod} onChange={(e) => updateOrderField(order.id, 'paymentMethod', e.target.value as PaymentMethod)}>
                    {paymentOptions.map((o) => <option key={o.id} value={o.id}>{tr(o.label)}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  <span>نوع</span>
                  <select className="field" value={order.kind} onChange={(e) => updateOrderField(order.id, 'kind', e.target.value as Order['kind'])}>
                    {orderKindOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  <span>تاریخ</span>
                  <input className="field" type="date" value={toDateInputValue(order.createdAt)} onChange={(e) => updateOrderField(order.id, 'createdAt', toIsoDate(e.target.value))} />
                </label>
                <label className="field-label admin-span-full">
                  <span>کد تخفیف</span>
                  <input className="field" value={order.promoCode ?? ''} onChange={(e) => updateOrderField(order.id, 'promoCode', e.target.value)} />
                </label>
              </div>
              <button className="admin-delete-btn" onClick={() => deleteOrder(order.id)}>حذف سفارش</button>
            </div>
          </details>
        )) : <div className="empty-card"><p>هیچ سفارشی وجود ندارد</p></div>}
      </div>
    </div>
  )

  const renderAdminUsers = () => (
    <div className="admin-tab-content">
      <div className="admin-block">
        <p className="admin-block-label">شارژ کیف پول (تاپ‌آپ)</p>
        <div className="admin-card card-frame">
          <div className="admin-form-grid">
            <label className="field-label admin-span-full">
              <span>کاربر</span>
              <select className="field" value={topUpCustomerId} onChange={(e) => setTopUpCustomerId(e.target.value)}>
                <option value="">کاربر اصلی ({state.profile.firstName})</option>
                {state.customers.filter((c) => c.id !== state.profile.id).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.handle}</option>
                ))}
              </select>
            </label>
            <label className="field-label admin-span-full">
              <span>مبلغ شارژ (ریال)</span>
              <input className="field" type="number" min="0" step="10000" value={topUpAmount} onChange={(e) => setTopUpAmount(Math.max(0, Number(e.target.value)))} />
            </label>
          </div>
          <div className="admin-topup-preview">
            <span>موجودی فعلی:</span>
            <strong>{formatMoney(topUpCustomerId ? (state.customers.find((c) => c.id === topUpCustomerId)?.walletCredit ?? 0) : state.profile.walletCredit)}</strong>
            <span>+</span>
            <strong className="topup-added">{formatMoney(topUpAmount)}</strong>
          </div>
          <button className="primary-button" onClick={topUpWallet}>شارژ کیف پول</button>
        </div>
      </div>

      <div className="admin-block">
        <p className="admin-block-label">کاربران ثبت‌شده</p>
        <div className="admin-stack">
          {state.customers.length ? state.customers.map((c) => (
            <div key={c.id} className="admin-card card-frame admin-customer-row">
              <div className="admin-customer-info">
                <strong>{c.name}</strong>
                <span className="muted-copy">{c.handle} • {c.city}</span>
                <span className="muted-copy">{c.activePlan}</span>
              </div>
              <div className="admin-customer-stats">
                <StatusPill tone={c.status === 'active' ? 'lime' : c.status === 'trial' ? 'ice' : c.status === 'expiring' ? 'amber' : 'neutral'}>{statusLabel(c.status)}</StatusPill>
                <span className="plan-meta-chip">{formatMoney(c.lifetimeValue)}</span>
                {c.walletCredit > 0 && <span className="plan-meta-chip">💰 {formatMoney(c.walletCredit)}</span>}
              </div>
            </div>
          )) : <div className="empty-card"><p>هیچ کاربری ثبت نشده است</p></div>}
        </div>
      </div>
    </div>
  )

  const renderAdminPlans = () => (
    <div className="admin-tab-content">
      <div className="admin-stack">
        {state.plans.map((plan) => (
          <details key={plan.id} className="admin-card admin-plan-card admin-editor-card">
            <summary className="admin-plan-summary admin-editor-summary">
              <div className="admin-plan-copy admin-editor-copy">
                <strong>{plan.name}</strong>
                <p>{formatMoney(plan.price)} • {devicesCount(plan.deviceLimit)}</p>
              </div>
              <div className="admin-plan-summary-side">
                <span className="plan-meta-chip">{plan.category}</span>
                {plan.featured && <span className="plan-meta-chip">ویژه</span>}
                <span className="ticket-toggle order-toggle" aria-hidden="true"><ChevronIcon /></span>
              </div>
            </summary>
            <div className="admin-plan-body admin-editor-body">
              <div className="admin-form-grid">
                <label className="field-label">
                  <span>نام پلن</span>
                  <input className="field" value={plan.name} onChange={(e) => updatePlanField(plan.id, 'name', e.target.value)} />
                </label>
                <label className="field-label">
                  <span>دسته‌بندی</span>
                  <select className="field" value={plan.category} onChange={(e) => updatePlanField(plan.id, 'category', e.target.value as PlanCategory)}>
                    {planCategories.filter((c) => c.id !== 'all').map((c) => <option key={c.id} value={c.id}>{tr(c.label)}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  <span>قیمت (ریال)</span>
                  <input className="field" type="number" value={plan.price} onChange={(e) => updatePlanField(plan.id, 'price', Math.max(99000, Number(e.target.value)))} />
                </label>
                <label className="field-label">
                  <span>مدت (روز)</span>
                  <input className="field" type="number" value={plan.durationDays} onChange={(e) => updatePlanField(plan.id, 'durationDays', Math.max(1, Number(e.target.value)))} />
                </label>
                <label className="field-label">
                  <span>سقف دستگاه</span>
                  <input className="field" type="number" value={plan.deviceLimit} onChange={(e) => updatePlanField(plan.id, 'deviceLimit', Math.max(1, Number(e.target.value)))} />
                </label>
                <label className="field-label">
                  <span>رنگ</span>
                  <select className="field" value={plan.accent} onChange={(e) => updatePlanField(plan.id, 'accent', e.target.value)}>
                    {accentOptions.map((a) => <option key={a} value={a}>{tr(a)}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  <span>نشان</span>
                  <input className="field" value={plan.badge ?? ''} onChange={(e) => updatePlanField(plan.id, 'badge', e.target.value)} />
                </label>
                <label className="field-label">
                  <span>ویژه</span>
                  <select className="field" value={String(Boolean(plan.featured))} onChange={(e) => updatePlanField(plan.id, 'featured', e.target.value === 'true')}>
                    <option value="false">خیر</option>
                    <option value="true">بله</option>
                  </select>
                </label>
                <label className="field-label admin-span-full">
                  <span>زیرعنوان</span>
                  <input className="field" value={plan.subtitle} onChange={(e) => updatePlanField(plan.id, 'subtitle', e.target.value)} />
                </label>
                <label className="field-label admin-span-full">
                  <span>توضیحات</span>
                  <textarea className="field field-area admin-compact-area" value={plan.description} onChange={(e) => updatePlanField(plan.id, 'description', e.target.value)} />
                </label>
                <label className="field-label">
                  <span>سرعت</span>
                  <input className="field" value={plan.speedTier} onChange={(e) => updatePlanField(plan.id, 'speedTier', e.target.value)} />
                </label>
                <label className="field-label">
                  <span>حجم</span>
                  <input className="field" value={plan.dataCap} onChange={(e) => updatePlanField(plan.id, 'dataCap', e.target.value)} />
                </label>
                <label className="field-label admin-span-full">
                  <span>لوکیشن‌ها (با کاما)</span>
                  <input className="field" value={joinCsv(plan.locations)} onChange={(e) => updatePlanField(plan.id, 'locations', splitCsv(e.target.value))} />
                </label>
                <label className="field-label admin-span-full">
                  <span>پروتکل‌ها (با کاما)</span>
                  <input className="field" value={joinCsv(plan.protocols)} onChange={(e) => updatePlanField(plan.id, 'protocols', splitCsv(e.target.value))} />
                </label>
                <label className="field-label admin-span-full">
                  <span>مزایا (با کاما)</span>
                  <textarea className="field field-area admin-compact-area" value={joinCsv(plan.perks)} onChange={(e) => updatePlanField(plan.id, 'perks', splitCsv(e.target.value))} />
                </label>
              </div>
              <button className="admin-delete-btn" onClick={() => deletePlan(plan.id)}>حذف پلن</button>
            </div>
          </details>
        ))}

        <details className="admin-card admin-plan-card admin-editor-card">
          <summary className="admin-plan-summary admin-editor-summary">
            <div className="admin-plan-copy admin-editor-copy">
              <strong>افزودن پلن جدید</strong>
              <p>ایجاد پکیج جدیدی که بلافاصله در لیست کاربر نمایش داده می‌شود</p>
            </div>
            <div className="admin-plan-summary-side">
              <span className="ticket-toggle order-toggle" aria-hidden="true"><ChevronIcon /></span>
            </div>
          </summary>
          <div className="admin-plan-body admin-editor-body">
            <div className="admin-form-grid">
              <label className="field-label">
                <span>نام پلن</span>
                <input className="field" value={newPlanDraft.name} onChange={(e) => setNewPlanDraft((d) => ({ ...d, name: e.target.value }))} />
              </label>
              <label className="field-label">
                <span>دسته‌بندی</span>
                <select className="field" value={newPlanDraft.category} onChange={(e) => setNewPlanDraft((d) => ({ ...d, category: e.target.value as PlanCategory }))}>
                  {planCategories.filter((c) => c.id !== 'all').map((c) => <option key={c.id} value={c.id}>{tr(c.label)}</option>)}
                </select>
              </label>
              <label className="field-label">
                <span>قیمت (ریال)</span>
                <input className="field" type="number" value={newPlanDraft.price} onChange={(e) => setNewPlanDraft((d) => ({ ...d, price: Math.max(99000, Number(e.target.value)) }))} />
              </label>
              <label className="field-label">
                <span>مدت (روز)</span>
                <input className="field" type="number" value={newPlanDraft.durationDays} onChange={(e) => setNewPlanDraft((d) => ({ ...d, durationDays: Math.max(1, Number(e.target.value)) }))} />
              </label>
              <label className="field-label">
                <span>سقف دستگاه</span>
                <input className="field" type="number" value={newPlanDraft.deviceLimit} onChange={(e) => setNewPlanDraft((d) => ({ ...d, deviceLimit: Math.max(1, Number(e.target.value)) }))} />
              </label>
              <label className="field-label">
                <span>رنگ</span>
                <select className="field" value={newPlanDraft.accent} onChange={(e) => setNewPlanDraft((d) => ({ ...d, accent: e.target.value }))}>
                  {accentOptions.map((a) => <option key={a} value={a}>{tr(a)}</option>)}
                </select>
              </label>
              <label className="field-label">
                <span>نشان</span>
                <input className="field" value={newPlanDraft.badge ?? ''} onChange={(e) => setNewPlanDraft((d) => ({ ...d, badge: e.target.value }))} />
              </label>
              <label className="field-label">
                <span>ویژه</span>
                <select className="field" value={String(Boolean(newPlanDraft.featured))} onChange={(e) => setNewPlanDraft((d) => ({ ...d, featured: e.target.value === 'true' }))}>
                  <option value="false">خیر</option>
                  <option value="true">بله</option>
                </select>
              </label>
              <label className="field-label admin-span-full">
                <span>زیرعنوان</span>
                <input className="field" value={newPlanDraft.subtitle} onChange={(e) => setNewPlanDraft((d) => ({ ...d, subtitle: e.target.value }))} />
              </label>
              <label className="field-label admin-span-full">
                <span>توضیحات</span>
                <textarea className="field field-area admin-compact-area" value={newPlanDraft.description} onChange={(e) => setNewPlanDraft((d) => ({ ...d, description: e.target.value }))} />
              </label>
              <label className="field-label">
                <span>سرعت</span>
                <input className="field" value={newPlanDraft.speedTier} onChange={(e) => setNewPlanDraft((d) => ({ ...d, speedTier: e.target.value }))} />
              </label>
              <label className="field-label">
                <span>حجم</span>
                <input className="field" value={newPlanDraft.dataCap} onChange={(e) => setNewPlanDraft((d) => ({ ...d, dataCap: e.target.value }))} />
              </label>
              <label className="field-label admin-span-full">
                <span>لوکیشن‌ها (با کاما)</span>
                <input className="field" value={joinCsv(newPlanDraft.locations)} onChange={(e) => setNewPlanDraft((d) => ({ ...d, locations: splitCsv(e.target.value) }))} />
              </label>
              <label className="field-label admin-span-full">
                <span>پروتکل‌ها (با کاما)</span>
                <input className="field" value={joinCsv(newPlanDraft.protocols)} onChange={(e) => setNewPlanDraft((d) => ({ ...d, protocols: splitCsv(e.target.value) }))} />
              </label>
              <label className="field-label admin-span-full">
                <span>مزایا (با کاما)</span>
                <textarea className="field field-area admin-compact-area" value={joinCsv(newPlanDraft.perks)} onChange={(e) => setNewPlanDraft((d) => ({ ...d, perks: splitCsv(e.target.value) }))} />
              </label>
            </div>
            <button className="primary-button" onClick={addPlan}>ایجاد پلن</button>
          </div>
        </details>
      </div>
    </div>
  )

  const renderAdminCampaigns = () => (
    <div className="admin-tab-content">
      <div className="admin-stack">
        {state.campaigns.map((c) => (
          <details key={c.id} className="admin-card admin-plan-card admin-editor-card">
            <summary className="admin-plan-summary admin-editor-summary">
              <div className="admin-plan-copy admin-editor-copy">
                <strong>{c.title}</strong>
                <p>{c.code} • {c.reward}</p>
              </div>
              <div className="admin-plan-summary-side">
                <StatusPill tone={c.active ? 'lime' : 'neutral'}>{c.active ? 'فعال' : 'غیرفعال'}</StatusPill>
                <span className="ticket-toggle order-toggle" aria-hidden="true"><ChevronIcon /></span>
              </div>
            </summary>
            <div className="admin-plan-body admin-editor-body">
              <div className="admin-form-grid">
                <label className="field-label">
                  <span>عنوان</span>
                  <input className="field" value={c.title} onChange={(e) => updateCampaignField(c.id, 'title', e.target.value)} />
                </label>
                <label className="field-label">
                  <span>کد تخفیف</span>
                  <input className="field" value={c.code} onChange={(e) => updateCampaignField(c.id, 'code', e.target.value)} />
                </label>
                <label className="field-label">
                  <span>درصد تخفیف</span>
                  <input className="field" type="number" value={c.discountPercent} onChange={(e) => updateCampaignField(c.id, 'discountPercent', Math.max(1, Number(e.target.value)))} />
                </label>
                <label className="field-label">
                  <span>جایزه</span>
                  <input className="field" value={c.reward} onChange={(e) => updateCampaignField(c.id, 'reward', e.target.value)} />
                </label>
                <label className="field-label">
                  <span>وضعیت</span>
                  <select className="field" value={String(c.active)} onChange={(e) => updateCampaignField(c.id, 'active', e.target.value === 'true')}>
                    <option value="true">فعال</option>
                    <option value="false">غیرفعال</option>
                  </select>
                </label>
                <label className="field-label admin-span-full">
                  <span>توضیحات</span>
                  <textarea className="field field-area admin-compact-area" value={c.description} onChange={(e) => updateCampaignField(c.id, 'description', e.target.value)} />
                </label>
              </div>
              <button className="admin-delete-btn" onClick={() => deleteCampaign(c.id)}>حذف کد تخفیف</button>
            </div>
          </details>
        ))}

        <details className="admin-card admin-plan-card admin-editor-card">
          <summary className="admin-plan-summary admin-editor-summary">
            <div className="admin-plan-copy admin-editor-copy">
              <strong>افزودن کد تخفیف جدید</strong>
              <p>کوپن جدیدی بسازید که بلافاصله در checkout نمایش داده می‌شود</p>
            </div>
            <div className="admin-plan-summary-side">
              <span className="ticket-toggle order-toggle" aria-hidden="true"><ChevronIcon /></span>
            </div>
          </summary>
          <div className="admin-plan-body admin-editor-body">
            <div className="admin-form-grid">
              <label className="field-label">
                <span>عنوان</span>
                <input className="field" value={newCampaignDraft.title} onChange={(e) => setNewCampaignDraft((d) => ({ ...d, title: e.target.value }))} />
              </label>
              <label className="field-label">
                <span>کد تخفیف</span>
                <input className="field" value={newCampaignDraft.code} onChange={(e) => setNewCampaignDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))} />
              </label>
              <label className="field-label">
                <span>درصد تخفیف</span>
                <input className="field" type="number" value={newCampaignDraft.discountPercent} onChange={(e) => setNewCampaignDraft((d) => ({ ...d, discountPercent: Math.max(1, Number(e.target.value)) }))} />
              </label>
              <label className="field-label">
                <span>جایزه</span>
                <input className="field" value={newCampaignDraft.reward} onChange={(e) => setNewCampaignDraft((d) => ({ ...d, reward: e.target.value }))} />
              </label>
              <label className="field-label">
                <span>وضعیت اولیه</span>
                <select className="field" value={String(newCampaignDraft.active)} onChange={(e) => setNewCampaignDraft((d) => ({ ...d, active: e.target.value === 'true' }))}>
                  <option value="true">فعال</option>
                  <option value="false">غیرفعال</option>
                </select>
              </label>
              <label className="field-label admin-span-full">
                <span>توضیحات</span>
                <textarea className="field field-area admin-compact-area" value={newCampaignDraft.description} onChange={(e) => setNewCampaignDraft((d) => ({ ...d, description: e.target.value }))} />
              </label>
            </div>
            <button className="primary-button" onClick={addCampaign}>ایجاد کد تخفیف</button>
          </div>
        </details>
      </div>
    </div>
  )

  const renderAdminBroadcast = () => (
    <div className="admin-tab-content">
      <div className="admin-block">
        <p className="admin-block-label">ارسال پیام در ربات</p>
        <div className="admin-card card-frame broadcast-compose">
          <div className="admin-form-grid">
            <label className="field-label admin-span-full">
              <span>عنوان پیام</span>
              <input className="field" value={broadcastTitle} onChange={(e) => setBroadcastTitle(e.target.value)} placeholder="مثال: سرویس جدید اضافه شد" />
            </label>
            <label className="field-label admin-span-full">
              <span>متن پیام</span>
              <textarea className="field field-area" style={{ minHeight: '120px' }} value={broadcastBody} onChange={(e) => setBroadcastBody(e.target.value)} placeholder="متن پیامی که به کاربران ارسال می‌شود..." />
            </label>
          </div>
          {broadcastTitle && broadcastBody && (
            <div className="broadcast-preview">
              <p className="eyebrow">پیش‌نمایش</p>
              <div className="broadcast-preview-bubble">
                <strong>📢 {broadcastTitle}</strong>
                <p>{broadcastBody}</p>
              </div>
            </div>
          )}
          <button className={`primary-button ${broadcastSent ? 'btn-sent' : ''}`} onClick={() => void sendBroadcast()}>
            {broadcastSent ? '✓ ارسال شد' : 'ارسال و کپی پیام'}
          </button>
          <p className="muted-copy" style={{ marginTop: '8px', fontSize: '12px' }}>پیام در فید home منتشر و متن Markdown برای ارسال در ربات کپی می‌شود.</p>
        </div>
      </div>

      <div className="admin-block">
        <p className="admin-block-label">اطلاعیه‌های فید اصلی</p>
        <div className="admin-stack">
          {state.notices.map((notice) => (
            <details key={notice.id} className="admin-card admin-plan-card admin-editor-card">
              <summary className="admin-plan-summary admin-editor-summary">
                <div className="admin-plan-copy admin-editor-copy">
                  <strong>{notice.title}</strong>
                  <p>{notice.message.slice(0, 60)}{notice.message.length > 60 ? '...' : ''}</p>
                </div>
                <div className="admin-plan-summary-side">
                  <span className="plan-meta-chip">{notice.tone}</span>
                  <span className="ticket-toggle order-toggle" aria-hidden="true"><ChevronIcon /></span>
                </div>
              </summary>
              <div className="admin-plan-body admin-editor-body">
                <div className="admin-form-grid">
                  <label className="field-label admin-span-full">
                    <span>عنوان</span>
                    <input className="field" value={notice.title} onChange={(e) => updateNoticeField(notice.id, 'title', e.target.value)} />
                  </label>
                  <label className="field-label admin-span-full">
                    <span>متن</span>
                    <textarea className="field field-area admin-compact-area" value={notice.message} onChange={(e) => updateNoticeField(notice.id, 'message', e.target.value)} />
                  </label>
                  <label className="field-label">
                    <span>رنگ</span>
                    <select className="field" value={notice.tone} onChange={(e) => updateNoticeField(notice.id, 'tone', e.target.value as Notice['tone'])}>
                      {(['lime', 'ice', 'amber'] as const).map((t) => <option key={t} value={t}>{tr(t)}</option>)}
                    </select>
                  </label>
                </div>
                <button className="admin-delete-btn" onClick={() => deleteNotice(notice.id)}>حذف اطلاعیه</button>
              </div>
            </details>
          ))}

          <div className="admin-card card-frame">
            <p className="eyebrow" style={{ marginBottom: '12px' }}>اطلاعیه جدید</p>
            <div className="admin-form-grid">
              <label className="field-label admin-span-full">
                <span>عنوان</span>
                <input className="field" value={adminNoticeTitle} onChange={(e) => setAdminNoticeTitle(e.target.value)} />
              </label>
              <label className="field-label admin-span-full">
                <span>متن</span>
                <textarea className="field field-area admin-compact-area" value={adminNoticeMessage} onChange={(e) => setAdminNoticeMessage(e.target.value)} />
              </label>
              <label className="field-label">
                <span>رنگ</span>
                <select className="field" value={adminNoticeTone} onChange={(e) => setAdminNoticeTone(e.target.value as Notice['tone'])}>
                  {(['lime', 'ice', 'amber'] as const).map((t) => <option key={t} value={t}>{tr(t)}</option>)}
                </select>
              </label>
            </div>
            <button className="primary-button" style={{ marginTop: '12px' }} onClick={publishNotice}>انتشار اطلاعیه</button>
          </div>
        </div>
      </div>
    </div>
  )

  const renderAdminFaq = () => (
    <div className="admin-tab-content">
      <div className="admin-stack">
        {state.faqs.map((faq) => (
          <details key={faq.id} className="admin-card admin-plan-card admin-editor-card">
            <summary className="admin-plan-summary admin-editor-summary">
              <div className="admin-plan-copy admin-editor-copy">
                <strong>{faq.question}</strong>
                <p>{faq.answer.slice(0, 60)}{faq.answer.length > 60 ? '...' : ''}</p>
              </div>
              <div className="admin-plan-summary-side">
                <span className="ticket-toggle order-toggle" aria-hidden="true"><ChevronIcon /></span>
              </div>
            </summary>
            <div className="admin-plan-body admin-editor-body">
              <div className="admin-form-grid">
                <label className="field-label admin-span-full">
                  <span>سوال</span>
                  <input className="field" value={faq.question} onChange={(e) => updateFaqField(faq.id, 'question', e.target.value)} />
                </label>
                <label className="field-label admin-span-full">
                  <span>پاسخ</span>
                  <textarea className="field field-area admin-compact-area" value={faq.answer} onChange={(e) => updateFaqField(faq.id, 'answer', e.target.value)} />
                </label>
              </div>
              <button className="admin-delete-btn" onClick={() => deleteFaq(faq.id)}>حذف سوال</button>
            </div>
          </details>
        ))}

        <div className="admin-card card-frame">
          <p className="eyebrow" style={{ marginBottom: '12px' }}>سوال جدید</p>
          <div className="admin-form-grid">
            <label className="field-label admin-span-full">
              <span>سوال</span>
              <input className="field" value={newFaqDraft.question} onChange={(e) => setNewFaqDraft((d) => ({ ...d, question: e.target.value }))} />
            </label>
            <label className="field-label admin-span-full">
              <span>پاسخ</span>
              <textarea className="field field-area admin-compact-area" value={newFaqDraft.answer} onChange={(e) => setNewFaqDraft((d) => ({ ...d, answer: e.target.value }))} />
            </label>
          </div>
          <button className="primary-button" style={{ marginTop: '12px' }} onClick={addFaq}>افزودن سوال</button>
        </div>
      </div>
    </div>
  )

  const renderAdmin = () => (
    <div className="admin-shell">
      <div className="admin-header">
        <div className="admin-header-info">
          <p className="eyebrow">Admin</p>
          <h2>کنسول مدیریت</h2>
        </div>
        <button className="link-button" onClick={() => switchScreen('profile')}>بازگشت</button>
      </div>

      <div className="admin-tab-bar">
        {adminTabs.map((tab) => (
          <button key={tab.id} className={`admin-tab-chip ${adminTab === tab.id ? 'admin-tab-chip-active' : ''}`} onClick={() => setAdminTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {adminTab === 'dashboard' && renderAdminDashboard()}
      {adminTab === 'services' && renderAdminServices()}
      {adminTab === 'orders' && renderAdminOrders()}
      {adminTab === 'users' && renderAdminUsers()}
      {adminTab === 'plans' && renderAdminPlans()}
      {adminTab === 'campaigns' && renderAdminCampaigns()}
      {adminTab === 'broadcast' && renderAdminBroadcast()}
      {adminTab === 'faq' && renderAdminFaq()}
    </div>
  )

  return (
    <div className={`app-shell ${dir === 'rtl' ? 'language-rtl' : ''}`} dir={dir}>
      <div className="chrome-top">
        <label className="chrome-location chrome-select-shell">
          <GlobeIcon />
          <select className="chrome-select" aria-label={tr('Language')} value={language} onChange={(e) => setLanguage(e.target.value as AppLanguage)}>
            {languageOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
          </select>
        </label>
      </div>

      <header className="masthead">
        <div><h2>Lian</h2></div>
        <button className="ghost-button small" onClick={startTrial}>{tr('Free trial')}</button>
      </header>

      <main className="screen-body">
        {screen === 'home' && renderHome()}
        {screen === 'plans' && renderPlans()}
        {screen === 'services' && renderServices()}
        {screen === 'support' && renderSupport()}
        {screen === 'profile' && renderProfile()}
        {screen === 'admin' && renderAdmin()}
      </main>

      {screen !== 'admin' && (
        <nav className="bottom-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = screen === item.id
            return (
              <button key={item.id} className={`nav-item ${active ? 'nav-item-active' : ''}`} onClick={() => switchScreen(item.id)}>
                <Icon /><span>{tr(item.label)}</span>
              </button>
            )
          })}
        </nav>
      )}

      {purchaseIntent && selectedPlan && (
        <div className="checkout-overlay" onClick={closeCheckout}>
          <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="checkout-header">
              <div>
                <p className="eyebrow">{tr('Checkout')}</p>
                <h2>{tr(selectedPlan.name)}</h2>
              </div>
              <button className="chrome-button" onClick={closeCheckout}><ChevronIcon className="chevron-icon" /></button>
            </div>

            <div className="checkout-summary">
              <div><span>{tr('Mode')}</span><strong>{tr(purchaseIntent.mode)}</strong></div>
              <div><span>{tr('Devices')}</span><strong>{formatNumber(selectedPlan.deviceLimit)}</strong></div>
              <div><span>{tr('Duration')}</span><strong>{daysAccess(selectedPlan.durationDays)}</strong></div>
            </div>

            <div className="coupon-shell">
              <div className="coupon-field-shell">
                <input className="field" placeholder={tr('Promo code')} value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} />
                <button className="ghost-button small icon-button coupon-field-icon" type="button" onClick={() => setIsCheckoutPromoPanelOpen((o) => !o)} aria-label={isCheckoutPromoPanelOpen ? tr('Close') : tr('Discount codes')} aria-expanded={isCheckoutPromoPanelOpen} aria-controls="checkout-promo-panel">
                  {isCheckoutPromoPanelOpen ? <CloseIcon /> : <TagIcon />}
                </button>
              </div>

              {isCheckoutPromoPanelOpen && (
                <div className="promo-popover checkout-promo-popover" id="checkout-promo-panel">
                  <div className="promo-popover-head">
                    <div><p className="eyebrow">{tr('Pick an active code')}</p><h3>{tr('Discount codes')}</h3></div>
                    <button className="ghost-button small icon-button" type="button" onClick={() => setIsCheckoutPromoPanelOpen(false)} aria-label={tr('Close')}><CloseIcon /></button>
                  </div>
                  {featuredCampaigns.length ? (
                    <div className="promo-code-list">
                      {featuredCampaigns.map((c) => (
                        <button key={c.id} className={`promo-code-row promo-select-row ${promoInput === c.code ? 'promo-select-row-active' : ''}`} type="button" onClick={() => applyCheckoutPromoCode(c.code)}>
                          <div><strong>{c.code}</strong><p className="muted-copy">{tr(c.reward)}</p></div>
                          <span className="promo-select-badge">{formatNumber(c.discountPercent)}%</span>
                        </button>
                      ))}
                    </div>
                  ) : <p className="muted-copy">{tr('No active discount codes right now')}</p>}
                </div>
              )}

              {selectedPromo && <p className="muted-copy">{promoApplied(selectedPromo.code, selectedPromo.discountPercent)}</p>}
            </div>

            <div className="checkout-payments">
              {paymentOptions.map((opt) => (
                <button key={opt.id} className={`payment-pill ${paymentMethod === opt.id ? 'payment-pill-active' : ''}`} onClick={() => setPaymentMethod(opt.id)}>{tr(opt.label)}</button>
              ))}
            </div>

            {(paymentMethod === 'card' || paymentMethod === 'crypto') && (
              <div className="bank-transfer-box">
                <div className="bank-transfer-head">
                  <p className="eyebrow">{paymentMethod === 'card' ? tr('Card transfer') : tr('Crypto payment')}</p>
                  <h3>{paymentMethod === 'card' ? tr(bankTransferDetails.note) : tr(cryptoTransferDetails.note)}</h3>
                  <p className="muted-copy">{paymentMethod === 'card' ? tr(bankTransferDetails.warning) : tr(cryptoTransferDetails.warning)}</p>
                </div>
                <div className="payment-details-grid">
                  {paymentMethod === 'card' ? (
                    <>
                      <div className="payment-detail"><span>{tr('Bank')}</span><strong>{tr(bankTransferDetails.bank)}</strong></div>
                      <div className="payment-detail">
                        <div className="payment-detail-head"><span>{tr('Card number')}</span><button className="payment-copy-icon" aria-label={tr('Copy')} title={tr('Copy')} onClick={() => void copyPaymentDetail(bankTransferDetails.cardNumber, tr('Card number'))}><CopyIcon /></button></div>
                        <div className="payment-detail-value"><strong dir="ltr">{bankTransferDetails.cardNumber}</strong></div>
                      </div>
                      <div className="payment-detail payment-detail-full">
                        <div className="payment-detail-head"><span>{tr('IBAN')}</span><button className="payment-copy-icon" aria-label={tr('Copy')} title={tr('Copy')} onClick={() => void copyPaymentDetail(bankTransferDetails.iban, tr('IBAN'))}><CopyIcon /></button></div>
                        <div className="payment-detail-value"><strong dir="ltr">{bankTransferDetails.iban}</strong></div>
                      </div>
                    </>
                  ) : cryptoTransferDetails.wallets.map((wallet) => (
                    <div key={wallet.id} className="payment-detail payment-detail-full">
                      <div className="payment-detail-head"><span>{`${wallet.asset} • ${wallet.network}`}</span><button className="payment-copy-icon" aria-label={tr('Copy')} title={tr('Copy')} onClick={() => void copyPaymentDetail(wallet.address, `${wallet.asset} ${wallet.network}`)}><CopyIcon /></button></div>
                      <div className="payment-detail-value"><strong dir="ltr">{wallet.address}</strong></div>
                    </div>
                  ))}
                </div>
                <label className="ghost-button full-width file-trigger">
                  {checkoutReceiptDraft ? tr('Change receipt screenshot') : tr('Upload receipt screenshot')}
                  <input className="sr-only" type="file" accept="image/*" onChange={(e) => void handleCheckoutReceiptChange(e)} />
                </label>
                {checkoutReceiptDraft ? (
                  <div className="receipt-preview">
                    <img src={checkoutReceiptDraft.image} alt={tr('Receipt screenshot')} />
                    <div><strong>{checkoutReceiptDraft.name}</strong><span>{tr('Receipt attached to this order')}</span></div>
                  </div>
                ) : <p className="muted-copy">{tr('You can also upload the screenshot later from Orders.')}</p>}
              </div>
            )}

            <div className="checkout-total">
              <span>{tr('Total')}</span>
              <strong>{formatMoney(checkoutAmount)}</strong>
            </div>

            <button className="primary-button full-width" onClick={confirmCheckout}>
              {paymentMethod === 'card' || paymentMethod === 'crypto' ? tr('Submit payment request') : tr('Confirm payment')}
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

type SectionHeaderProps = { eyebrow: string; title: string; subtitle?: string; action?: ReactNode }

function SectionHeader({ eyebrow, title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {subtitle && <p className="muted-copy">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

type MetricTileProps = { label: string; value: string; compact?: boolean; icon?: ReactNode; iconOnly?: boolean }

function MetricTile({ label, value, compact, icon, iconOnly }: MetricTileProps) {
  return (
    <div className={`metric-tile ${compact ? 'metric-tile-compact' : ''} ${icon ? 'metric-tile-icon' : ''}`} title={label} aria-label={label}>
      {icon ? (
        <div className="metric-tile-head">
          <span className="metric-tile-icon-shell" aria-hidden="true">{icon}</span>
          {iconOnly ? <span className="sr-only">{label}</span> : <span>{label}</span>}
        </div>
      ) : <span>{label}</span>}
      <strong>{value}</strong>
    </div>
  )
}

type StatusPillProps = { children: ReactNode; tone: 'lime' | 'ice' | 'amber' | 'neutral' }

function StatusPill({ children, tone }: StatusPillProps) {
  return <span className={`status-pill status-${tone}`}>{children}</span>
}

type PlanCardProps = {
  plan: Plan; actionLabel: string; tr: (v: string) => string
  formatMoney: (v: number) => string; daysAccess: (n: number) => string
  devicesCount: (n: number) => string; moreLocations: (n: number) => string; onAction: () => void
}

function PlanCard({ plan, actionLabel, tr, formatMoney, daysAccess, devicesCount, moreLocations, onAction }: PlanCardProps) {
  const visibleLocs = plan.locations.slice(0, 2).map((l) => tr(l)).join(' • ')
  const extra = plan.locations.length > 2 ? ` ${moreLocations(plan.locations.length - 2)}` : ''
  const visiblePerks = plan.perks.slice(0, 2).map((p) => tr(p)).join(' • ')

  return (
    <details className={`plan-card plan-${plan.accent} plan-accordion`}>
      <summary className="plan-summary">
        <div className="plan-top">
          <div className="plan-heading">
            <p className="eyebrow">{tr(plan.badge ?? plan.category)}</p>
            <h3>{tr(plan.name)}</h3>
            <p className="plan-subtitle">{tr(plan.subtitle)}</p>
          </div>
          <div className="plan-summary-side">
            <StatusPill tone={plan.accent === 'amber' ? 'amber' : plan.accent === 'ice' ? 'ice' : 'lime'}>{tr(plan.speedTier)}</StatusPill>
            <span className="ticket-toggle order-toggle" aria-hidden="true"><ChevronIcon /></span>
          </div>
        </div>
        <div className="plan-price-band">
          <div className="plan-price-copy"><strong>{formatMoney(plan.price)}</strong><span>{daysAccess(plan.durationDays)}</span></div>
          <span className="plan-device-pill">{devicesCount(plan.deviceLimit)}</span>
        </div>
      </summary>
      <div className="plan-card-body">
        <p className="plan-description">{tr(plan.description)}</p>
        <div className="plan-meta-row">
          <span className="plan-meta-chip">{`${visibleLocs}${extra}`}</span>
          <span className="plan-meta-chip">{plan.protocols.join(' / ')}</span>
          <span className="plan-meta-chip">{tr(plan.dataCap)}</span>
        </div>
        <p className="plan-note">{visiblePerks}</p>
        <button className="primary-button full-width" onClick={onAction}>{actionLabel}</button>
      </div>
    </details>
  )
}

type OrderCardProps = {
  order: Order; service?: UserService; tr: (v: string) => string
  formatDate: (v: string) => string; formatMoney: (v: number) => string
  formatNumber: (v: number) => string; daysLeft: (n: number) => string
  uptimeLabel: (v: string) => string; onCopy?: () => void; onDownload?: () => void
  onCopyPaymentValue?: (v: string, l: string) => void; onUploadReceipt?: (f: File | null) => void
  onRenew?: () => void; onUpgrade?: () => void
}

function OrderCard({ order, service, tr, formatDate, formatMoney, formatNumber, daysLeft, uptimeLabel, onCopy, onDownload, onCopyPaymentValue, onUploadReceipt, onRenew, onUpgrade }: OrderCardProps) {
  const compactConfig = service
    ? service.configCode.length > 36 ? `${service.configCode.slice(0, 16)}...${service.configCode.slice(-8)}` : service.configCode
    : ''
  const awaitingTransfer = (order.paymentMethod === 'card' || order.paymentMethod === 'crypto') && order.status === 'processing'

  return (
    <details className="service-card card-frame order-card order-accordion">
      <summary className="order-card-head order-summary">
        <div className="order-card-copy">
          <div className="stat-line">
            <StatusPill tone={order.status === 'paid' ? 'lime' : 'amber'}>{tr(order.status)}</StatusPill>
            <span>{tr(order.kind)}</span>
          </div>
          <h3>{tr(order.planName)}</h3>
          <p className="muted-copy">{formatDate(order.createdAt)} • {tr(order.paymentMethod)}</p>
        </div>
        <div className="order-card-side">
          <strong>{formatMoney(order.amount)}</strong>
          <div className="order-summary-side">
            {service && (
              <StatusPill tone={service.status === 'active' ? 'lime' : service.status === 'expiring' ? 'amber' : service.status === 'trial' ? 'ice' : 'neutral'}>
                {tr(service.status === 'active' ? 'Active' : service.status === 'expiring' ? 'Expiring' : service.status === 'trial' ? 'Trial' : 'Expired')}
              </StatusPill>
            )}
            <span className="ticket-toggle order-toggle" aria-hidden="true"><ChevronIcon /></span>
          </div>
        </div>
      </summary>

      {service ? (
        <div className="order-card-body">
          <div className="mini-stats order-card-grid">
            <MetricTile label={tr('Ping')} value={`${formatNumber(service.latency)}ms`} compact />
            <MetricTile label={tr('Devices')} value={`${formatNumber(service.devicesInUse)}/${formatNumber(service.deviceLimit)}`} compact />
            <MetricTile label={tr('Expires')} value={formatDate(service.expiresAt)} compact />
          </div>
          <div className="order-card-meta">
            <span className="plan-meta-chip">{tr(service.region)}</span>
            <span className="plan-meta-chip">{service.protocol}</span>
            <span className="plan-meta-chip">{daysLeft(Math.max(0, Math.ceil((new Date(service.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))))}</span>
            <span className="plan-meta-chip">{uptimeLabel(service.uptime)}</span>
          </div>
          <div className="config-shell order-card-config">
            <div className="service-config-main"><span>{tr('Config')}</span><code>{compactConfig}</code></div>
            <div className="service-config-actions">
              {onCopy && <button className="ghost-button small" onClick={onCopy}>{tr('Copy')}</button>}
              {onDownload && <button className="ghost-button small" onClick={onDownload}>{tr('Download')}</button>}
            </div>
          </div>
          <div className="service-actions order-card-actions">
            {onRenew && <button className="primary-button" onClick={onRenew}>{tr('Renew')}</button>}
            {onUpgrade && <button className="ghost-button" onClick={onUpgrade}>{tr('Upgrade')}</button>}
          </div>
        </div>
      ) : awaitingTransfer ? (
        <div className="order-card-body">
          <div className="bank-transfer-box order-transfer-box">
            <div className="bank-transfer-head">
              <p className="eyebrow">{order.paymentMethod === 'card' ? tr('Awaiting transfer') : tr('Awaiting crypto payment')}</p>
              <h3>{order.paymentMethod === 'card' ? tr(bankTransferDetails.note) : tr(cryptoTransferDetails.note)}</h3>
              <p className="muted-copy">{order.paymentMethod === 'card' ? tr(bankTransferDetails.warning) : tr(cryptoTransferDetails.warning)}</p>
            </div>
            <div className="payment-details-grid">
              {order.paymentMethod === 'card' ? (
                <>
                  <div className="payment-detail"><span>{tr('Bank')}</span><strong>{tr(bankTransferDetails.bank)}</strong></div>
                  <div className="payment-detail">
                    <div className="payment-detail-head"><span>{tr('Card number')}</span><button className="payment-copy-icon" aria-label={tr('Copy')} title={tr('Copy')} onClick={() => onCopyPaymentValue?.(bankTransferDetails.cardNumber, tr('Card number'))}><CopyIcon /></button></div>
                    <div className="payment-detail-value"><strong dir="ltr">{bankTransferDetails.cardNumber}</strong></div>
                  </div>
                  <div className="payment-detail payment-detail-full">
                    <div className="payment-detail-head"><span>{tr('IBAN')}</span><button className="payment-copy-icon" aria-label={tr('Copy')} title={tr('Copy')} onClick={() => onCopyPaymentValue?.(bankTransferDetails.iban, tr('IBAN'))}><CopyIcon /></button></div>
                    <div className="payment-detail-value"><strong dir="ltr">{bankTransferDetails.iban}</strong></div>
                  </div>
                </>
              ) : cryptoTransferDetails.wallets.map((wallet) => (
                <div key={wallet.id} className="payment-detail payment-detail-full">
                  <div className="payment-detail-head"><span>{`${wallet.asset} • ${wallet.network}`}</span><button className="payment-copy-icon" aria-label={tr('Copy')} title={tr('Copy')} onClick={() => onCopyPaymentValue?.(wallet.address, `${wallet.asset} ${wallet.network}`)}><CopyIcon /></button></div>
                  <div className="payment-detail-value"><strong dir="ltr">{wallet.address}</strong></div>
                </div>
              ))}
            </div>
            <label className="ghost-button full-width file-trigger">
              {order.receiptImage ? tr('Change receipt screenshot') : tr('Upload receipt screenshot')}
              <input className="sr-only" type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; onUploadReceipt?.(f) }} />
            </label>
            {order.receiptImage ? (
              <div className="receipt-preview">
                <img src={order.receiptImage} alt={tr('Receipt screenshot')} />
                <div><strong>{order.receiptFileName ?? tr('Receipt uploaded')}</strong><span>{order.receiptUploadedAt ? `${tr('Receipt uploaded on')} ${formatDate(order.receiptUploadedAt)}` : tr('Receipt attached to this order')}</span></div>
              </div>
            ) : <div className="order-card-meta"><span className="plan-meta-chip">{tr('Receipt pending')}</span></div>}
          </div>
        </div>
      ) : (
        <div className="order-card-body">
          <div className="order-card-meta"><span className="plan-meta-chip">{tr('No active plan')}</span></div>
        </div>
      )}
    </details>
  )
}

type IconProps = { className?: string }

function HomeIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10.5L12 4l8 6.5V20H4v-9.5z" stroke="currentColor" strokeWidth="1.8" /><path d="M9 20v-5h6v5" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function LayersIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4l8 4-8 4-8-4 8-4z" stroke="currentColor" strokeWidth="1.8" /><path d="M4 12l8 4 8-4" stroke="currentColor" strokeWidth="1.8" /><path d="M4 16l8 4 8-4" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function ShieldIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l7 3v5c0 5.1-2.8 8.6-7 10-4.2-1.4-7-4.9-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.8" /><path d="M9.5 12.5l1.8 1.8 3.7-4.1" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function ChatIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7.5A3.5 3.5 0 018.5 4h7A3.5 3.5 0 0119 7.5v5A3.5 3.5 0 0115.5 16H10l-4 4v-4.5A3.5 3.5 0 015 12.5v-5z" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function UserIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" /><path d="M5.5 19.5c1.8-3 4.1-4.5 6.5-4.5s4.7 1.5 6.5 4.5" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function ChevronIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function GlobeIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" /><path d="M4 12h16" stroke="currentColor" strokeWidth="1.8" /><path d="M12 4c2.6 2.3 4 5 4 8s-1.4 5.7-4 8c-2.6-2.3-4-5-4-8s1.4-5.7 4-8z" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function TagIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M11 4H6.5A2.5 2.5 0 004 6.5V11l7.8 7.8a1.5 1.5 0 002.1 0l5-5a1.5 1.5 0 000-2.1L11 4z" stroke="currentColor" strokeWidth="1.8" /><circle cx="8" cy="8" r="1.25" fill="currentColor" /></svg>
}
function ReceiptIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4.5h10v15l-2.1-1.6-2.1 1.6-2.1-1.6-2.1 1.6V4.5z" stroke="currentColor" strokeWidth="1.8" /><path d="M9.5 9h5M9.5 12h5" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function WalletIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7.5A2.5 2.5 0 017.5 5h9A2.5 2.5 0 0119 7.5v9a2.5 2.5 0 01-2.5 2.5h-9A2.5 2.5 0 015 16.5v-9z" stroke="currentColor" strokeWidth="1.8" /><path d="M5 9h14" stroke="currentColor" strokeWidth="1.8" /><circle cx="15.5" cy="13.5" r="1.1" fill="currentColor" /></svg>
}
function CalendarIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="6" width="14" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="M8 4.5v3M16 4.5v3M5 10h14" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function LaunchIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 15L15 9" stroke="currentColor" strokeWidth="1.8" /><path d="M10 7h7v7" stroke="currentColor" strokeWidth="1.8" /><path d="M18 13v4A2 2 0 0116 19H7a2 2 0 01-2-2V8a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function CopyIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="7" width="10" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.8" /><path d="M7 15H6a2 2 0 01-2-2V6a2 2 0 012-2h7a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.8" /></svg>
}
function CloseIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10" stroke="currentColor" strokeWidth="1.8" /><path d="M17 7L7 17" stroke="currentColor" strokeWidth="1.8" /></svg>
}

export default App
