import { createInitialState } from '../mockData'
import type { PersistentState, TelegramUserProfile } from '../types'

const STORAGE_KEY = 'lian-vpn-miniapp-state-v2'

const deepClone = <T,>(value: T) => JSON.parse(JSON.stringify(value)) as T

export const loadPersistentState = (telegramUser?: TelegramUserProfile): PersistentState => {
  const fallback = createInitialState(telegramUser)

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback

    const parsed = JSON.parse(raw) as PersistentState

    // اصلاح شرط با || و جلوگیری از Syntax Error
    if (
      !parsed ||
      !parsed.profile ||
      !Array.isArray(parsed.plans) ||
      !Array.isArray(parsed.services) ||
      !Array.isArray(parsed.orders)
    ) {
      return fallback
    }

    return {
      ...fallback,
      ...parsed,
      profile: {
        ...fallback.profile,
        ...parsed.profile,
        firstName: telegramUser?.first_name ?? parsed.profile.firstName,
        username: telegramUser?.username ?? parsed.profile.username,
        avatarUrl: telegramUser?.photo_url ?? parsed.profile.avatarUrl,
        premium: telegramUser?.is_premium ?? parsed.profile.premium,
      },
      // اصلاح walletCredit تا دوبار تعریف نشه
      customers: (parsed.customers ?? []).map((c) => ({
        ...c,
        walletCredit: c.walletCredit ?? 0,
      })),
    }
  } catch {
    return fallback
  }
}

export const savePersistentState = (state: PersistentState) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export const resetPersistentState = (telegramUser?: TelegramUserProfile) =>
  deepClone(createInitialState(telegramUser))
