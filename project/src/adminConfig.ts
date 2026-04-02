const ADMIN_IDS: number[] = [
  8461153976  // ← ID تلگرام خودت از @userinfobot
]

export const isAdmin = (id?: number): boolean =>
  id != null && ADMIN_IDS.includes(id)
