# راهنمای اتصال به تلگرام — Lian VPN Mini App

## مشکل چی بود؟

دو چیز از `index.html` حذف شده بود:
1. اسکریپت `telegram-web-app.js` — بدون این، `window.Telegram` هرگز تعریف نمی‌شه
2. فونت `Vazirmatn` — فونت فارسی پروژه

---

## مراحل اتصال به تلگرام

### ۱. ساخت بات با BotFather

```
1. در تلگرام با @BotFather صحبت کنید
2. دستور /newbot را بزنید
3. نام و username بات را وارد کنید
4. توکن API را کپی کنید (مثال: 7812345678:AAF...)
```

### ۲. تنظیم Menu Button / Mini App

```
در BotFather:
/mybots → انتخاب بات → Bot Settings → Menu Button → Edit Menu Button URL

یا برای Mini App رسمی:
/newapp → انتخاب بات → نام اپ → توضیحات → آپلود عکس → وارد کردن URL دپلوی
```

### ۳. دپلوی روی Vercel

```bash
# نصب Vercel CLI
npm i -g vercel

# در پوشه پروژه
npm install
npm run build
vercel --prod
```

URL نهایی را از Vercel بگیرید (مثال: `https://lian-vpn.vercel.app`)

### ۴. تنظیم URL در BotFather

```
در BotFather:
/mybots → بات خود → Bot Settings → Menu Button
→ Set Menu Button URL → وارد کردن URL Vercel خود
```

### ۵. تست

```
1. بات را باز کنید
2. دکمه Menu را بزنید (یا لینک t.me/YOUR_BOT/app)
3. Mini App باز می‌شود
4. window.Telegram.WebApp.initDataUnsafe.user حاوی اطلاعات کاربر است
```

---

## نحوه کارکرد اتصال در کد

```typescript
// src/lib/telegram.ts

// این کتابخانه از window.Telegram.WebApp که توسط
// اسکریپت تلگرام inject می‌شود استفاده می‌کند

export const getTelegramUser = () =>
  window.Telegram?.WebApp?.initDataUnsafe?.user
  // اگر خارج از تلگرام باز شود → undefined
  // اگر داخل تلگرام باز شود → { id, first_name, username, ... }

export const initTelegramShell = () => {
  const app = window.Telegram?.WebApp
  if (!app) return null  // در مرورگر معمولی کاری نمی‌کند

  app.ready()           // به تلگرام می‌گوید اپ آماده است
  app.expand()          // Mini App را به تمام صفحه گسترش می‌دهد
  app.disableVerticalSwipes?.() // جلوگیری از بستن با swipe پایین
}
```

---

## محیط توسعه (localhost)

وقتی با `npm run dev` اجرا می‌کنید، در مرورگر معمولی هستید.
تلگرام SDK وجود ندارد، پس:
- `getTelegramUser()` → `undefined` برمی‌گرداند
- `initTelegramShell()` → هیچ‌کاری نمی‌کند
- اپ با داده پیش‌فرض کار می‌کند (بدون اسم کاربر تلگرام)

برای تست واقعی، باید URL دپلوی‌شده را در تلگرام باز کنید.

---

## ساختار فایل‌ها

```
project/
├── index.html          ← اسکریپت تلگرام + فونت Vazirmatn اینجا است
├── src/
│   ├── lib/
│   │   └── telegram.ts ← اتصال به window.Telegram.WebApp
│   ├── main.tsx
│   ├── App.tsx
│   └── mockData.ts     ← داده‌های اولیه (بدون فیک)
├── api/
│   └── purchase-notify.js ← Vercel serverless — ایمیل اطلاع‌رسانی
├── .env.example        ← تنظیمات SMTP برای ایمیل
└── vercel.json         ← routing برای Vercel
```

---

## متغیرهای محیطی (Vercel Dashboard)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password   ← App Password از Google، نه پسورد اصلی
SMTP_FROM=your@gmail.com
PURCHASE_NOTIFY_TO=your@gmail.com
```

در Vercel Dashboard:
`Settings → Environment Variables → اضافه کردن هر متغیر`
