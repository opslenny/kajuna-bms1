import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Boxes, ChartNoAxesCombined, CreditCard, LayoutDashboard, Package, Receipt, RefreshCw, Search, Settings2, ShoppingCart, Users, WalletCards, X } from 'lucide-react'
import './App.css'
import { translate } from './i18n.js'
import UnifiedSidebar from './components/UnifiedSidebar.jsx'

const navigation = [
  { title: 'Dashboard', items: ['Overview', 'Performance', 'Reports'] },
  { title: 'Reports', items: ['Monthly Financial Reports', 'Custom Date-Range Reports', 'Generated Reports'] },
  { title: 'Products', items: ['All Products', 'Add Product', 'Categories'] },
  { title: 'Inventory', items: ['Stock', 'Stock Adjustments', 'Low Stock'] },
  { title: 'Sales', items: ['New Sale / POS', 'Sales History', 'Receipts'] },
  { title: 'Expenses', items: ['Expenses', 'Add Expense'] },
  { title: 'Debts', items: ['Customer Debts', 'Add Customer', 'Debt Reports'] },
  { title: 'Reports', items: ['Daily Sales', 'Weekly Sales', 'Monthly Sales', 'Profit', 'Expenses'] },
  { title: 'Users', items: ['Sales Agents', 'User Management'] },
  { title: 'Subscription', items: ['Current Plan', 'Subscription Status', 'Payments'] },
  { title: 'Settings', items: ['Business Profile', 'System Settings'] },
]

const navigationViews = {
  Overview: 'overview',
  Performance: 'performance',
  Reports: 'transactions',
  'Monthly Financial Reports': 'overview',
  'Custom Date-Range Reports': 'overview',
  'Generated Reports': 'overview',
  'All Products': 'products',
  'Add Product': 'products',
  Categories: 'products',
  Stock: 'products',
  'Stock Adjustments': 'products',
  'Low Stock': 'products',
  'New Sale / POS': 'sales',
  'Sales History': 'transactions',
  Receipts: 'transactions',
  Expenses: 'costs',
  'Add Expense': 'costs',
  'Customer Debts': 'debts',
  'Add Customer': 'debts',
  'Debt Reports': 'debts',
  'Daily Sales': 'transactions',
  'Weekly Sales': 'transactions',
  'Monthly Sales': 'transactions',
  Profit: 'transactions',
  'Sales Agents': 'team',
  'User Management': 'team',
  'Current Plan': 'subscription',
  'Subscription Status': 'subscription',
  Payments: 'subscription',
  'Business Profile': 'settings',
  'System Settings': 'settings',
}

const navigationIconComponents = {
  Dashboard: LayoutDashboard,
  Products: Package,
  Inventory: Boxes,
  Sales: ShoppingCart,
  Expenses: WalletCards,
  Debts: Receipt,
  Reports: ChartNoAxesCombined,
  Users,
  Subscription: CreditCard,
  Settings: Settings2,
}

function GroupNavIcon({ title }) {
  const Icon = navigationIconComponents[title] || LayoutDashboard
  return <Icon size={16} strokeWidth={1.8} />
}

function PreferenceControls({ theme, language, onThemeChange, onLanguageChange }) {
  const t = (text) => translate(text, language)
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  return (
    <div className="preference-controls" aria-label={t('Appearance and language')}>
      <button
        type="button"
        className="theme-toggle"
        aria-label={t(nextTheme === 'dark' ? 'Switch to dark mode' : 'Switch to light mode')}
        title={t(nextTheme === 'dark' ? 'Switch to dark mode' : 'Switch to light mode')}
        aria-pressed={theme === 'dark'}
        onClick={() => onThemeChange(nextTheme)}
      >
        {theme === 'dark' ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z" /></svg>
        )}
      </button>
            <button
        type="button"
        className="language-switch"
        aria-label={t('Language')}
        title={t('Language')}
        onClick={() => onLanguageChange(language === 'en' ? 'sw' : 'en')}
      >
        {language === 'en' ? 'EN' : 'SW'}
      </button>
    </div>
  )
}

function PasswordField({
  label,
  className = 'login-input',
  visuallyHiddenLabel = true,
  ...inputProps
}) {
  const [visible, setVisible] = useState(false)
  const toggleLabel = `${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`

  return (
    <label className={className}>
      <span className={visuallyHiddenLabel ? 'sr-only' : undefined}>{label}</span>
      <span className="password-input-wrap">
        <input {...inputProps} type={visible ? 'text' : 'password'} />
        <button
          type="button"
          className="password-visibility-toggle"
          aria-label={toggleLabel}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? (
            <svg
              className="password-eye-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg
              className="password-eye-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" x2="22" y1="2" y2="22" />
            </svg>
          )}
        </button>
      </span>
    </label>
  )
}

const metricCards = [
  { label: 'Total Revenue', key: 'revenue', tone: 'blue', icon: '↗' },
  { label: 'Total Expenses', key: 'expenses', tone: 'orange', icon: '−' },
  { label: 'Net Profit', key: 'netProfit', tone: 'purple', icon: '⌁' },
  { label: 'Cash Flow', key: 'cashFlow', tone: 'teal', icon: '⇄' },
]

function getMetricComparison(currentValue, previousValue, metricKey, language) {
  if (!Number.isFinite(previousValue) || previousValue === 0) {
    return { label: translate('No prior-period data', language), tone: 'neutral' }
  }
  const change = ((currentValue - previousValue) / Math.abs(previousValue)) * 100
  if (Math.abs(change) < 0.05) return { label: translate('No change vs previous month', language), tone: 'neutral' }
  const favorable = metricKey === 'expenses' ? change < 0 : change > 0
  const formatted = new Intl.NumberFormat(language === 'sw' ? 'sw-TZ' : 'en-TZ', {
    maximumFractionDigits: 1,
    signDisplay: 'always',
  }).format(change)
  return {
    label: `${formatted}% ${translate('vs previous month', language)}`,
    tone: favorable ? 'positive' : 'negative',
  }
}

const supportedCurrencies = ['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP']
const supportedImageMimeTypes = ['image/png', 'image/jpeg', 'image/webp']
const maxImageBytes = 5 * 1024 * 1024

function UserAvatar({ user, className = 'mini-avatar' }) {
  const initials = user?.name?.split(' ').map((part) => part[0]).join('').slice(0, 2) || '?'
  return (
    <span className={`${className}${user?.profileImageUpdatedAt ? ' has-profile-image' : ''}`}>
      {user?.profileImageUpdatedAt
        ? <img src={`/api/auth/profile-image?v=${encodeURIComponent(user.profileImageUpdatedAt)}`} alt="" />
        : initials}
    </span>
  )
}

function ProfileImageControl({ user, language, onUpdated, onNotice }) {
  const t = (text) => translate(text, language)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : '', [file])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function selectImage(event) {
    const selected = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!selected) return
    if (!supportedImageMimeTypes.includes(selected.type)) {
      onNotice(t('Choose a JPG, PNG, or WebP image.'))
      return
    }
    if (selected.size > maxImageBytes) {
      onNotice(t('Images must be no larger than 5 MB.'))
      return
    }
    setFile(selected)
  }

  async function saveImage() {
    if (!file) return
    setBusy(true)
    try {
      const result = await apiRequest('/auth/profile-image', {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      setFile(null)
      onUpdated(result.profileImageUpdatedAt)
      onNotice(t('Profile photo updated.'))
    } catch (error) {
      onNotice(t(error.message))
    } finally {
      setBusy(false)
    }
  }

  async function removeImage() {
    setBusy(true)
    try {
      await apiRequest('/auth/profile-image', { method: 'DELETE' })
      setFile(null)
      onUpdated(null)
      onNotice(t('Profile photo removed.'))
    } catch (error) {
      onNotice(t(error.message))
    } finally {
      setBusy(false)
    }
  }

  const displayedUser = previewUrl ? { ...user, profileImageUpdatedAt: null } : user
  return (
    <div className="profile-image-control">
      <div className="profile-image-control-user">
        {previewUrl ? <span className="mini-avatar has-profile-image"><img src={previewUrl} alt={t('Profile photo preview')} /></span> : <UserAvatar user={displayedUser} />}
        <div><strong>{user?.name}</strong><small>{t('Profile photo')}</small></div>
      </div>
      <div className="profile-image-control-actions">
        {file ? <>
          <button type="button" className="ghost-button small" onClick={() => setFile(null)} disabled={busy}>{t('Cancel')}</button>
          <button type="button" className="primary-button small" onClick={saveImage} disabled={busy}>{busy ? t('Saving…') : t('Save photo')}</button>
        </> : <>
          <label className="ghost-button small profile-photo-trigger" onClick={() => { if (inputRef.current) { inputRef.current.value = ''; setFile(null); setError('') } }}>
  {user?.profileImageUpdatedAt ? t('Change photo') : t('Add photo')}
  <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={selectImage} className="sr-only" aria-label={t('Choose profile photo')} />
</label>
          {user?.profileImageUpdatedAt && <button type="button" className="text-action danger-action" onClick={removeImage} disabled={busy}>{busy ? t('Removing…') : t('Remove')}</button>}
        </>}
      </div>
    </div>
  )
}

const emptyDashboard = {
  metrics: { todaySales: 0, todayExpenses: 0, revenue: 0, profit: 0, expenses: 0, netProfit: 0, cashFlow: 0, productsSold: 0, lowStock: 0, productCount: 0 },
  chart: [],
  expenseBreakdown: [],
  recentTransactions: [],
  subscription: null,
  currency: 'TZS',
}

const now = new Date()
const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const weekBefore = new Date(now)
weekBefore.setDate(weekBefore.getDate() - 6)
const customRangeDefaultStart = `${weekBefore.getFullYear()}-${String(weekBefore.getMonth() + 1).padStart(2, '0')}-${String(weekBefore.getDate()).padStart(2, '0')}`

function formatCurrency(amount, currencyCode = 'TZS') {
  return new Intl.NumberFormat('en-TZ', {
    style: 'currency',
    currency: currencyCode,
  }).format(amount)
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  if (response.status === 204) return null
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.')
  return payload
}

const maxBusinessLogoBytes = 5 * 1024 * 1024
const businessLogoMimeTypes = ['image/png', 'image/jpeg', 'image/webp']

function productForPos(product) {
  return {
    id: product.id,
    label: product.name,
    sku: product.sku,
    barcode: product.barcode,
    description: product.description,
    categoryId: product.categoryId,
    price: product.sellingPrice,
    buyingPrice: product.buyingPrice,
    stock: product.stock,
    reorderLevel: product.reorderLevel,
    imageUrl: product.imageUrl,
    imageUpdatedAt: product.imageUpdatedAt,
    tone: 'blue',
  }
}

function PerformanceGraph({ chart, currencyCode, language = 'en' }) {
  const width = 960
  const height = 330
  const padding = { top: 24, right: 24, bottom: 48, left: 88 }
  const plotRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(null)
  const [hiddenSeries, setHiddenSeries] = useState([])
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const values = chart.flatMap((point) => [point.revenue, point.expenses, point.netProfit])
  const minimum = Math.min(0, ...values)
  const maximum = Math.max(1, ...values)
  const valueRange = maximum - minimum || 1
  const x = (index) => padding.left + (chart.length < 2 ? plotWidth / 2 : (index / (chart.length - 1)) * plotWidth)
  const y = (value) => padding.top + ((maximum - value) / valueRange) * plotHeight
  const smoothPath = (points) => {
    if (points.length < 2) return ''
    const coordinates = points.map((point, index) => [x(index), y(point)])
    return coordinates.reduce((path, current, index) => {
      if (index === 0) return `M ${current[0]} ${current[1]}`
      const previous = coordinates[index - 1]
      const beforePrevious = coordinates[index - 2] || previous
      const next = coordinates[index + 1] || current
      const control1 = [
        previous[0] + (current[0] - beforePrevious[0]) / 6,
        previous[1] + (current[1] - beforePrevious[1]) / 6,
      ]
      const control2 = [
        current[0] - (next[0] - previous[0]) / 6,
        current[1] - (next[1] - previous[1]) / 6,
      ]
      return `${path} C ${control1[0]} ${control1[1]}, ${control2[0]} ${control2[1]}, ${current[0]} ${current[1]}`
    }, '')
  }
  const series = [
    { key: 'revenue', label: translate('Revenue', language), color: '#35cbbb' },
    { key: 'expenses', label: translate('Expenses', language), color: '#f59e0b' },
    { key: 'netProfit', label: translate('Net Profit', language), color: '#9b83ff' },
  ]
  const labelIndexes = [...new Set([0, Math.floor((chart.length - 1) / 4), Math.floor((chart.length - 1) / 2), Math.floor(((chart.length - 1) * 3) / 4), chart.length - 1])]
    .filter((index) => index >= 0)
  const selectPoint = (event) => {
    if (chart.length < 1 || !plotRef.current) return
    const bounds = plotRef.current.getBoundingClientRect()
    const svgX = (event.clientX - bounds.left) / bounds.width * width
    const relativeX = Math.max(0, Math.min(1, (svgX - padding.left) / plotWidth))
    setActiveIndex(Math.round(relativeX * Math.max(0, chart.length - 1)))
  }
  const activePoint = activeIndex === null ? null : chart[activeIndex]
  const activeX = activeIndex === null ? null : x(activeIndex)

  return (
    chart.length === 0 ? <p className="dashboard-chart-empty" role="status">{translate('No financial activity is available for this period.', language)}</p> : <div className="performance-chart">
      <div className="performance-legend" aria-label="Graph series">
        {series.map((item) => (
          <button
            type="button"
            key={item.key}
            aria-pressed={!hiddenSeries.includes(item.key)}
            className={hiddenSeries.includes(item.key) ? 'series-toggle is-hidden' : 'series-toggle'}
            onClick={() => setHiddenSeries((current) => current.includes(item.key)
              ? current.filter((key) => key !== item.key)
              : [...current, item.key])}
          ><i style={{ backgroundColor: item.color }} />{item.label}</button>
        ))}
      </div>
      <div className="performance-plot" ref={plotRef}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={translate('Business revenue, expenses, and net profit over time', language)}
          onPointerMove={selectPoint}
          onPointerDown={selectPoint}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') setActiveIndex(null)
          }}
        >
          {[0, 0.5, 1].map((fraction) => {
            const value = maximum - valueRange * fraction
            const lineY = y(value)
            return (
              <g key={fraction}>
                <line x1={padding.left} y1={lineY} x2={width - padding.right} y2={lineY} className="chart-grid-line" />
                <text x={padding.left - 12} y={lineY + 4} className="chart-axis-label" textAnchor="end">{formatCurrency(value, currencyCode)}</text>
              </g>
            )
          })}
          {series.map((item) => {
            if (hiddenSeries.includes(item.key)) return null
            const path = smoothPath(chart.map((point) => point[item.key]))
            return (
              <g key={item.key}>
                {chart.length > 1 && <path d={path} fill="none" stroke={item.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
                {activePoint && (
                  <circle cx={x(activeIndex)} cy={y(activePoint[item.key])} r="5" fill={item.color} className="chart-active-dot" />
                )}
                {chart.length < 2 && chart.map((point, index) => (
                  <circle key={point.date} cx={x(index)} cy={y(point[item.key])} r="4" fill={item.color}>
                    <title>{`${point.date}: ${item.label} ${formatCurrency(point[item.key], currencyCode)}`}</title>
                  </circle>
                ))}
              </g>
            )
          })}
          {activePoint && (
            <line x1={activeX} y1={padding.top} x2={activeX} y2={height - padding.bottom} className="chart-crosshair" />
          )}
          {labelIndexes.map((index) => (
            <text key={chart[index]?.date} x={x(index)} y={height - 14} className="chart-axis-label" textAnchor="middle">
              {chart[index]?.label}
            </text>
          ))}
        </svg>
        {activePoint && (
          <div
            className="chart-tooltip"
            style={{
              left: `${activeX / width * 100}%`,
              transform: activeX / width < 0.2 ? 'none' : activeX / width > 0.8 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            <strong>{new Date(`${activePoint.date}T00:00:00`).toLocaleDateString(language === 'sw' ? 'sw-TZ' : 'en-TZ', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
            {series.map((item) => (
              <span key={item.key}><i style={{ backgroundColor: item.color }} />{item.label}<b>{formatCurrency(activePoint[item.key], currencyCode)}</b></span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ExpenseBreakdown({ expenses = [], currencyCode, language = 'en' }) {
  const colors = ['#36d5c7', '#4398ff', '#a98aff', '#f2a65a', '#ef6f8e', '#60c68b', '#f0d264', '#8794ad']
  const [selectedCategory, setSelectedCategory] = useState(null)
  const t = (text) => translate(text, language)
  const total = expenses.reduce((sum, item) => sum + item.amount, 0)
  const selected = expenses.find((item) => item.category === selectedCategory)
  const slices = expenses.map((item, index) => {
    const start = total > 0
      ? expenses.slice(0, index).reduce((sum, expense) => sum + expense.amount, 0) / total * 360
      : 0
    const end = start + (total > 0 ? item.amount / total * 360 : 0)
    const point = (degrees, radius) => {
      const radians = (degrees - 90) * Math.PI / 180
      return [100 + radius * Math.cos(radians), 100 + radius * Math.sin(radians)]
    }
    const [startX, startY] = point(start, 75)
    const [endX, endY] = point(end, 75)
    const largeArc = end - start > 180 ? 1 : 0
    return {
      ...item,
      color: colors[index % colors.length],
      path: `M ${startX} ${startY} A 75 75 0 ${largeArc} 1 ${endX} ${endY}`,
    }
  })
  return (
    <section className="panel expense-breakdown-panel">
      <div className="panel-header">
        <div><p className="eyebrow">{t('Expense Breakdown')}</p><h3>{t('Expenses by category')}</h3></div>
      </div>
      {slices.length ? (
        <>
          <div className="expense-donut-wrap">
            <svg className="expense-donut" viewBox="0 0 200 200" role="img" aria-label={t('Expenses by category')}>
              <circle cx="100" cy="100" r="75" className="donut-track" />
              {slices.map((slice) => (
                <path
                  key={slice.category}
                  d={slice.path}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={selectedCategory === slice.category ? 29 : 24}
                  strokeLinecap="butt"
                  className="donut-segment"
                  role="button"
                  tabIndex="0"
                  aria-label={`${slice.category}: ${formatCurrency(slice.amount, currencyCode)} (${slice.percentage.toFixed(1)}%)`}
                  onClick={() => setSelectedCategory(slice.category)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setSelectedCategory(slice.category)
                  }}
                />
              ))}
              <text x="100" y="94" textAnchor="middle" className="donut-total-label">{selected ? selected.category : t('Total expenses')}</text>
              <text x="100" y="116" textAnchor="middle" className="donut-total-value">{formatCurrency(selected?.amount ?? total, currencyCode)}</text>
            </svg>
          </div>
          <div className="expense-legend">
            {slices.map((slice) => (
              <button type="button" key={slice.category} className={selectedCategory === slice.category ? 'expense-legend-row selected' : 'expense-legend-row'} onClick={() => setSelectedCategory(slice.category)}>
                <i style={{ backgroundColor: slice.color }} />
                <span>{slice.category}</span>
                <b>{slice.percentage.toFixed(1)}%</b>
                <small>{formatCurrency(slice.amount, currencyCode)}</small>
              </button>
            ))}
          </div>
        </>
      ) : <p className="empty-table">{t('No expenses have been recorded in this period.')}</p>}
    </section>
  )
}

function ToastItem({ toast, onDismiss, language }) {
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const timeoutRef = useRef(null)
  const startedAtRef = useRef(0)
  const remainingRef = useRef(toast.duration)
  const t = (text) => translate(text, language)

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => onDismiss(toast.id), 180)
  }, [onDismiss, toast.id])

  const resumeTimer = useCallback(() => {
    if (closingRef.current) return
    startedAtRef.current = Date.now()
    timeoutRef.current = window.setTimeout(close, remainingRef.current)
  }, [close])

  const pauseTimer = useCallback(() => {
    if (closingRef.current) return
    window.clearTimeout(timeoutRef.current)
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
  }, [])

  useEffect(() => {
    resumeTimer()
    return () => window.clearTimeout(timeoutRef.current)
  }, [resumeTimer])

  const icon = toast.type === 'success' ? '✓' : toast.type === 'warning' ? '!' : toast.type === 'error' ? '×' : 'i'
  return (
    <article
      className={`toast-card toast-${toast.type}${closing ? ' toast-closing' : ''}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
    >
      <span className="toast-icon" aria-hidden="true">{icon}</span>
      <div className="toast-content">
        {toast.title && <strong>{t(toast.title)}</strong>}
        {toast.message && <span>{t(toast.message)}</span>}
        {toast.amount !== undefined && <b>{formatCurrency(toast.amount, 'TZS')}</b>}
        {toast.receipt && <small>{t('Receipt')}: {toast.receipt}</small>}
      </div>
      <button type="button" className="toast-close" aria-label={t('Dismiss notification')} onClick={close}>×</button>
    </article>
  )
}

function ToastViewport({ toasts, onDismiss, language }) {
  if (!toasts.length || typeof document === 'undefined') return null
  return createPortal(
    <aside className="toast-viewport" aria-label={translate('Notifications', language)}>
      {toasts.slice(0, 3).map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} language={language} />
      ))}
    </aside>,
    document.body,
  )
}

function App() {
  const reduceMotion = useReducedMotion()
  useEffect(() => {
    const scrollTimers = new Map()
    const showScrollbar = (event) => {
      const target = event.target === document || event.target === window
        ? document.documentElement
        : event.target
      if (!(target instanceof HTMLElement)) return

      target.classList.add('is-scrolling')
      window.clearTimeout(scrollTimers.get(target))
      scrollTimers.set(target, window.setTimeout(() => {
        target.classList.remove('is-scrolling')
        scrollTimers.delete(target)
      }, 700))
    }

    document.addEventListener('scroll', showScrollbar, true)
    window.addEventListener('scroll', showScrollbar, { passive: true })
    return () => {
      document.removeEventListener('scroll', showScrollbar, true)
      window.removeEventListener('scroll', showScrollbar)
      for (const [target, timer] of scrollTimers) {
        window.clearTimeout(timer)
        target.classList.remove('is-scrolling')
      }
    }
  }, [])

  const [sessionUser, setSessionUser] = useState(null)
  const [theme, setTheme] = useState('dark')
  const [language, setLanguage] = useState('en')
  const [adminChangePasswordOpen, setAdminChangePasswordOpen] = useState(false)

  const [authMode, setAuthMode] = useState('login')
  const [loginError, setLoginError] = useState('')
  const [setupRequired, setSetupRequired] = useState(false)
  const [platformOwnerSetupAvailable, setPlatformOwnerSetupAvailable] = useState(false)
  const [platformBusinesses, setPlatformBusinesses] = useState([])
  const [platformApplications, setPlatformApplications] = useState([])
  const [platformSubscriptionSettings, setPlatformSubscriptionSettings] = useState({ monthlyFee: 0, currency: 'TZS', graceDays: 0 })
  const [googleClientId, setGoogleClientId] = useState(null)
  const [productImageMaxBytes, setProductImageMaxBytes] = useState(maxImageBytes)
  const [productImageBusy, setProductImageBusy] = useState(false)
  const [googleCredential, setGoogleCredential] = useState('')
  const [registrationProfile, setRegistrationProfile] = useState({ ownerName: '', email: '' })
  const googleButtonRef = useRef(null)
  const [selectedNav, setSelectedNav] = useState('Overview')
  const [expandedNavGroup, setExpandedNavGroup] = useState('Dashboard')
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [modal, setModal] = useState('')
  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)
  const notifiedSaleReceiptsRef = useRef(new Set())
  const [products, setProducts] = useState([])
  const [productsLoaded, setProductsLoaded] = useState(false)
  const [productCategories, setProductCategories] = useState([])
  const [productCategoryFilter, setProductCategoryFilter] = useState('')
  const [cart, setCart] = useState([])
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false)
  const [saleCustomer, setSaleCustomer] = useState('')
  const [salePaymentMethod, setSalePaymentMethod] = useState('cash')
  const [saleSubmitting, setSaleSubmitting] = useState(false)
  const saleInProgressRef = useRef(false)
  const workspaceRefreshSequenceRef = useRef(0)
  const [transactions, setTransactions] = useState([])
  const [expenses, setExpenses] = useState([])
  const [dashboard, setDashboard] = useState(emptyDashboard)
  const [business, setBusiness] = useState(null)
  const [displayCurrency, setDisplayCurrency] = useState('TZS')
  const [exchangeRateData, setExchangeRateData] = useState(null)
  const [exchangeRateError, setExchangeRateError] = useState('')
  const [exchangeRatesLoading, setExchangeRatesLoading] = useState(false)
  const [conversionForm, setConversionForm] = useState({ amount: '1', fromCurrency: 'USD', toCurrency: 'TZS' })
  const [conversionResult, setConversionResult] = useState(null)
  const [conversionError, setConversionError] = useState('')
  const [conversionLoading, setConversionLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [pendingBusinessLogo, setPendingBusinessLogo] = useState(null)
  const pendingBusinessLogoPreview = useMemo(() => pendingBusinessLogo ? URL.createObjectURL(pendingBusinessLogo) : '', [pendingBusinessLogo])
  const [chartRange, setChartRange] = useState('month')
  const [chartDate, setChartDate] = useState(todayDate)
  const [customChartStart, setCustomChartStart] = useState(customRangeDefaultStart)
  const [customChartEnd, setCustomChartEnd] = useState(todayDate)
  const customChartRangeRef = useRef({ start: customChartStart, end: customChartEnd })
  const [dashboardSearch, setDashboardSearch] = useState('')
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState('')
  const [transactionSortDirection, setTransactionSortDirection] = useState('desc')
  const [transactionPage, setTransactionPage] = useState(1)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState('')
  const [monthlyReportOpen, setMonthlyReportOpen] = useState(false)
  const [reportMonth, setReportMonth] = useState(new Date().getMonth() + 1)
  const [reportYear, setReportYear] = useState(new Date().getFullYear())
  const [reportData, setReportData] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportType, setReportType] = useState('monthly')
  const [reportCustomStart, setReportCustomStart] = useState(customRangeDefaultStart)
  const [reportCustomEnd, setReportCustomEnd] = useState(todayDate)
  const [salesDate, setSalesDate] = useState(todayDate)
  const salesDateRef = useRef(todayDate)
  const [showAllSales, setShowAllSales] = useState(false)
  const [posProductSearch, setPosProductSearch] = useState('')
  const [posProductQuery, setPosProductQuery] = useState('')
  const [agents, setAgents] = useState([])
  const [agentToDelete, setAgentToDelete] = useState(null)
  const [agentToReset, setAgentToReset] = useState(null)
  const [productToRestock, setProductToRestock] = useState(null)
  const [productToEditImage, setProductToEditImage] = useState(null)
  const [customers, setCustomers] = useState([])
  const [debtsReport, setDebtsReport] = useState(null)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerStatusFilter, setCustomerStatusFilter] = useState('')
  const [customerSearchTimeout, setCustomerSearchTimeout] = useState(null)
  const [debtCustomerDialog, setDebtCustomerDialog] = useState(null)
  const [debtEntryDialog, setDebtEntryDialog] = useState(null)
  const [paymentDialog, setPaymentDialog] = useState(null)
  const [correctTransactionDialog, setCorrectTransactionDialog] = useState(null)
  const [voidTransactionDialog, setVoidTransactionDialog] = useState(null)
  const [deleteCustomerDialog, setDeleteCustomerDialog] = useState(null)
  const [debtActionBusy, setDebtActionBusy] = useState(false)
  const posProducts = products.map(productForPos)
  const visiblePosProducts = posProducts.filter((product) => {
    const matchesSearch = `${product.label} ${product.sku || ''}`.toLowerCase().includes(posProductQuery.trim().toLowerCase())
    return matchesSearch && (!productCategoryFilter || product.categoryId === productCategoryFilter)
  })
  const selectedView = navigationViews[selectedNav] || 'overview'
  const t = (text) => translate(text, language)
  const dismissToast = useCallback((toastId) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId))
  }, [])
  const categories = [...new Set((dashboard.recentTransactions || []).map((item) => item.category))]
  const visibleDashboardTransactions = (dashboard.recentTransactions || [])
    .filter((item) => !transactionCategoryFilter || item.category === transactionCategoryFilter)
    .filter((item) => `${item.id} ${item.description} ${item.category} ${item.status}`.toLowerCase().includes(dashboardSearch.toLowerCase()))
    .sort((left, right) => (new Date(right.date).getTime() - new Date(left.date).getTime()) * (transactionSortDirection === 'desc' ? 1 : -1))
  const transactionPageSize = 10
  const transactionPageCount = Math.max(1, Math.ceil(visibleDashboardTransactions.length / transactionPageSize))
  const pagedDashboardTransactions = visibleDashboardTransactions.slice((transactionPage - 1) * transactionPageSize, transactionPage * transactionPageSize)


  function pushToast(toast) {
    const id = ++toastIdRef.current
    setToasts((current) => [...current, {
      id,
      type: toast.type || 'info',
      duration: toast.duration || 5000,
      ...toast,
    }])
  }

  function setNotice(message) {
    if (!message) return
    const type = /out of stock|low stock|outdated exchange-rate|outdated exchange rate/i.test(message)
      ? 'warning'
      : /invalid|must |could not|not found|unavailable|failed|incorrect|not enough|requires|enter |choose |already exists|already |denied|expired|cannot|unable|exceeds|exceed |add a product|at least|between |is required|does not|not allowed|not authorized|blocked|suspended|only |missing|too many|too large|too small|limit|no .*found|no .*available|no longer|insufficient/i.test(message)
        ? 'error'
        : 'success'
    pushToast({
      type,
      message,
      duration: type === 'warning' ? 8000 : type === 'error' ? 7000 : 3000,
    })
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.lang = language
  }, [theme, language])

  function setActiveSession(user) {
    setTheme(user?.theme || 'dark')
    setLanguage(user?.language || 'en')
    setSessionUser(user)
  }

  useEffect(() => {
    customChartRangeRef.current = { start: customChartStart, end: customChartEnd }
  }, [customChartStart, customChartEnd])

  useEffect(() => () => {
    if (pendingBusinessLogoPreview) URL.revokeObjectURL(pendingBusinessLogoPreview)
  }, [pendingBusinessLogoPreview])

  function dashboardPath(range, date) {
    const params = new URLSearchParams({ range, date })
    if (range === 'custom') {
      params.set('startDate', customChartRangeRef.current.start)
      params.set('endDate', customChartRangeRef.current.end)
    }
    return `/dashboard?${params.toString()}`
  }

  async function savePreference(key, value) {
    const setValue = key === 'theme' ? setTheme : setLanguage
    setValue(value)
    try {
      const { preferences } = await apiRequest('/auth/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      })
      setSessionUser((current) => current ? { ...current, ...preferences } : current)
    } catch (error) {
      setNotice(error.message)
      const current = sessionUser?.[key]
      if (current) setValue(current)
    }
  }

  useEffect(() => {
    if (!mobileNavigationOpen) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMobileNavigationOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileNavigationOpen])

  useEffect(() => {
    if (!cartDrawerOpen) return undefined
    function closeCartOnEscape(event) {
      if (event.key === 'Escape') setCartDrawerOpen(false)
    }
    window.addEventListener('keydown', closeCartOnEscape)
    return () => window.removeEventListener('keydown', closeCartOnEscape)
  }, [cartDrawerOpen])

  const cartTotal = useMemo(
    () => cart.reduce((total, item) => total + item.price * item.qty, 0),
    [cart],
  )
  const refreshWorkspace = useCallback(async (user, rangeName = '30days', date = todayDate) => {
    if (!user) return
    const refreshSequence = ++workspaceRefreshSequenceRef.current
    if (user.role === 'platform_admin') {
      const [businessResult, applicationResult, settingsResult] = await Promise.all([
        apiRequest('/platform/businesses'),
        apiRequest('/platform/applications'),
        apiRequest('/platform/subscription-settings'),
      ])
      if (refreshSequence !== workspaceRefreshSequenceRef.current) return false
      setPlatformBusinesses(businessResult.businesses)
      setPlatformApplications(applicationResult.applications)
      setPlatformSubscriptionSettings(settingsResult.settings)
      return true
    }
    const salesPath = user.role === 'business_admin' && salesDateRef.current
      ? `/sales?date=${encodeURIComponent(salesDateRef.current)}`
      : '/sales'
    const [productResult, saleResult, customerResult, debtReportResult, businessResult, productCategoryResult] = await Promise.all([
      apiRequest('/products'),
      apiRequest(salesPath),
      apiRequest('/customers'),
      apiRequest('/customers/report'),
      apiRequest('/business'),
      apiRequest('/categories'),
    ])
    if (refreshSequence !== workspaceRefreshSequenceRef.current) return false
    setProducts(productResult.products)
    setProductsLoaded(true)
    if (user.role === 'business_admin' || user.role === 'sales_agent') {
      const refreshedProducts = new Map(productResult.products.map((product) => [product.id, product]))
      setCart((items) => items.map((item) => {
        const current = refreshedProducts.get(item.id)
        return { ...item, stock: current?.stock ?? 0, imageUpdatedAt: current?.imageUpdatedAt ?? null, imageUrl: current?.imageUrl ?? null }
      }))
    }
    setProductCategories(productCategoryResult.categories)
    setTransactions(saleResult.sales)
    setCustomers(customerResult.customers)
    setDebtsReport(debtReportResult)
    setBusiness(businessResult.business)
    setDisplayCurrency(businessResult.business.currency)
    if (user.role === 'business_admin') {
      const range = { Today: 'today', 'This Week': 'week', 'This Month': 'month', '3 Months': '3months', '1 Year': 'year', day: 'day' }[rangeName] || rangeName
      const [dashboardResult, staffResult, expenseResult] = await Promise.all([
        apiRequest(dashboardPath(range, date)),
        apiRequest('/staff'),
        apiRequest('/expenses'),
      ])
      if (refreshSequence !== workspaceRefreshSequenceRef.current) return false
      setDashboard(dashboardResult)
      setAgents(staffResult.agents)
      setExpenses(expenseResult.expenses)
    }
    return true
  }, [])

  useEffect(() => {
    if (sessionUser?.role !== 'platform_admin') return undefined
    const refreshNow = () => {
      refreshWorkspace(sessionUser).catch(() => {})
    }
    const interval = window.setInterval(refreshNow, 5000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshNow()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', refreshNow)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', refreshNow)
    }
  }, [sessionUser, refreshWorkspace])

  useEffect(() => {
    if (sessionUser?.role !== 'business_admin' || !business?.currency) return undefined
    let active = true
    const refreshRates = () => {
      setExchangeRatesLoading(true)
      apiRequest('/currency-rates')
      .then((data) => {
        if (active) {
          setExchangeRateData(data)
          setExchangeRateError('')
        }
      })
      .catch((error) => {
        if (active) {
          setExchangeRateData((current) => current ? { ...current, isStale: true } : current)
          setExchangeRateError(error.message)
        }
      })
      .finally(() => {
        if (active) setExchangeRatesLoading(false)
      })
    }
    refreshRates()
    const interval = window.setInterval(refreshRates, 60 * 60 * 1000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [sessionUser, business?.currency])

  useEffect(() => {
    document.title = 'Business Management System'
    let mounted = true
    apiRequest('/setup')
      .then(({ setupRequired: required, platformOwnerSetupAvailable: ownerAvailable }) => {
        if (mounted) {
          setSetupRequired(required)
          setPlatformOwnerSetupAvailable(ownerAvailable)
        }
      })
      .catch((error) => {
        if (mounted) setLoginError(`Could not reach the backend API: ${error.message}`)
      })
    apiRequest('/auth/me')
      .then(async ({ user }) => {
        if (!mounted) return
        setActiveSession(user)
        await refreshWorkspace(user)
      })
      .catch((error) => {
        if (mounted) {
          if (error.message === 'Sign in to continue.' || error.message.includes('session has expired')) setLoginError(error.message)
          else setNotice(error.message)
        }
      })
    return () => { mounted = false }
  }, [refreshWorkspace])

  useEffect(() => {
    apiRequest('/config')
      .then(({ googleClientId: clientId, maxProductImageBytes: maxBytes }) => {
        setGoogleClientId(clientId)
        if (Number.isSafeInteger(maxBytes) && maxBytes > 0) setProductImageMaxBytes(maxBytes)
      })
      .catch((error) => setLoginError(`Could not load sign-in options: ${error.message}`))
  }, [])

  useEffect(() => {
    if (!['business_admin', 'sales_agent'].includes(sessionUser?.role)) return undefined
    const syncBusinessActivity = () => {
      if (document.visibilityState === 'visible') {
        const isBusinessAdmin = sessionUser.role === 'business_admin'
        const range = { Today: 'today', 'This Week': 'week', 'This Month': 'month', '3 Months': '3months', '1 Year': 'year', day: 'day' }[chartRange] || chartRange
        Promise.all([
          isBusinessAdmin ? apiRequest(dashboardPath(range, chartDate)) : Promise.resolve(null),
          apiRequest(salesDateRef.current ? `/sales?date=${encodeURIComponent(salesDateRef.current)}` : '/sales'),
          apiRequest('/business'),
        ])
          .then(([dashboardResult, salesResult, businessResult]) => {
            if (dashboardResult) setDashboard(dashboardResult)
            setTransactions(salesResult.sales)
            setBusiness(businessResult.business)
            setDisplayCurrency(businessResult.business.currency)
          })
          .catch((error) => setNotice(error.message))
      }
    }
    const interval = window.setInterval(syncBusinessActivity, 5_000)
    document.addEventListener('visibilitychange', syncBusinessActivity)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', syncBusinessActivity)
    }
  }, [sessionUser, chartRange, chartDate])

  async function loadSalesForDate(date) {
    salesDateRef.current = date
    setSalesDate(date)
    try {
      const result = await apiRequest(date ? `/sales?date=${encodeURIComponent(date)}` : '/sales')
      setTransactions(result.sales)
    } catch (error) {
      setNotice(error.message)
    }
  }

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return undefined
    let active = true
    let rendered = false
    let retry
    let timeout
    const renderButton = () => {
      if (rendered) return true
      if (!active || !window.google?.accounts?.id || !googleButtonRef.current) return false
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          try {
            if (authMode === 'register') {
              const { profile } = await apiRequest('/auth/google/profile', {
                method: 'POST',
                body: JSON.stringify({ credential }),
              })
              setRegistrationProfile({ ownerName: profile.name, email: profile.email })
              setGoogleCredential(credential)
              setLoginError('')
            } else {
              const { user } = await apiRequest('/auth/google', {
                method: 'POST',
                body: JSON.stringify({ credential }),
              })
              setLoginError('')
              setActiveSession(user)
              setCart([])
              try {
                await refreshWorkspace(user)
              } catch (error) {
                setNotice(error.message)
              }
            }
          } catch (error) {
            setLoginError(error.message)
          }
        },
      })
      googleButtonRef.current.replaceChildren()
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: authMode === 'register' ? 'signup_with' : 'signin_with',
        width: Math.min(400, googleButtonRef.current.clientWidth || 400),
      })
      rendered = true
      window.clearInterval(retry)
      window.clearTimeout(timeout)
      return true
    }
    const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]')
    if (!renderButton()) {
      script?.addEventListener('load', renderButton)
      retry = window.setInterval(renderButton, 250)
      timeout = window.setTimeout(() => window.clearInterval(retry), 10_000)
    }
    return () => {
      active = false
      script?.removeEventListener('load', renderButton)
      window.clearInterval(retry)
      window.clearTimeout(timeout)
    }
  }, [authMode, googleClientId, refreshWorkspace])

  async function performAction(action, successMessage) {
    try {
      const result = await action()
      await refreshWorkspace(sessionUser, chartRange, chartDate)
      setNotice(typeof successMessage === 'function' ? successMessage(result) : successMessage)
    } catch (error) {
      setNotice(error.message)
    }
  }

  async function loadDashboardChart(range, date = todayDate, startDate = customChartStart, endDate = customChartEnd) {
    const apiRange = { Today: 'today', 'This Week': 'week', 'This Month': 'month', '3 Months': '3months', '1 Year': 'year', day: 'day' }[range] || range
    setChartRange(range)
    setChartDate(date)
    setChartLoading(true)
    setChartError('')
    try {
      const params = new URLSearchParams({ range: apiRange, date })
      if (apiRange === 'custom') {
        params.set('startDate', startDate)
        params.set('endDate', endDate)
        customChartRangeRef.current = { start: startDate, end: endDate }
      }
      const result = await apiRequest(`/dashboard?${params.toString()}`)
      setDashboard(result)
    } catch (error) {
      setChartError(error.message)
      setNotice(error.message)
    } finally {
      setChartLoading(false)
  async function loadMonthlyReport() {
    setReportLoading(true)
    setReportError('')
    try {
      let url = `/reports/monthly?month=${reportMonth}&year=${reportYear}`
      if (reportType === 'custom') {
        url = `/reports/custom?startDate=${reportCustomStart}&endDate=${reportCustomEnd}`
      }
      const result = await apiRequest(url)
      setReportData(result)
    } catch (error) {
      setReportError(error.message)
      setNotice(error.message)
    } finally {
      setReportLoading(false)
    }
  }


    }
  }

  function openSection(item) {
    setSelectedNav(item)
    setMobileNavigationOpen(false)
    const group = navigation.find((section) => section.items.includes(item))
    if (group) setExpandedNavGroup(group.title)
    if (item === 'Add Product') setModal('product')
    if (item === 'Add Expense') setModal('expense')
    if (item === 'Add Customer') setDebtCustomerDialog({ mode: 'create', customer: null })
    if (item === 'Monthly Financial Reports' || item === 'Generated Reports') {
      setReportType('monthly')
      setMonthlyReportOpen(true)
      setReportData(null)
      setReportError('')
    }
    if (item === 'Custom Date-Range Reports') {
      setReportType('custom')
      setMonthlyReportOpen(true)
      setReportData(null)
      setReportError('')
    }
  }

  async function loadCustomers(search = '', status = '') {
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (status) params.set('status', status)
      const query = params.toString() ? `?${params.toString()}` : ''
      const [result, report] = await Promise.all([
        apiRequest(`/customers${query}`),
        apiRequest('/customers/report'),
      ])
      setCustomers(result.customers)
      setDebtsReport(report)
    } catch (error) {
      setNotice(error.message)
    }
  }

  function onCustomerSearchChange(value) {
    setCustomerSearch(value)
    if (customerSearchTimeout) clearTimeout(customerSearchTimeout)
    setCustomerSearchTimeout(setTimeout(() => {
      loadCustomers(value, customerStatusFilter)
    }, 300))
  }

  async function openCustomer(customer) {
    try {
      const result = await apiRequest(`/customers/${customer.id}`)
      setSelectedCustomer(result.customer)
    } catch (error) {
      setNotice(error.message)
    }
  }

  async function refreshCustomerDetail(customerId) {
    try {
      const result = await apiRequest(`/customers/${customerId}`)
      setSelectedCustomer(result.customer)
      await loadCustomers(customerSearch, customerStatusFilter)
    } catch (error) {
      setNotice(error.message)
    }
  }

  async function saveDebtCustomer(formData) {
    setDebtActionBusy(true)
    try {
      const editing = debtCustomerDialog?.mode === 'edit'
      const result = await apiRequest(editing ? `/customers/${debtCustomerDialog.customer.id}` : '/customers', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(formData),
      })
      setDebtCustomerDialog(null)
      setNotice(editing ? 'Customer details updated.' : 'Customer registered.')
      await loadCustomers(customerSearch, customerStatusFilter)
      if (!editing && result.customer) await openCustomer(result.customer)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setDebtActionBusy(false)
    }
  }

  async function addDebtToCustomer(payload) {
    if (!debtEntryDialog) return
    setDebtActionBusy(true)
    try {
      await apiRequest(`/customers/${debtEntryDialog.id}/debt`, { method: 'POST', body: JSON.stringify(payload) })
      setDebtEntryDialog(null)
      setNotice('Debt items added and stock updated.')
      await refreshCustomerDetail(debtEntryDialog.id)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setDebtActionBusy(false)
    }
  }

  async function addAgentDebt(customerId, payload) {
    setDebtActionBusy(true)
    try {
      await apiRequest(`/customers/${customerId}/debt`, { method: 'POST', body: JSON.stringify(payload) })
      setNotice('Debt items added and stock updated.')
      await refreshWorkspace(sessionUser)
      return true
    } catch (error) {
      setNotice(error.message)
      return false
    } finally {
      setDebtActionBusy(false)
    }
  }

  async function addAgentCustomer(payload) {
    setDebtActionBusy(true)
    try {
      const result = await apiRequest('/customers', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      await refreshWorkspace(sessionUser)
      setNotice('Customer registered.')
      return result.customer
    } catch (error) {
      setNotice(error.message)
      return null
    } finally {
      setDebtActionBusy(false)
    }
  }

  async function changeOwnPassword(payload) {
    await apiRequest('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    setNotice('Password changed successfully. Other signed-in sessions have been ended.')
  }

  async function recordDebtPayment(payload) {
    if (!paymentDialog) return
    setDebtActionBusy(true)
    try {
      const clientReference = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
      await apiRequest(`/customers/${paymentDialog.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, clientReference }),
      })
      setPaymentDialog(null)
      setNotice('Payment recorded.')
      await refreshCustomerDetail(paymentDialog.id)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setDebtActionBusy(false)
    }
  }

  async function correctDebtTransaction(payload) {
    if (!correctTransactionDialog) return
    setDebtActionBusy(true)
    try {
      const { transaction, customer } = correctTransactionDialog
      await apiRequest(`/customers/${customer.id}/transactions/${transaction.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setCorrectTransactionDialog(null)
      setNotice('Debt transaction corrected; an audit record was kept.')
      await refreshCustomerDetail(customer.id)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setDebtActionBusy(false)
    }
  }

  async function removeDebtTransaction() {
    if (!voidTransactionDialog) return
    setDebtActionBusy(true)
    try {
      const { transaction, customer } = voidTransactionDialog
      await apiRequest(`/customers/${customer.id}/transactions/${transaction.id}`, {
        method: 'DELETE',
        body: '{}',
      })
      setVoidTransactionDialog(null)
      setNotice('Debt item removed and stock was restored.')
      await refreshCustomerDetail(customer.id)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setDebtActionBusy(false)
    }
  }

  async function deleteCustomer() {
    if (!deleteCustomerDialog) return
    setDebtActionBusy(true)
    try {
      await apiRequest(`/customers/${deleteCustomerDialog.id}`, {
        method: 'DELETE',
        body: '{}',
      })
      setDeleteCustomerDialog(null)
      setSelectedCustomer(null)
      setNotice('Customer and their credit records were deleted.')
      await loadCustomers(customerSearch, customerStatusFilter)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setDebtActionBusy(false)
    }
  }

  function addToCart(product) {
    if (saleInProgressRef.current) return
    const existing = cart.find((item) => item.id === product.id)
    if ((!existing && product.stock < 1) || (existing && existing.qty >= product.stock)) {
      setNotice(`${product.label} is out of stock.`)
      return
    }
    setCart((items) => {
      if (existing) {
        return items.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item)
      }
      return [...items, { id: product.id, name: product.label, price: product.price, buyingPrice: product.buyingPrice, stock: product.stock, imageUpdatedAt: product.imageUpdatedAt, imageUrl: product.imageUrl, qty: 1 }]
    })
    setNotice(`${product.label} added to the sale.`)
  }

  function changeQuantity(identifier, change) {
    if (saleInProgressRef.current) return
    setCart((items) => items
      .map((item) => item.id === identifier || item.name === identifier ? { ...item, qty: Math.min(item.stock, item.qty + change) } : item)
      .filter((item) => item.qty > 0))
  }

  function clearCart() {
    if (saleInProgressRef.current) return
    if (cart.length && window.confirm(translate('Clear all items from the shopping cart?', language))) {
      setCart([])
    }
  }

  async function completeSale(customer = 'Walk-in customer', paymentMethod = 'cash') {
    if (saleInProgressRef.current) return false
    if (cart.length === 0) {
      setNotice('Add a product to the cart before completing a sale.')
      return false
    }
    saleInProgressRef.current = true
    setSaleSubmitting(true)
    try {
      const { products: latestProducts } = await apiRequest('/products')
      setProducts(latestProducts)
      const latestById = new Map(latestProducts.map((product) => [product.id, product]))
      const unavailable = cart.some((item) => !latestById.has(item.id))
      const overstocked = cart.some((item) => (latestById.get(item.id)?.stock ?? 0) < item.qty)
      const repriced = cart.some((item) => {
        const current = latestById.get(item.id)
        return current && Math.abs(current.sellingPrice - item.price) > 0.005
      })
      setCart((items) => items.map((item) => {
        const current = latestById.get(item.id)
        return current ? { ...item, name: current.name, price: current.sellingPrice, buyingPrice: current.buyingPrice, stock: current.stock, imageUpdatedAt: current.imageUpdatedAt } : { ...item, stock: 0 }
      }))
      if (unavailable || overstocked || repriced) {
        setNotice(unavailable ? 'A product in the cart is no longer available. Remove it to continue.'
          : overstocked ? 'Available stock changed. Adjust the quantities and try again.'
            : 'Product prices changed. Review the updated cart and confirm the sale again.')
        return false
      }
      const summary = cart.map((item) => item.qty + ' x ' + item.name + ' - ' + formatCurrency(item.price * item.qty, displayCurrency)).join('\n')
        + '\n\n' + translate('Total payable', language) + ': ' + formatCurrency(cartTotal, displayCurrency)
      if (!window.confirm(translate('Confirm sale?', language) + '\n\n' + summary)) return false
      const { sale, ratesStale } = await apiRequest('/sales', {
        method: 'POST',
        body: JSON.stringify({
          customer,
          paymentMethod,
          items: cart.map((item) => ({ productId: item.id, quantity: item.qty })),
        }),
      })
      setCart([])
      setSaleCustomer('')
      setCartDrawerOpen(false)
      const receipt = sale.id
      if (!notifiedSaleReceiptsRef.current.has(receipt)) {
        notifiedSaleReceiptsRef.current.add(receipt)
        if (notifiedSaleReceiptsRef.current.size > 500) {
          const oldestReceipt = notifiedSaleReceiptsRef.current.values().next().value
          notifiedSaleReceiptsRef.current.delete(oldestReceipt)
        }
        pushToast({ type: 'success', title: 'Sale completed successfully', amount: sale.tshAmount, receipt, duration: 5000 })
      }
      try {
        await refreshWorkspace(sessionUser, chartRange, chartDate)
      } catch (refreshError) {
        setNotice('Sale completed, but the workspace could not refresh: ' + refreshError.message)
      }
      if (ratesStale) setNotice('Sale completed using an outdated exchange-rate snapshot.')
      return true
    } catch (error) {
      setNotice(error.message)
      return false
    } finally {
      saleInProgressRef.current = false
      setSaleSubmitting(false)
    }
  }

  function exportTransactions() {
    const rows = [
      ['Receipt', 'Customer', 'Item', `Amount (${displayCurrency})`, `Gross profit (${displayCurrency})`, 'Status'],
      ...transactions.map(({ id, customer, item, amount, profit, status }) => [id, customer, item, amount, profit ?? '', status]),
    ]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'bms-sales.csv'
    link.click()
    URL.revokeObjectURL(url)
    setNotice('Sales report exported as CSV.')
  }

  async function addProduct(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = {
      name: String(formData.get('name')).trim(),
      sku: String(formData.get('sku') || '').trim(),
      buyingPrice: Number(formData.get('buyingPrice')),
      sellingPrice: Number(formData.get('sellingPrice')),
      quantity: Number(formData.get('stock')),
    }
    const imageError = String(formData.get('productImageError') || '')
    if (imageError) { setNotice(imageError); return }
    const selectedImage = formData.get('productImage')
    const imageFile = selectedImage instanceof File && selectedImage.size ? selectedImage : null
    if (!payload.name || !Number.isFinite(payload.buyingPrice) || payload.buyingPrice < 0 || !Number.isFinite(payload.sellingPrice) || payload.sellingPrice <= payload.buyingPrice || !Number.isInteger(payload.quantity) || payload.quantity < 0) {
      setNotice('Enter a product name, a valid buying price, a selling price above the buying price, and a valid stock quantity.')
      return
    }
    if (imageFile && !supportedImageMimeTypes.includes(imageFile.type)) {
      setNotice('Choose a JPG, PNG, or WebP product image.')
      return
    }
    if (imageFile && imageFile.size > productImageMaxBytes) {
      setNotice('The product image exceeds the configured file size limit.')
      return
    }
    setProductImageBusy(true)
    try {
      const productPayload = { ...payload }
      if (!productPayload.sku) delete productPayload.sku
      const result = await apiRequest('/products', { method: 'POST', body: JSON.stringify(productPayload) })
      const createdProduct = result.product
      if (imageFile) {
        try {
          await apiRequest('/products/' + createdProduct.id + '/image', {
            method: 'PUT',
            body: imageFile,
            headers: { 'Content-Type': imageFile.type },
          })
        } catch (imageError) {
          setModal('')
          try { await refreshWorkspace(sessionUser, chartRange, chartDate) } catch { /* Keep the upload failure visible. */ }
          setNotice('Product created, but its image could not be saved: ' + imageError.message + ' You can add it later from Product stock.')
          return
        }
      }
      setModal('')
      try {
        await refreshWorkspace(sessionUser, chartRange, chartDate)
      } catch (refreshError) {
        setNotice('Product saved, but the product list could not refresh: ' + refreshError.message)
        return
      }
      setNotice(payload.name + ' added to products.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setProductImageBusy(false)
    }
  }

  async function saveProductImage(event) {
    event.preventDefault()
    if (!productToEditImage) return
    const formData = new FormData(event.currentTarget)
    const imageError = String(formData.get('productImageError') || '')
    if (imageError) { setNotice(imageError); return }
    const selectedImage = formData.get('productImage')
    const imageFile = selectedImage instanceof File && selectedImage.size ? selectedImage : null
    const removeImage = formData.get('removeProductImage') === 'true'
    if (!imageFile && !removeImage) {
      setNotice('Choose a new product image or select Remove Image before saving.')
      return
    }
    if (imageFile && !supportedImageMimeTypes.includes(imageFile.type)) {
      setNotice('Choose a JPG, PNG, or WebP product image.')
      return
    }
    if (imageFile && imageFile.size > productImageMaxBytes) {
      setNotice('The product image exceeds the configured file size limit.')
      return
    }
    if (removeImage && !imageFile && !window.confirm('Remove this product image? The product itself will remain unchanged.')) return
    setProductImageBusy(true)
    try {
      if (imageFile) {
        await apiRequest('/products/' + productToEditImage.id + '/image', {
          method: 'PUT',
          body: imageFile,
          headers: { 'Content-Type': imageFile.type },
        })
      } else {
        await apiRequest('/products/' + productToEditImage.id + '/image', { method: 'DELETE' })
      }
      const productName = productToEditImage.name
      setModal('')
      setProductToEditImage(null)
      try {
        await refreshWorkspace(sessionUser, chartRange, chartDate)
      } catch (refreshError) {
        setNotice('Product image was saved, but the product list could not refresh: ' + refreshError.message)
        return
      }
      setNotice(imageFile ? productName + ' image updated.' : productName + ' image removed.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setProductImageBusy(false)
    }
  }

  async function restockProduct(event) {
    event.preventDefault()
    const quantity = Number(new FormData(event.currentTarget).get('quantity'))
    if (!Number.isInteger(quantity) || quantity <= 0 || !productToRestock) {
      setNotice('Enter a whole-number restock quantity greater than zero.')
      return
    }
    await performAction(async () => {
      await apiRequest(`/products/${productToRestock.id}/restock`, {
        method: 'POST',
        body: JSON.stringify({ quantity }),
      })
      setProductToRestock(null)
      setModal('')
    }, `${productToRestock.name} restocked by ${quantity}.`)
  }

  async function signIn(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email')).trim().toLowerCase()
    const password = String(formData.get('password'))

    try {
      const { user } = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      setLoginError('')
      setActiveSession(user)
      setCart([])
      try {
        await refreshWorkspace(user)
      } catch (error) {
        setNotice(error.message)
      }
    } catch (error) {
      setLoginError(error.message)
    }
  }

  async function registerPlatformOwner(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = Object.fromEntries(formData.entries())
    if (payload.password !== payload.confirmPassword) {
      setLoginError('Passwords do not match.')
      return
    }
    setLoginError('')
    delete payload.confirmPassword
    try {
      const { user } = await apiRequest('/auth/register-platform-owner', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setLoginError('')
      setPlatformOwnerSetupAvailable(false)
      setActiveSession(user)
      await refreshWorkspace(user)
    } catch (error) {
      setLoginError(error.message)
    }
  }

  async function changeBusinessAccess(business, status, reason) {
    try {
      const body = { status }
      if (status === 'suspended' && reason) body.reason = reason
      await apiRequest(`/platform/businesses/${business.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      await refreshWorkspace(sessionUser)
      setNotice(status === 'suspended'
        ? `${business.name} access was suspended.${reason ? ` Reason: ${reason}` : ''}`
        : `${business.name} access was reactivated.`)
    } catch (error) {
      setNotice(error.message)
    }
  }

  async function updateSubscriptionSettings(settings) {
    await apiRequest('/platform/subscription-settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    })
    await refreshWorkspace(sessionUser)
    setNotice('Subscription settings updated. New billing periods use the new monthly fee; existing invoices are unchanged.')
  }

  async function recordPayment(business, payment) {
    const result = await apiRequest(`/platform/businesses/${business.id}/payments`, {
      method: 'POST',
      body: JSON.stringify(payment),
    })
    await refreshWorkspace(sessionUser)
    setNotice(`Payment of ${formatCurrency(result.payment.amount, result.payment.currency)} recorded for ${business.name}. Verify it to apply the credit.`)
  }

  async function verifyPayment(business, paymentId) {
    const result = await apiRequest(`/platform/payments/${paymentId}/verify`, {
      method: 'POST',
      body: '{}',
    })
    await refreshWorkspace(sessionUser)
    setNotice(`Payment verified for ${business.name}. ${result.message}`)
  }

  async function deleteCustomerBusiness(business, password) {
    await apiRequest(`/platform/businesses/${business.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    })
    setPlatformBusinesses((current) => current.filter((item) => item.id !== business.id))
    setNotice(`${business.name} and its business data were permanently deleted.`)
  }

  async function approveApplication(application) {
    try {
      const result = await apiRequest(`/platform/applications/${application.id}/approve`, {
        method: 'POST',
        body: '{}',
      })
      await refreshWorkspace(sessionUser)
      setNotice(result.message)
    } catch (error) {
      setNotice(error.message)
    }
  }

  async function rejectApplication(application) {
    if (!window.confirm(`Reject the business application from ${application.businessName}? The applicant will not be able to sign in.`)) return
    try {
      const result = await apiRequest(`/platform/applications/${application.id}/reject`, {
        method: 'POST',
        body: '{}',
      })
      await refreshWorkspace(sessionUser)
      setNotice(result.message)
    } catch (error) {
      setNotice(error.message)
    }
  }

  async function registerBusiness(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = Object.fromEntries(formData.entries())
    if (payload.password && payload.password !== payload.confirmPassword) {
      setLoginError('Passwords do not match.')
      return
    }
    setLoginError('')
    if (googleCredential) payload.googleCredential = googleCredential
    try {
      const result = await apiRequest('/auth/register-business', { method: 'POST', body: JSON.stringify(payload) })
      setGoogleCredential('')
      setRegistrationProfile({ ownerName: '', email: '' })
      setNotice(result.message)
      setAuthMode('login')
    } catch (error) {
      setNotice(error.message)
      setLoginError(error.message)
    }
  }

  async function addAgent(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = Object.fromEntries(formData.entries())
    await performAction(async () => {
      await apiRequest('/staff', { method: 'POST', body: JSON.stringify(payload) })
      setModal('')
    }, `${payload.name} registered as a sales agent.`)
  }

  async function addExpense(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = Object.fromEntries(formData.entries())
    payload.amount = Number(payload.amount)
    await performAction(async () => {
      const result = await apiRequest('/expenses', { method: 'POST', body: JSON.stringify(payload) })
      setModal('')
      return result
    }, (result) => `Expense recorded.${result.expense.ratesStale ? ' Warning: an outdated exchange-rate snapshot was used.' : ''}`)
  }

  async function saveBusinessSettings(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = Object.fromEntries(formData.entries())
    const currencyChanged = payload.currency && payload.currency !== business?.currency
    if (currencyChanged) {
      const confirmed = window.confirm(
        `Change the business currency from ${business.currency} to ${payload.currency}?\n\nOriginal transaction amounts will remain unchanged. Older sales or expenses without saved exchange-rate snapshots will be explicitly converted once using the current provider rates so future reports remain stable.`,
      )
      if (!confirmed) return
      payload.confirmHistoricalConversion = true
    }
    setSettingsSaving(true)
    try {
      const { business: updatedBusiness, exchangeRates: savedExchangeRates } = await apiRequest('/business', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setBusiness(updatedBusiness)
      setDisplayCurrency(updatedBusiness.currency)
      await refreshWorkspace(sessionUser, chartRange, chartDate)
      if (savedExchangeRates?.isStale) {
        setNotice('Business settings saved using an outdated exchange-rate snapshot. Review the rate warning in System Settings.')
      } else {
        setNotice('Business settings saved. Original transaction amounts were preserved.')
      }
    } catch (error) {
      setNotice(error.message)
    } finally {
      setSettingsSaving(false)
    }
  }

  function selectBusinessLogo(event) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    input.value = ''
    if (!businessLogoMimeTypes.includes(file.type)) {
      setNotice('Choose a PNG, JPEG, or WebP image for the business logo.')
      return
    }
    if (file.size > maxBusinessLogoBytes) {
      setNotice('Business logos must be no larger than 5 MB.')
      return
    }
    setPendingBusinessLogo(file)
  }

  async function saveBusinessLogo() {
    if (!pendingBusinessLogo) return
    setLogoUploading(true)
    try {
      const result = await apiRequest('/business/logo', {
        method: 'PUT',
        body: pendingBusinessLogo,
        headers: { 'Content-Type': pendingBusinessLogo.type },
      })
      setBusiness((current) => current ? { ...current, logoUpdatedAt: result.logoUpdatedAt } : current)
      setPendingBusinessLogo(null)
      setNotice('Business logo updated. It is now visible to business admins and sales agents.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLogoUploading(false)
    }
  }

  async function removeBusinessLogo() {
    setLogoUploading(true)
    try {
      await apiRequest('/business/logo', { method: 'DELETE' })
      setBusiness((current) => current ? { ...current, logoUpdatedAt: null } : current)
      setPendingBusinessLogo(null)
      setNotice('Business logo removed.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLogoUploading(false)
    }
  }

  async function convertAmount(event) {
    event.preventDefault()
    setConversionLoading(true)
    setConversionError('')
    setConversionResult(null)
    try {
      const result = await apiRequest('/currency-convert', {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(conversionForm.amount),
          fromCurrency: conversionForm.fromCurrency,
          toCurrency: conversionForm.toCurrency,
        }),
      })
      setConversionResult(result)
    } catch (error) {
      setConversionError(error.message)
    } finally {
      setConversionLoading(false)
    }
  }

  async function toggleAgentStatus(agent) {
    const nextStatus = agent.status === 'active' ? 'paused' : 'active'
    await performAction(async () => {
      await apiRequest(`/staff/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) })
    }, `${agent.name}'s account is ${nextStatus}.`)
  }

  async function deleteAgent() {
    if (!agentToDelete) return
    const removedName = agentToDelete.name
    await performAction(async () => {
      await apiRequest(`/staff/${agentToDelete.id}`, { method: 'DELETE' })
      setAgentToDelete(null)
    }, `${removedName} was removed from sales agents.`)
  }

  async function resetAgentPassword(agent, password) {
    await apiRequest(`/staff/${agent.id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password, confirmPassword: password }),
    })
    setNotice(`${agent.name}'s password was reset. Share the new password through a secure channel.`)
  }

  async function resetBusinessAdminPassword(business, { ownerPassword, password }) {
    await apiRequest(`/platform/users/${business.ownerUserId}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ ownerPassword, password, confirmPassword: password }),
    })
    setNotice(`${business.ownerName || business.name}'s password was reset. Share the new password through a secure channel.`)
  }

  async function signOut() {
    try {
      await apiRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) })
    } catch (error) {
      setNotice(error.message)
    } finally {
      // Prevent Google One Tap from automatically re-signing the user in.
      window.google?.accounts?.id?.disableAutoSelect()
      setTheme('light')
      setLanguage('en')
      setSessionUser(null)
      setCart([])
      setCartDrawerOpen(false)
      setSaleCustomer('')
      setSalePaymentMethod('cash')
      setProductCategoryFilter('')
      setPosProductSearch('')
      setPosProductQuery('')
      setTransactions([])
      setProducts([])
      setProductsLoaded(false)
      setAgents([])
      setPlatformBusinesses([])
      setDashboard(emptyDashboard)
      setBusiness(null)
      setDisplayCurrency('TZS')
      setExchangeRateData(null)
    }
  }

  if (!sessionUser) {
    const isRegistering = authMode === 'register'
    const isOwnerSetup = authMode === 'ownerSetup'
    const isAuthenticatingOwner = isRegistering || isOwnerSetup
    return (
      <div className="login-page">
        <ToastViewport toasts={toasts} onDismiss={dismissToast} language={language} />
        <div className="mobile-auth-brand" aria-label="Business Management Portal">
          <span className="mobile-auth-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <rect x="4" y="4" width="24" height="24" rx="7" fill="url(#portal-mark-fill)" />
              <path d="M10 16.5 14.5 21 22 12.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <defs><linearGradient id="portal-mark-fill" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse"><stop stopColor="#25D9FF" /><stop offset=".55" stopColor="#1975FF" /><stop offset="1" stopColor="#713BFF" /></linearGradient></defs>
            </svg>
          </span>
          <span><strong>Business Management Portal</strong><small>Secure access for your business</small></span>
        </div>
        <div className={`login-shell${isAuthenticatingOwner ? ' register-mode' : ''}${isRegistering ? ' mobile-register-mode' : ''}${isOwnerSetup ? ' mobile-owner-mode' : ''}${!isAuthenticatingOwner ? ' mobile-login-mode' : ''}`}>
          <div className="login-panel brand-panel">
            <div className="brand-block" key={authMode}>
              <h1>{isAuthenticatingOwner ? 'Welcome Back!' : 'Hello, Welcome!'}</h1>
              <p>{isAuthenticatingOwner ? 'Already have an account?' : "Don't have an account?"}</p>
              <button
                type="button"
                className="register-switch"
                onClick={() => {
                  setAuthMode(isAuthenticatingOwner ? 'login' : 'register')
                  setLoginError('')
                  setNotice('')
                }}
              >
                {isAuthenticatingOwner ? 'Login' : 'Register'}
              </button>
            </div>
          </div>

          <div className="login-panel form-panel">
            <div className="auth-form-content" key={authMode}>
            <span className="mobile-auth-symbol" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="5" y="10" width="14" height="11" rx="2.5" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
              </svg>
            </span>
            <h2>
              {isOwnerSetup
                ? 'Set up system owner'
                : isRegistering
                  ? 'Register your business'
                  : <><span className="desktop-auth-heading">Login</span><span className="mobile-auth-welcome-heading">Welcome back</span></>}
            </h2>
            {!isRegistering && !isOwnerSetup && <p className="mobile-auth-description">Sign in to your business account.</p>}
            {isRegistering && <p className="form-copy"><span className="desktop-auth-copy">Create a business account to get started. Your registration is reviewed by the system administrator before you can sign in. Scroll within this form to complete all details.</span><span className="mobile-auth-form-copy">Create a business account to get started. Your registration is reviewed by the system administrator before you can sign in.</span></p>}
            {isOwnerSetup && <p className="form-copy"><span className="desktop-auth-copy">Create the private owner account used to manage business access and subscriptions. Scroll within this form to complete setup.</span><span className="mobile-auth-form-copy">Create the private owner account used to manage business access and subscriptions.</span></p>}
            {loginError && <div className="login-error" role="alert">{loginError}</div>}
            {isOwnerSetup ? (
              <form key={authMode} onSubmit={registerPlatformOwner}>
                <label className="login-input">
                  <span className="sr-only">Owner name</span>
                  <input type="text" name="name" placeholder="Owner name" autoComplete="name" required maxLength="200" />
                </label>
                <label className="login-input">
                  <span className="sr-only">Email address</span>
                  <input type="email" name="email" placeholder="Owner email address" autoComplete="email" required maxLength="254" />
                </label>
                <PasswordField label="Password" name="password" placeholder="Create password" autoComplete="new-password" minLength="8" maxLength="128" required />
                <PasswordField label="Confirm password" name="confirmPassword" placeholder="Enter password again" autoComplete="new-password" minLength="8" maxLength="128" required />
                <PasswordField label="First-time setup key" name="setupToken" placeholder="First-time setup key" autoComplete="off" required />
                <button type="submit" className="primary-button large">Create owner account</button>
              </form>
            ) : isRegistering ? (
              <>
                <form key={authMode} onSubmit={registerBusiness}>
                  <label className="login-input">
                    <span className="sr-only">Business name</span>
                    <input type="text" name="businessName" placeholder="Business name" autoComplete="organization" required maxLength="150" />
                  </label>
                  <label className="login-input">
                    <span className="sr-only">Business owner name</span>
                    <input type="text" name="ownerName" placeholder="Business owner name" autoComplete="name" value={registrationProfile.ownerName} onChange={(event) => setRegistrationProfile({ ...registrationProfile, ownerName: event.target.value })} required readOnly={Boolean(googleCredential)} />
                  </label>
                  <label className="login-input">
                    <span className="sr-only">Email address</span>
                    <input type="email" name="email" placeholder="Email address" autoComplete="email" value={registrationProfile.email} onChange={(event) => setRegistrationProfile({ ...registrationProfile, email: event.target.value })} required readOnly={Boolean(googleCredential)} />
                  </label>
                  <label className="login-input">
                    <span className="sr-only">Phone number</span>
                    <input type="tel" name="phone" placeholder="Phone number" autoComplete="tel" required maxLength="40" />
                  </label>
                  <label className="login-input">
                    <span className="sr-only">Business type</span>
                    <input type="text" name="industry" placeholder="Business type" required maxLength="100" />
                  </label>
                  {!googleCredential && (
                    <>
                      <PasswordField label="Password" name="password" placeholder="Create password" autoComplete="new-password" minLength="8" maxLength="128" required />
                      <PasswordField label="Confirm password" name="confirmPassword" placeholder="Enter password again" autoComplete="new-password" minLength="8" maxLength="128" required />
                    </>
                  )}
                  {setupRequired && <p className="form-copy">No users exist yet: the first business application will also be reviewed by the system owner before access is granted.</p>}
                  <button type="submit" className="primary-button large">Register business</button>
                </form>
                <div className="google-signin">
                  <span>or continue with</span>
                  {googleClientId
                    ? <div className="google-button-host" ref={googleButtonRef} />
                    : <button type="button" className="google-unavailable" disabled>Google sign-in is not configured</button>}
                </div>
              </>
            ) : (
              <>
                <form key={authMode} onSubmit={signIn}>
                  <label className="login-input">
                    <span className="sr-only">Email address</span>
                    <input type="email" name="email" placeholder="Email address" autoComplete="username" required />
                  </label>
                  <PasswordField label="Password" name="password" placeholder="Password" autoComplete="current-password" required />
                  <div className="login-forgot-row">
                    <button type="button" className="text-button" onClick={() => setModal('forgot')}>Forgot Password?</button>
                  </div>
                  <button type="submit" className="primary-button large">Login</button>
                </form>
                <div className="google-signin">
                  <span>or continue with</span>
                  {googleClientId
                    ? <div className="google-button-host" ref={googleButtonRef} />
                    : <button type="button" className="google-unavailable" disabled>Google sign-in is not configured</button>}
                </div>
              </>
            )}
            {!isRegistering && !isOwnerSetup && platformOwnerSetupAvailable && (
              <button
                type="button"
                className="text-button owner-setup-link"
                onClick={() => { setAuthMode('ownerSetup'); setLoginError(''); setNotice('') }}
              >
                Set up the system owner account
              </button>
            )}
            </div>
            <div className="mobile-auth-switch">
              <span>{isRegistering || isOwnerSetup ? 'Already have an account?' : "Don't have an account?"}</span>
              <button
                type="button"
                onClick={() => {
                  setAuthMode(isAuthenticatingOwner ? 'login' : 'register')
                  setLoginError('')
                  setNotice('')
                }}
              >
                {isAuthenticatingOwner ? 'Login' : 'Register'}
              </button>
            </div>
          </div>
        </div>
        {modal && <Modal type={modal} onClose={() => setModal('')} />}
      </div>
    )
  }

  if (sessionUser.role === 'platform_admin') {
    return (
      <>
        <ToastViewport toasts={toasts} onDismiss={dismissToast} language={language} />
        <OwnerConsole
          user={sessionUser}
          businesses={platformBusinesses}
          applications={platformApplications}
          settings={platformSubscriptionSettings}
          onProfileImageUpdated={(profileImageUpdatedAt) => setSessionUser((current) => current ? { ...current, profileImageUpdatedAt } : current)}
          onNotice={setNotice}
          onSignOut={signOut}
          onChangeAccess={changeBusinessAccess}
          onDeleteBusiness={deleteCustomerBusiness}
          onResetAdminPassword={resetBusinessAdminPassword}
          onApproveApplication={approveApplication}
          onRejectApplication={rejectApplication}
          onUpdateSubscriptionSettings={updateSubscriptionSettings}
          onRecordPayment={recordPayment}
          onVerifyPayment={verifyPayment}
          onRefresh={() => refreshWorkspace(sessionUser)}
          theme={theme}
          language={language}
          onThemeChange={(value) => savePreference('theme', value)}
          onLanguageChange={(value) => savePreference('language', value)}
        />
      </>
    )
  }

  if (sessionUser.role === 'sales_agent') {
    return (
      <>
        <ToastViewport toasts={toasts} onDismiss={dismissToast} language={language} />
        <AgentWorkspace
          agent={sessionUser}
          business={business}
          products={posProducts}
          onRefresh={() => refreshWorkspace(sessionUser)}
          productsLoaded={productsLoaded}
          productCategories={productCategories}
          debtProducts={products}
          customers={customers}
          currencyCode={displayCurrency}
          cart={cart}
          cartTotal={cartTotal}
          saleSubmitting={saleSubmitting}
          transactions={transactions}
          expenseDialogOpen={modal === 'expense'}
          onOpenExpense={() => setModal('expense')}
          onCloseExpense={() => setModal('')}
          onAddExpense={addExpense}
          debtActionBusy={debtActionBusy}
          onAddAgentDebt={addAgentDebt}
          onAddAgentCustomer={addAgentCustomer}
          onChangePassword={changeOwnPassword}
          onProfileImageUpdated={(profileImageUpdatedAt) => setSessionUser((current) => current ? { ...current, profileImageUpdatedAt } : current)}
          onNotice={setNotice}
          theme={theme}
          language={language}
          onThemeChange={(value) => savePreference('theme', value)}
          onLanguageChange={(value) => savePreference('language', value)}
          onAddProduct={addToCart}
          onChangeQuantity={changeQuantity}
          onClearCart={clearCart}
          onCompleteSale={completeSale}
          onExit={signOut}
        />
      </>
    )
  }

  return (
    <div className={`app-shell${sessionUser.role === 'business_admin' ? ' financial-dashboard' : ''}`}>
      {adminChangePasswordOpen && (
        <ChangePasswordDialog language={language} onCancel={() => setAdminChangePasswordOpen(false)} onSave={changeOwnPassword} />
      )}
      {monthlyReportOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMonthlyReportOpen(false) }}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="monthly-report-title" style={{ maxWidth: '900px', width: '95%' }}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{t('Monthly Financial Report')}</p>
                <h2 id="monthly-report-title">{t('Generate Monthly Report')}</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setMonthlyReportOpen(false)} aria-label={t('Close')}>×</button>
            </div>
            <div className="modal-form">
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {reportType === 'custom' ? (
                  <>
                    <label>{t('Start Date')}
                      <input type="date" value={reportCustomStart} max={reportCustomEnd} onChange={(e) => setReportCustomStart(e.target.value)} />
                    </label>
                    <label>{t('End Date')}
                      <input type="date" value={reportCustomEnd} min={reportCustomStart} onChange={(e) => setReportCustomEnd(e.target.value)} />
                    </label>
                  </>
                ) : (
                  <>
                    <label>{t('Month')}
                      <select value={reportMonth} onChange={(e) => setReportMonth(Number(e.target.value))}>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                          <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('en', { month: 'long' })}</option>
                        ))}
                      </select>
                    </label>
                    <label>{t('Year')}
                      <input type="number" value={reportYear} onChange={(e) => setReportYear(Number(e.target.value))} min="2000" max="2100" />
                    </label>
                  </>
                )}
                <button type="button" className="primary-button small" onClick={loadMonthlyReport} disabled={reportLoading}>{reportLoading ? t('Loading…') : t('Preview Report')}</button>
              </div>
              {reportError && <p className="dashboard-chart-error" role="alert">{reportError}</p>}
              {reportData && (
                <div id="monthly-report-print" style={{ background: '#fff', color: '#111', padding: '16px', borderRadius: '8px' }}>
                  <h3>{reportData.business.name}</h3>
                  <p>{t('Monthly Financial Report')} – {reportData.period.startDay} to {reportData.period.endDay}</p>
                  <p>{t('Date generated')}: {new Date().toLocaleString()}</p>
                  <h4>{t('Financial Summary')}</h4>
                  <ul>
                    <li>{t('TOTAL REVENUE')}: {formatCurrency(reportData.summary.totalRevenue, reportData.business.currency)}</li>
                    <li>{t('TOTAL EXPENSES')}: {formatCurrency(reportData.summary.totalExpenses, reportData.business.currency)}</li>
                    <li>{t('NET PROFIT')}: {formatCurrency(reportData.summary.netProfit, reportData.business.currency)}</li>
                    <li>{t('CASH')}: {formatCurrency(reportData.summary.cash, reportData.business.currency)}</li>
                  </ul>
                  <p>{t('Sales transaction count')}: {reportData.summary.salesCount}</p>
                  <p>{t('Total sales returns and refunds')}: {formatCurrency(reportData.summary.refundedAmount, reportData.business.currency)} ({reportData.summary.refundedCount})</p>
                  <p>{t('Profit margin')}: {reportData.summary.profitMargin.toFixed(2)}%</p>
                  <h4>{t('Expense breakdown by category')}</h4>
                  <ul>
                    {reportData.expenseBreakdown.map((e) => (
                      <li key={e.category}>{e.category}: {formatCurrency(e.amount, reportData.business.currency)} ({e.percentage.toFixed(1)}%, {e.count} tx)</li>
                    ))}
                  </ul>
                  <h4>{t('Payment methods breakdown')}</h4>
                  <ul>
                    {reportData.paymentMethods.map((p) => (
                      <li key={p.method}>{p.method}: {formatCurrency(p.amount, reportData.business.currency)} ({p.count})</li>
                    ))}
                  </ul>
                  <h4>{t('Comparison with previous month')}</h4>
                  <p>{t('Previous revenue')}: {formatCurrency(reportData.comparison.previousRevenue, reportData.business.currency)}</p>
                  <p>{t('Previous expenses')}: {formatCurrency(reportData.comparison.previousExpenses, reportData.business.currency)}</p>
                  <p>{t('Previous net profit')}: {formatCurrency(reportData.comparison.previousNetProfit, reportData.business.currency)}</p>
                  <h4>{t('Monthly revenue versus expenses')}</h4>
                  <div style={{ fontSize: '12px' }}>
                    {reportData.daily.map((d) => (
                      <div key={d.date}>{d.date}: R {formatCurrency(d.revenue, reportData.business.currency)} / E {formatCurrency(d.expenses, reportData.business.currency)}</div>
                    ))}
                  </div>
                  <p style={{ marginTop: '12px', fontSize: '12px' }}>{t('Generated by the system')}</p>
                </div>
              )}
              {reportData && (
                <div className="modal-actions">
                  <button type="button" className="ghost-button" onClick={() => window.print()}>{t('Print')}</button>
                  <button type="button" className="primary-button" onClick={() => window.print()}>{t('Download PDF')}</button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      <UnifiedSidebar
        id="business-navigation"
        className="sidebar"
        open={mobileNavigationOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setMobileNavigationOpen(false)}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        closeLabel={t('Close navigation')}
        collapseLabel={t('Collapse navigation')}
        expandLabel={t('Expand navigation')}
        signOutLabel={t('Sign out')}
        onSignOut={signOut}
        brand={<>{business?.logoUpdatedAt ? <img src={`/api/business/logo?v=${encodeURIComponent(business.logoUpdatedAt)}`} alt="" className="business-brand-logo unified-business-logo" /> : <span className="unified-brand-mark">B</span>}<span className="unified-brand-copy"><strong title={business?.name || sessionUser.businessName || 'My Business'}>{business?.name || sessionUser.businessName || 'My Business'}</strong><small>Business admin</small></span></>}
        profile={<div className="account-controls"><ProfileImageControl user={sessionUser} language={language} onUpdated={(profileImageUpdatedAt) => setSessionUser((current) => current ? { ...current, profileImageUpdatedAt } : current)} onNotice={setNotice} /><button type="button" className="ghost-button account-password-button" onClick={() => setAdminChangePasswordOpen(true)}>{t('Change password')}</button></div>}
      >
        <nav className="nav-groups" aria-label="Sidebar navigation">
          {navigation.map((group) => (
            <section className="nav-group" key={group.title}>
              <h2 className="nav-title">
                <button
                  type="button"
                  className="nav-group-toggle"
                  aria-expanded={expandedNavGroup === group.title}
                  onClick={() => setExpandedNavGroup((current) => current === group.title ? '' : group.title)}
                >
                  <span><span className="nav-group-icon" aria-hidden="true"><GroupNavIcon title={group.title} /></span>{t(group.title)}</span><span className="nav-chevron" aria-hidden="true">⌄</span>
                </button>
              </h2>
              {expandedNavGroup === group.title && (
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>
                      <button type="button" className={selectedNav === item ? 'nav-item active' : 'nav-item'} onClick={() => openSection(item)}>
                        <span className="nav-item-icon" aria-hidden="true"><GroupNavIcon title={group.title} /></span>{t(item)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </nav>
      </UnifiedSidebar>
      {mobileNavigationOpen && (
        <>
          <button
            type="button"
            className="mobile-navigation-backdrop"
            aria-label={t('Close navigation')}
            onClick={() => setMobileNavigationOpen(false)}
          />
          {createPortal(
            <button type="button" className="mobile-navigation-open-toggle" aria-label={t('Close navigation')} aria-controls="business-navigation" aria-expanded="true" onClick={() => setMobileNavigationOpen(false)}>
              <span /><span /><span />
            </button>,
            document.body,
          )}
        </>
      )}

      <main className="main-panel">
        <header className="topbar">
          <button
            type="button"
            className="mobile-navigation-toggle"
            aria-label={t(mobileNavigationOpen ? 'Close navigation' : 'Open navigation')}
            aria-controls="business-navigation"
            aria-expanded={mobileNavigationOpen}
            onClick={() => setMobileNavigationOpen((open) => !open)}
          >
            <span /><span /><span />
          </button>
          <div className="business-brand">
            {business?.logoUpdatedAt ? <img src={`/api/business/logo?v=${encodeURIComponent(business.logoUpdatedAt)}`} alt="" className="business-brand-logo" /> : <span className="business-brand-fallback" aria-hidden="true">▧</span>}
            <div><p className="eyebrow">{t('Business admin dashboard')}</p><strong>{business?.name || sessionUser.businessName}</strong></div>
          </div>
          <div className="topbar-tools">
            {selectedView === 'overview' && (
              <label className="dashboard-header-search">
                <span aria-hidden="true">⌕</span>
                <input value={dashboardSearch} onChange={(event) => { setDashboardSearch(event.target.value); setTransactionPage(1) }} placeholder={t('Search transactions')} aria-label={t('Search transactions')} />
              </label>
            )}
            <PreferenceControls
              theme={theme}
              language={language}
              onThemeChange={(value) => savePreference('theme', value)}
              onLanguageChange={(value) => savePreference('language', value)}
            />
            <details className="dashboard-profile-menu">
              <summary className="dashboard-profile" aria-label={t('Open profile menu')}><UserAvatar user={sessionUser} /><span>{sessionUser.name}</span><span className="profile-menu-chevron" aria-hidden="true">?</span></summary>
              <div className="dashboard-profile-popover"><strong>{sessionUser.name}</strong><small>{sessionUser.email}</small><button type="button" onClick={(event) => { openSection('Business Profile'); event.currentTarget.closest('details')?.removeAttribute('open') }}>{t('Business Profile')}</button><button type="button" onClick={signOut}>{t('Sign out')}</button></div>
            </details>
            {selectedView === 'transactions' && <button type="button" className="ghost-button" onClick={exportTransactions}>{t('Export')}</button>}
            {selectedView === 'sales' && <button type="button" className="primary-button" onClick={() => openSection('New Sale / POS')}>{t('+ Add Sale')}</button>}
          </div>
        </header>

        <section className="page-header">
          <div>
            <p className="eyebrow">{selectedView === 'overview' ? t('Financial overview') : t(selectedNav)}</p>
            <h1>{selectedView === 'overview' ? t('Dashboard') : t(selectedNav)}</h1>
          </div>
          {selectedView === 'overview' && (
            <div className="header-status">
              <span className="status-dot" />{business?.name || sessionUser.businessName}
              <span aria-hidden="true" className="date-filter-icon">📅</span>
              <select
                aria-label={t('Financial overview date range')}
                value={chartRange}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'custom') loadDashboardChart('custom', todayDate, customChartStart, customChartEnd)
                  else loadDashboardChart(value, todayDate)
                }}
                disabled={chartLoading}
                className="header-date-filter"
              >
                <option value="today">{t('Today')}</option>
                <option value="yesterday">{t('Yesterday')}</option>
                <option value="thisWeek">{t('This Week')}</option>
                <option value="lastWeek">{t('Last Week')}</option>
                <option value="month">{t('This Month')}</option>
                <option value="lastMonth">{t('Last Month')}</option>
                <option value="thisQuarter">{t('This Quarter')}</option>
                <option value="thisYear">{t('This Year')}</option>
                <option value="custom">{t('Custom Date Range')}</option>
              </select>
            </div>
          )}
        </section>
        {dashboard.fxWarnings?.map((warning) => <p className="fx-warning" role="status" key={warning}>{t(warning)}</p>)}

        {selectedView === 'overview' && <section className="stats-grid financial-kpi-grid">
          {metricCards.map((card, index) => (
            (() => {
              const currentValue = Number(dashboard.metrics[card.key]) || 0
              const previousValue = Number(dashboard.previousPeriod?.[card.key])
              const comparison = getMetricComparison(currentValue, previousValue, card.key, language)
              return <motion.article className={`stat-card financial-kpi-card ${card.key === 'netProfit' ? (currentValue >= 0 ? 'green' : 'red') : card.tone}`} key={card.label} initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.32, delay: reduceMotion ? 0 : index * 0.055 }}>
                <div className="kpi-card-heading">
                  <span>{t(card.label)}</span>
                  <i aria-hidden="true">{card.icon}</i>
                </div>
                <h3>{formatCurrency(currentValue, displayCurrency)}</h3>
                <div className="kpi-card-foot">
                  <span className="kpi-indicator" />
                  <span>{t(card.key === 'netProfit' ? 'Gross profit less expenses' : card.key === 'cashFlow' ? 'Collections less expenses' : 'Month to date')}</span>
                </div>
                <small className={`kpi-comparison ${comparison.tone}`} title={Number.isFinite(previousValue) ? `Previous month to date: ${formatCurrency(previousValue, displayCurrency)}` : undefined}>
                  {comparison.label}
                </small>
              </motion.article>
            })()
          ))}
        </section>}

        {selectedView === 'overview' && <section className="dashboard-secondary-metrics" aria-label={t('Daily activity')}>
          <article className="dashboard-secondary-card"><span>{t(chartRange === 'today' ? "Today's Sales" : 'Selected Period Sales')}</span><strong>{formatCurrency((chartRange === 'today' ? dashboard.metrics.todaySales : dashboard.metrics.revenue) || 0, displayCurrency)}</strong><small>{t(chartRange === 'today' ? 'Sales recorded today' : 'Sales recorded in selected period')}</small></article>
          <article className="dashboard-secondary-card stock-alert"><span>{t('Low Stock')}</span><strong>{dashboard.metrics.lowStock || 0}<small> / {dashboard.metrics.productCount || 0}</small></strong><small>{t('Products at or below reorder level')}</small></article>
        </section>}

        {(selectedView === 'overview' || selectedView === 'performance') && <section className={`financial-chart-grid${selectedView !== 'overview' ? ' single-column-grid' : ''}`}>
          <div className="panel chart-panel financial-flow-panel">
            <div className="panel-header">
            <div><p className="eyebrow">{t('Business Performance')}</p><h3>{t('Revenue, expenses & net profit')}</h3></div>
              <div className="chart-filters">
                <select
                  aria-label={t('Chart date range')}
                  value={chartRange}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === 'custom') {
                      loadDashboardChart('custom', todayDate, customChartStart, customChartEnd)
                    } else {
                      loadDashboardChart(value, todayDate)
                    }
                  }}
                  disabled={chartLoading}
                >
                  <option value="today">{t('Today')}</option>
                  <option value="yesterday">{t('Yesterday')}</option>
                  <option value="thisWeek">{t('This Week')}</option>
                  <option value="lastWeek">{t('Last Week')}</option>
                  <option value="month">{t('This Month')}</option>
                  <option value="lastMonth">{t('Last Month')}</option>
                  <option value="thisQuarter">{t('This Quarter')}</option>
                  <option value="thisYear">{t('This Year')}</option>
                  <option value="custom">{t('Custom Date Range')}</option>
                </select>
                {chartRange === 'custom' && (
                  <div className="custom-date-range">
                    <label><span className="sr-only">{t('Start date')}</span><input aria-label={t('Start date')} type="date" value={customChartStart} max={customChartEnd} onChange={(event) => setCustomChartStart(event.target.value)} /></label>
                    <span>–</span>
                    <label><span className="sr-only">{t('End date')}</span><input aria-label={t('End date')} type="date" value={customChartEnd} max={todayDate} min={customChartStart} onChange={(event) => setCustomChartEnd(event.target.value)} /></label>
                    <button type="button" className="range-apply-button" onClick={() => loadDashboardChart('custom', todayDate, customChartStart, customChartEnd)} disabled={chartLoading}>{t('Apply')}</button>
                    <button type="button" className="ghost-button small" onClick={() => loadDashboardChart('month', todayDate)} disabled={chartLoading}>{t('Reset')}</button>
                  </div>
                )}
              </div>
            </div>
            <div className="financial-chart-content" aria-busy={chartLoading}>
              {chartLoading && <p className="dashboard-chart-status" role="status">{t('Updating financial chart')}</p>}
              {chartError && <p className="dashboard-chart-error" role="alert">{chartError} <button type="button" className="text-action" onClick={() => loadDashboardChart(chartRange, chartDate, customChartStart, customChartEnd)} disabled={chartLoading}>{t('Retry')}</button></p>}
              <PerformanceGraph chart={dashboard.chart} currencyCode={displayCurrency} language={language} />
            </div>
          </div>
          {selectedView === 'overview' && <ExpenseBreakdown expenses={dashboard.expenseBreakdown} currencyCode={displayCurrency} language={language} />}
        </section>}

        {selectedView === 'overview' && <section className="panel recent-panel financial-transactions-panel">
          <div className="panel-header financial-transactions-header">
            <div><p className="eyebrow">{t('Recent activity')}</p><h3>{t('Recent Transactions')}</h3></div>
            <div className="financial-transaction-tools">
              <label className="transaction-filter-select"><span className="sr-only">{t('Filter by category')}</span>
                <select value={transactionCategoryFilter} onChange={(event) => { setTransactionCategoryFilter(event.target.value); setTransactionPage(1) }} aria-label={t('Filter by category')}>
                  <option value="">{t('All categories')}</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <button type="button" className="sort-transactions-button" onClick={() => { setTransactionSortDirection((value) => value === 'desc' ? 'asc' : 'desc'); setTransactionPage(1) }}>{t('Date')} {transactionSortDirection === 'desc' ? '↓' : '↑'}</button>
            </div>
          </div>
          <div className="financial-transactions-scroll">
            <table className="financial-transactions-table">
              <thead><tr>
                <th>{t('Transaction ID')}</th><th>{t('Description')}</th>
                <th><button type="button" className="table-sort-button" onClick={() => setTransactionSortDirection((value) => value === 'desc' ? 'asc' : 'desc')}>{t('Date')} {transactionSortDirection === 'desc' ? '↓' : '↑'}</button></th>
                <th>{t('Category')}</th><th>{t('Amount')}</th><th>{t('Status')}</th>
              </tr></thead>
              <tbody>
                {pagedDashboardTransactions.map((item) => (
                  <tr key={`${item.category}-${item.id}`}>
                    <td className="transaction-id">{item.id}</td><td className="transaction-description">{item.description}</td>
                    <td>{new Date(`${String(item.date).slice(0, 10)}T00:00:00`).toLocaleDateString(language === 'sw' ? 'sw-TZ' : 'en-TZ', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td><span className="transaction-category"><i className={item.amount < 0 ? 'expense-dot' : 'income-dot'} />{item.category}</span></td>
                    <td className={item.amount < 0 ? 'transaction-negative' : 'transaction-positive'}>{formatCurrency(item.amount, displayCurrency)}</td>
                    <td><span className={`transaction-status ${['paid', 'recorded'].includes(item.status) ? 'complete' : 'pending'}`}>{t(item.status)}</span></td>
                  </tr>
                ))}
                {!visibleDashboardTransactions.length && <tr><td colSpan="6" className="empty-table">{t('No matching transactions found.')}</td></tr>}
              </tbody>
            </table>
          </div>
          {visibleDashboardTransactions.length > transactionPageSize && <footer className="transaction-pagination">
            <span>{t('Showing')} {(transactionPage - 1) * transactionPageSize + 1} to {Math.min(transactionPage * transactionPageSize, visibleDashboardTransactions.length)} {t('of')} {visibleDashboardTransactions.length}</span>
            <div><button type="button" className="ghost-button small" onClick={() => setTransactionPage((page) => Math.max(1, page - 1))} disabled={transactionPage <= 1}>{t('Previous')}</button><span>{transactionPage} / {transactionPageCount}</span><button type="button" className="ghost-button small" onClick={() => setTransactionPage((page) => Math.min(transactionPageCount, page + 1))} disabled={transactionPage >= transactionPageCount}>{t('Next')}</button></div>
          </footer>}
        </section>}

        {selectedView === 'subscription' && <section className="panel subscription-panel page-section">
            <div className="panel-header"><div><p className="eyebrow">{t('Subscription')}</p><h3>{t('Current plan')}</h3></div><span className={`pill ${dashboard.subscription?.status === 'active' ? 'success' : ''}`}>{dashboard.subscription?.status || t('Not set up')}</span></div>
            {dashboard.subscription ? (
              <>
                <div className="plan-box">
                  <strong>{dashboard.subscription.name}</strong>
                  <div className="plan-meta"><span>{formatCurrency(dashboard.subscription.price, displayCurrency)} / {dashboard.subscription.billingPeriod}</span><span>{t('Renews:')} {new Date(dashboard.subscription.currentPeriodEnd).toLocaleDateString()}</span></div>
                </div>
                <ul className="feature-stack"><li>{t('Unlimited products')}</li><li>{t('Multi-user access')}</li><li>{t('Advanced reporting')}</li></ul>
              </>
            ) : <p className="section-description">{t('No subscription is currently assigned to this business.')}</p>}
          </section>}

        {selectedView === 'products' && <section className="bottom-grid single-column-grid">
          <div className="panel table-panel" id="products">
            <div className="panel-header">
              <div><p className="eyebrow">{t('Inventory')}</p><h3>{t('Product stock')}</h3></div>
              <span className="inventory-value">{t('Stock cost value:')} {formatCurrency(dashboard.metrics.inventoryValue || 0, displayCurrency)}</span>
              <button type="button" className="primary-button small" onClick={() => setModal('product')}>{t('Add Product')}</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>{t('Product')}</th><th>{t('SKU')}</th><th>{t('Stock')}</th><th>{t('Selling price')}</th><th>{t('Status')}</th><th>{t('Action')}</th></tr></thead>
                <tbody>
                  {products.map((row) => (
                    <tr key={row.sku}>
                      <td><div className="admin-product-identity"><ProductImageView product={row} className="admin-product-thumbnail" /><span>{row.name}</span></div></td><td>{row.sku}</td><td>{row.stock}</td><td>{formatCurrency(row.sellingPrice, displayCurrency)}</td>
                      <td><span className={row.stock <= row.reorderLevel ? 'status-badge danger' : 'status-badge ok'}>{row.stock <= row.reorderLevel ? t('Review stock') : t('Healthy')}</span></td>
                      <td><div className="admin-product-actions"><button type="button" className="text-action" onClick={() => { setProductToEditImage(row); setModal('product-image') }}>{t('Edit image')}</button><button type="button" className="text-action" onClick={() => { setProductToRestock(row); setModal('restock') }}>{t('Restock')}</button></div></td>
                    </tr>
                  ))}
                  {products.length === 0 && <tr><td colSpan="6" className="empty-table">{t('No products have been added yet.')}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

        </section>}

        {selectedView === 'sales' && <section className="sales-pos-layout">
          <div className="panel pos-catalog-panel">
            <div className="pos-catalog-heading">
              <div><p className="eyebrow">{t('Fast sales')}</p><h2>{t('Product Catalog')}</h2><p>{visiblePosProducts.length} {t('products available')}</p></div>
              <button type="button" className="ghost-button pos-mobile-cart-toggle" onClick={() => setCartDrawerOpen((open) => !open)} aria-expanded={cartDrawerOpen}>{t('Shopping Cart')} <span className="pos-cart-badge">{cart.length}</span></button>
            </div>
            <form className="pos-product-search pos-catalog-search" onSubmit={(event) => { event.preventDefault(); setPosProductQuery(posProductSearch) }} role="search">
              <label htmlFor="pos-product-search">{t('Search products')}</label>
              <div><input id="pos-product-search" type="search" value={posProductSearch} onChange={(event) => { setPosProductSearch(event.target.value); setPosProductQuery(event.target.value) }} placeholder={t('Search by product name or SKU')} /><button type="submit" className="primary-button small">{t('Search')}</button></div>
            </form>
            <div className="pos-category-filters" role="group" aria-label={t('Filter products by category')}>
              <button type="button" className={productCategoryFilter === '' ? 'pos-category-filter active' : 'pos-category-filter'} aria-pressed={productCategoryFilter === ''} onClick={() => setProductCategoryFilter('')}>{t('All products')}</button>
              {productCategories.map((category) => <button type="button" key={category.id} className={productCategoryFilter === category.id ? 'pos-category-filter active' : 'pos-category-filter'} aria-pressed={productCategoryFilter === category.id} onClick={() => setProductCategoryFilter(category.id)}>{category.name}</button>)}
            </div>
            <div className="pos-product-grid">
              {visiblePosProducts.map((product) => <article className="pos-product-card" key={product.id}>
                <div className="pos-product-art"><ProductImageView product={product} className="product-art-image" /></div>
                <div className="pos-product-card-copy"><strong title={product.label}>{product.label}</strong><small>{product.sku || t('No SKU')}</small></div>
                <div className="pos-product-card-meta"><strong>{formatCurrency(product.price, displayCurrency)}</strong><span className={product.stock <= product.reorderLevel ? 'pos-stock low' : 'pos-stock'}>{product.stock > 0 ? product.stock + ' ' + t('in stock') : t('Out of stock')}</span></div>
                <button type="button" className="pos-add-button" onClick={() => addToCart(product)} disabled={product.stock <= 0 || saleSubmitting}>{product.stock > 0 ? t('Add to cart') : t('Unavailable')}</button>
              </article>)}
              {!visiblePosProducts.length && <p className="pos-search-empty">{!productsLoaded ? t('Loading products...') : products.length ? t('No matching products found.') : t('No products have been added yet.')}</p>}
            </div>
          </div>

          {cartDrawerOpen && <button type="button" className="pos-cart-backdrop" aria-label={t('Close cart')} onClick={() => setCartDrawerOpen(false)} />}
          <aside className={cartDrawerOpen ? 'panel pos-cart-panel mobile-cart-open' : 'panel pos-cart-panel'} role={cartDrawerOpen ? 'dialog' : undefined} aria-modal={cartDrawerOpen ? 'true' : undefined} aria-label={t('Shopping Cart')}>
            <div className="pos-cart-heading"><div><p className="eyebrow">{t('Checkout')}</p><h2>{t('Shopping Cart')}</h2></div><span className="pos-cart-badge">{cart.length}</span><button type="button" className="pos-cart-close" onClick={() => setCartDrawerOpen(false)} aria-label={t('Close cart')}>&times;</button></div>
            <button type="button" className="pos-clear-cart" onClick={clearCart} disabled={!cart.length || saleSubmitting}>{t('Clear cart')}</button>
            <div className="pos-cart-items" aria-live="polite">
              {cart.length === 0 ? <div className="pos-empty-cart"><span><Package size={28} /></span><strong>{t('Your cart is empty')}</strong><p>{t('Select a product to start a sale.')}</p></div> : cart.map((item) => <article className="pos-cart-item" key={item.id}>
                <div className="pos-cart-item-top"><ProductImageView product={item} className="pos-cart-product-image" /><div><strong>{item.name}</strong><small>{formatCurrency(item.price, displayCurrency)} {t('each')}</small></div><button type="button" className="pos-remove-item" onClick={() => changeQuantity(item.id, -item.qty)} aria-label={t('Remove item')}>?</button></div>
                <div className="pos-cart-item-bottom"><div className="quantity-controls"><button type="button" aria-label={t('Decrease quantity')} onClick={() => changeQuantity(item.id, -1)}>?</button><span>{item.qty}</span><button type="button" aria-label={t('Increase quantity')} onClick={() => changeQuantity(item.id, 1)} disabled={item.qty >= item.stock}>+</button></div><strong>{formatCurrency(item.price * item.qty, displayCurrency)}</strong></div>
              </article>)}
            </div>
            <div className="pos-cart-summary">
              <div><span>{t('Subtotal')}</span><strong>{formatCurrency(cartTotal, displayCurrency)}</strong></div>
              <div className="pos-total-row"><span>{t('Total payable')}</span><strong>{formatCurrency(cartTotal, displayCurrency)}</strong></div>
              <label>{t('Customer name (optional)')}<input value={saleCustomer} onChange={(event) => setSaleCustomer(event.target.value)} maxLength="150" placeholder={t('Walk-in customer')} /></label>
              <label>{t('Payment method')}<select value={salePaymentMethod} onChange={(event) => setSalePaymentMethod(event.target.value)}><option value="cash">{t('Cash')}</option><option value="mobile_money">{t('Mobile money')}</option><option value="card">{t('Card')}</option><option value="bank_transfer">{t('Bank transfer')}</option><option value="other">{t('Other')}</option></select></label>
              <button type="button" className="primary-button large pos-checkout-button" onClick={() => completeSale(saleCustomer.trim() || 'Walk-in customer', salePaymentMethod)} disabled={!cart.length || cart.some((item) => item.stock < 1 || item.qty > item.stock) || saleSubmitting}>{saleSubmitting ? t('Processing sale...') : t('COMPLETE SALE')}</button>
            </div>
          </aside>
        </section>}

        {selectedView === 'transactions' && <section className="panel recent-panel">
          <div className="panel-header">
          <div><p className="eyebrow">{t('Transactions')}</p><h3>{t('Recent sales')}</h3></div>
            <div className="sales-history-controls">
              <label className="chart-date-label">
                <span>{t('Sales date')}</span>
                <input
                  type="date"
                  aria-label={t('Filter sales by date')}
                  value={salesDate}
                  max={todayDate}
                  onChange={(event) => loadSalesForDate(event.target.value)}
                />
              </label>
              {salesDate && <button type="button" className="ghost-button" onClick={() => loadSalesForDate('')}>{t('All dates')}</button>}
              {!salesDate && <button type="button" className="ghost-button" onClick={() => setShowAllSales((show) => !show)}>{showAllSales ? t('Show recent') : t('View all')}</button>}
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>{t('Date & time')}</th><th>{t('Receipt')}</th><th>{t('Customer')}</th><th>{t('Item')}</th><th>{t('Sold by')}</th><th>{t('Amount')}</th><th>{t('Gross profit')}</th><th>{t('Status')}</th></tr></thead>
              <tbody>
                {(showAllSales ? transactions : transactions.slice(0, 4)).map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{transaction.businessDateTime || '—'}</td><td>{transaction.id}</td><td>{transaction.customer}</td><td>{transaction.item}</td><td>{transaction.soldBy || 'Unknown'}</td><td title={`Snapshot conversion: ${transaction.rateUpdatedAt ? new Date(transaction.rateUpdatedAt).toLocaleString() : 'same-currency transaction'}`}><strong>{formatCurrency(transaction.amount, displayCurrency)}</strong><small className="money-origin">Recorded: {formatCurrency(transaction.originalAmount, transaction.originalCurrency)}</small></td><td>{transaction.profit == null ? '—' : formatCurrency(transaction.profit, displayCurrency)}</td>
                    <td>{saleStatusBadge(transaction.status)}</td>
                  </tr>
                ))}
                {transactions.length === 0 && <tr><td colSpan="8" className="empty-table">{salesDate ? `${t('No sales were recorded on')} ${salesDate}.` : t('No sales have been recorded yet.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>}

        {selectedView === 'costs' && <section className="panel recent-panel">
          <div className="panel-header">
          <div><p className="eyebrow">{t('Business costs')}</p><h3>{t('Recent expenses')}</h3></div>
          <button type="button" className="primary-button small" onClick={() => setModal('expense')}>+ {t('Add expense')}</button>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>{t('Date')}</th><th>{t('Category')}</th><th>{t('Description')}</th><th>{t('Amount')}</th></tr></thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{new Date(`${expense.expense_date.slice(0, 10)}T00:00:00`).toLocaleDateString()}</td>
                    <td>{expense.category}</td><td>{expense.description}</td><td title={`Snapshot conversion: ${expense.rateUpdatedAt ? new Date(expense.rateUpdatedAt).toLocaleString() : 'same-currency transaction'}`}><strong>{formatCurrency(expense.amount, displayCurrency)}</strong><small className="money-origin">Recorded: {formatCurrency(expense.originalAmount, expense.originalCurrency)}</small></td>
                  </tr>
                ))}
                {expenses.length === 0 && <tr><td colSpan="4" className="empty-table">{t('No expenses have been recorded yet.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>}

        {selectedView === 'team' && <section className="panel agents-panel">
          <div className="panel-header">
            <div><p className="eyebrow">{t('Team access')}</p><h3>{t('Sales agents')}</h3></div>
            <button type="button" className="primary-button small" onClick={() => setModal('sales-agent')}>+ {t('Register sales agent')}</button>
          </div>
          <p className="section-description">{t('Manage agent access to the')} {business?.name || 'business'} {t('sales workspace.')}</p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>{t('Agent')}</th><th>{t('Contact')}</th><th>{t('Sales')}</th><th>{t('Status')}</th><th>{t('Actions')}</th></tr></thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td><div className="agent-identity"><span className="mini-avatar">{agent.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><strong>{agent.name}</strong><small>{agent.id}</small></span></div></td>
                    <td><span>{agent.email}</span><small className="contact-phone">{agent.phone}</small></td>
                    <td>{agent.sales}</td>
                    <td><span className={`status-badge ${agent.status === 'active' ? 'ok' : 'warning'}`}>{agent.status === 'active' ? t('Active') : t('Paused')}</span></td>
                    <td>
                      <div className="agent-actions">
                        <button type="button" className="text-action" onClick={() => toggleAgentStatus(agent)}>{agent.status === 'active' ? t('Pause') : t('Resume')}</button>
                        <button type="button" className="text-action" onClick={() => setAgentToReset(agent)}>{t('Reset password')}</button>
                        <button type="button" className="text-action danger-action" onClick={() => setAgentToDelete(agent)}>{t('Delete')}</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {agents.length === 0 && <tr><td colSpan="5" className="empty-table">{t('No sales agents are registered. Register an agent to provide sales access.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>}

        {selectedView === 'settings' && <section className="panel page-section">
          <div className="panel-header">
            <div><p className="eyebrow">{t('Business settings')}</p><h3>{t(selectedNav === 'Business Profile' ? 'Business profile' : 'System settings')}</h3></div>
          </div>
          <div className="user-preferences-panel">
            <div>
              <strong>{t('Personal preferences')}</strong>
              <p className="section-description">{t('Your theme and language are saved to your account and follow you between sessions.')}</p>
            </div>
            <PreferenceControls
              theme={theme}
              language={language}
              onThemeChange={(value) => savePreference('theme', value)}
              onLanguageChange={(value) => savePreference('language', value)}
            />
          </div>
          {selectedNav === 'Business Profile' ? (
            <form className="settings-form" onSubmit={saveBusinessSettings}>
              <p className="section-description">{t('Update the contact and profile details associated with your business.')}</p>
              <div className="business-logo-setting">
                <div>
                  <strong>Business logo</strong>
                  <p className="section-description">Upload a PNG, JPEG, or WebP image up to 5 MB. The logo appears in both Business Admin and Sales Agent panels.</p>
                </div>
                {pendingBusinessLogoPreview || business?.logoUpdatedAt
                  ? <img src={pendingBusinessLogoPreview || `/api/business/logo?v=${encodeURIComponent(business.logoUpdatedAt)}`} alt={`${business.name} logo preview`} className="business-logo-preview" />
                  : <span className="business-logo-preview business-logo-fallback" aria-label={t('Default business logo')}>▧</span>}
                <div className="business-logo-actions">
                  <label className="ghost-button business-logo-upload">
                    {pendingBusinessLogo ? t('Choose another image') : business?.logoUpdatedAt ? t('Replace logo') : t('Upload logo')}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectBusinessLogo} disabled={logoUploading} />
                  </label>
                  {pendingBusinessLogo && <>
                    <button type="button" className="primary-button small" onClick={saveBusinessLogo} disabled={logoUploading}>{logoUploading ? t('Uploading…') : t('Save logo')}</button>
                    <button type="button" className="ghost-button small" onClick={() => setPendingBusinessLogo(null)} disabled={logoUploading}>{t('Cancel')}</button>
                  </>}
                  {business?.logoUpdatedAt && !pendingBusinessLogo && <button type="button" className="text-action danger-action" onClick={removeBusinessLogo} disabled={logoUploading}>{t('Remove logo')}</button>}
                </div>
              </div>
              <div className="settings-fields">
                <label>{t('Business name')}<input name="name" defaultValue={business?.name || ''} required maxLength="150" /></label>
                <label>{t('Business email')}<input name="email" type="email" defaultValue={business?.email || ''} required maxLength="254" /></label>
                <label>{t('Phone number')}<input name="phone" type="tel" defaultValue={business?.phone || ''} required maxLength="40" /></label>
                <label>{t('Industry')}<input name="industry" defaultValue={business?.industry || ''} required maxLength="100" /></label>
              </div>
              <div className="settings-actions"><button type="submit" className="primary-button" disabled={settingsSaving}>{settingsSaving ? t('Saving…') : t('Save business profile')}</button></div>
            </form>
          ) : (
            <form className="settings-form" onSubmit={saveBusinessSettings}>
              <p className="section-description">Set the defaults used to display currency and determine business-local sales and expense dates.</p>
              <div className="settings-fields">
                <label>Business currency
                  <select name="currency" defaultValue={business?.currency || 'TZS'} required>
                    {business?.currency && !supportedCurrencies.includes(business.currency) && <option value={business.currency} disabled>{business.currency} — select a supported currency</option>}
                    {supportedCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}
                  </select>
                </label>
                <label>Business timezone
                  <select name="timezone" defaultValue={business?.timezone || 'Africa/Dar_es_Salaam'} required>
                    {[...new Set(['Africa/Dar_es_Salaam', 'Africa/Nairobi', 'Africa/Kampala', 'UTC', business?.timezone].filter(Boolean))].map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
                  </select>
                </label>
              </div>
              <div className="exchange-rate-panel">
                <div>
                  <strong>Daily reference exchange rates</strong>
                  <p>New transactions save their original amount, currency, conversion rate, and a rate snapshot. Existing amounts are never overwritten; changing the business currency requires confirmation before older records without snapshots are converted for display.</p>
                </div>
                {exchangeRatesLoading && !exchangeRateData && <small role="status">Loading exchange rates…</small>}
                {exchangeRateError && <p className="fx-warning" role="alert">Rates are unavailable: {exchangeRateError}. New transactions that need conversion cannot be saved until a rate is available.</p>}
                {exchangeRateData ? (
                  <>
                    {exchangeRateData.isStale && <p className="fx-warning" role="alert">Warning: these exchange rates are outdated. A saved local snapshot is being used; verify it before relying on a new conversion.</p>}
                    <small>Last update: {new Date(exchangeRateData.updatedAt).toLocaleString()} · Next update: {new Date(exchangeRateData.nextUpdateAt).toLocaleString()}{exchangeRatesLoading ? ' · Refreshing…' : ''}</small>
                    <div className="table-scroll">
                      <table>
                        <thead><tr><th>From</th><th>To</th><th>Rate</th></tr></thead>
                        <tbody>{supportedCurrencies.filter((code) => code !== displayCurrency).map((code) => {
                          const rate = exchangeRateData.rates[code] / exchangeRateData.rates[displayCurrency]
                          return <tr key={code}><td>1 {displayCurrency}</td><td>{code}</td><td>{Number.isFinite(rate) ? new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 }).format(rate) : 'Unavailable'}</td></tr>
                        })}</tbody>
                      </table>
                    </div>
                    <small>Source: <a href="https://www.exchangerate-api.com/docs/free" target="_blank" rel="noreferrer">{exchangeRateData.provider}</a>. Reference rates update daily and may differ from bank or payment-provider rates.</small>
                  </>) : !exchangeRatesLoading && !exchangeRateError && <small>Exchange-rate data has not loaded.</small>}
                <form className="currency-converter" onSubmit={convertAmount}>
                  <strong>Convert an amount</strong>
                  <div className="currency-converter-fields">
                    <label>Amount<input type="number" min="0" step="0.01" required value={conversionForm.amount} onChange={(event) => { setConversionForm({ ...conversionForm, amount: event.target.value }); setConversionResult(null) }} /></label>
                    <label>From<select value={conversionForm.fromCurrency} onChange={(event) => { setConversionForm({ ...conversionForm, fromCurrency: event.target.value }); setConversionResult(null) }}>{supportedCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
                    <label>To<select value={conversionForm.toCurrency} onChange={(event) => { setConversionForm({ ...conversionForm, toCurrency: event.target.value }); setConversionResult(null) }}>{supportedCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
                    <button className="primary-button small" type="submit" disabled={conversionLoading}>{conversionLoading ? 'Converting…' : 'Convert'}</button>
                  </div>
                  {conversionError && <p className="fx-warning" role="alert">{conversionError}</p>}
                  {conversionResult && <p className="conversion-result" role="status">{formatCurrency(conversionResult.amount, conversionResult.fromCurrency)} = <strong>{formatCurrency(conversionResult.convertedAmount, conversionResult.toCurrency)}</strong> <span>(1 {conversionResult.fromCurrency} = {new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 }).format(conversionResult.rate)} {conversionResult.toCurrency}; rate updated {new Date(conversionResult.updatedAt).toLocaleString()})</span>{conversionResult.isStale && <span className="fx-warning"> Using an outdated saved rate.</span>}</p>}
                </form>
              </div>
              <div className="settings-actions"><button type="submit" className="primary-button" disabled={settingsSaving}>{settingsSaving ? 'Saving…' : 'Save system settings'}</button></div>
            </form>
          )}
        </section>}

        {selectedView === 'debts' && (selectedCustomer ? (
          <CustomerDebtDetails
            customer={selectedCustomer}
            currencyCode={displayCurrency}
            isAdmin={sessionUser.role === 'business_admin'}
            language={language}
            onBack={() => setSelectedCustomer(null)}
            onAddDebt={() => setDebtEntryDialog(selectedCustomer)}
            onPayment={() => setPaymentDialog(selectedCustomer)}
            onEditCustomer={() => setDebtCustomerDialog({ mode: 'edit', customer: selectedCustomer })}
            onDeleteCustomer={() => setDeleteCustomerDialog(selectedCustomer)}
            onCorrect={(transaction) => setCorrectTransactionDialog({ customer: selectedCustomer, transaction })}
            onVoid={(transaction) => setVoidTransactionDialog({ customer: selectedCustomer, transaction })}
            onReviewReport={() => setSelectedNav('Debt Reports')}
          />
        ) : (
          <DebtsOverview
            customers={customers}
            report={debtsReport}
            currencyCode={displayCurrency}
            isAdmin={sessionUser.role === 'business_admin'}
            language={language}
            search={customerSearch}
            onSearchChange={onCustomerSearchChange}
            statusFilter={customerStatusFilter}
            onStatusFilterChange={(value) => {
              setCustomerStatusFilter(value)
              loadCustomers(customerSearch, value)
            }}
            onOpenCustomer={openCustomer}
            onRegisterCustomer={() => setDebtCustomerDialog({ mode: 'create', customer: null })}
          />
        ))}
      </main>
      {modal && <Modal type={modal} setupRequired={setupRequired} currencyCode={displayCurrency} product={productToEditImage} maxProductImageBytes={productImageMaxBytes} productImageBusy={productImageBusy} onSaveProductImage={saveProductImage} onClose={() => { setModal(''); setProductToRestock(null); setProductToEditImage(null) }} onAddProduct={addProduct} onAddAgent={addAgent} onAddExpense={addExpense} onRestockProduct={restockProduct} restockProduct={productToRestock} />}
      {agentToDelete && <DeleteAgentDialog agent={agentToDelete} onCancel={() => setAgentToDelete(null)} onConfirm={deleteAgent} />}
      {agentToReset && (
        <ResetPasswordDialog
          eyebrow="Password recovery"
          title="Reset sales agent password"
          description={<>
            Set a new password for <strong>{agentToReset.name}</strong>. Their existing sessions are signed out immediately.
          </>}
          onCancel={() => setAgentToReset(null)}
          onConfirm={async ({ password }) => {
            await resetAgentPassword(agentToReset, password)
            setAgentToReset(null)
          }}
        />
      )}
      {debtCustomerDialog && (
        <DebtCustomerDialog
          customer={debtCustomerDialog.customer}
          busy={debtActionBusy}
          onCancel={() => setDebtCustomerDialog(null)}
          onSave={saveDebtCustomer}
        />
      )}
      {debtEntryDialog && (
        <AddDebtDialog
          customer={debtEntryDialog}
          products={products}
          currencyCode={displayCurrency}
          language={language}
          busy={debtActionBusy}
          onCancel={() => setDebtEntryDialog(null)}
          onSave={addDebtToCustomer}
        />
      )}
      {paymentDialog && (
        <DebtPaymentDialog
          customer={paymentDialog}
          currencyCode={displayCurrency}
          busy={debtActionBusy}
          onCancel={() => setPaymentDialog(null)}
          onSave={recordDebtPayment}
        />
      )}
      {correctTransactionDialog && (
        <CorrectDebtTransactionDialog
          customer={correctTransactionDialog.customer}
          transaction={correctTransactionDialog.transaction}
          products={products}
          currencyCode={displayCurrency}
          busy={debtActionBusy}
          onCancel={() => setCorrectTransactionDialog(null)}
          onSave={correctDebtTransaction}
        />
      )}
      {voidTransactionDialog && (
        <ConfirmDebtActionDialog
          eyebrow="Irreversible action"
          title={`Remove "${voidTransactionDialog.transaction.productName}" from ${voidTransactionDialog.customer.name}?`}
          description={`This removes the debt line of ${formatCurrency(voidTransactionDialog.transaction.totalAmount, displayCurrency)}, restores the goods to stock, and keeps an audit record.`}
          confirmLabel="Remove debt item"
          danger
          busy={debtActionBusy}
          onCancel={() => setVoidTransactionDialog(null)}
          onConfirm={removeDebtTransaction}
        />
      )}
      {deleteCustomerDialog && (
        <ConfirmDebtActionDialog
          eyebrow="Irreversible action"
          title={`Delete customer "${deleteCustomerDialog.name}"?`}
          description="This permanently deletes the customer, their debt items and payment history. Credit sales are voided and goods from inventory are returned to stock."
          confirmLabel="Delete customer permanently"
          danger
          busy={debtActionBusy}
          onCancel={() => setDeleteCustomerDialog(null)}
          onConfirm={deleteCustomer}
        />
      )}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} language={language} />
    </div>
  )
}

function paymentStatusBadge(status) {
  if (status === 'paid') return <span className="status-badge ok">Paid</span>
  if (status === 'pending') return <span className="status-badge warning">Pending</span>
  if (status === 'overdue') return <span className="status-badge danger">Overdue</span>
  if (status === 'suspended') return <span className="status-badge danger">Suspended</span>
  return <span className="status-badge neutral">No subscription</span>
}

function localDateTimeNow() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function debtStatusBadge(status, language = 'en') {
  if (status === 'paid') return <span className="status-badge ok">{translate('Fully paid', language)}</span>
  if (status === 'partial') return <span className="status-badge warning">{translate('Partially paid', language)}</span>
  return <span className="status-badge danger">{translate('Unpaid', language)}</span>
}

function saleStatusBadge(status) {
  if (status === 'Paid') return <span className="status-badge ok">Paid</span>
  if (status === 'unpaid') return <span className="status-badge danger">Unpaid</span>
  if (status === 'partial') return <span className="status-badge warning">Partial</span>
  if (status === 'refunded') return <span className="status-badge neutral">Refunded</span>
  return <span className="status-badge ok">{status}</span>
}

function DebtsOverview({ customers, report, currencyCode, isAdmin, search, onSearchChange, statusFilter, onStatusFilterChange, onOpenCustomer, onRegisterCustomer, language = 'en' }) {
  const t = (text) => translate(text, language)
  const summary = report?.summary
  return (
    <section className="debts-overview page-section">
      {summary && (
        <section className="stats-grid debts-summary-grid">
          <article className="stat-card blue">
            <div className="stat-info"><p>{t('Total outstanding')}</p><h3>{formatCurrency(summary.totalOutstanding, currencyCode)}</h3></div>
            <span className="stat-delta">{summary.byStatus.unpaid} unpaid · {summary.byStatus.partial} partial</span>
          </article>
          <article className="stat-card green">
            <div className="stat-info"><p>{t('Amount collected')}</p><h3>{formatCurrency(summary.totalCollected, currencyCode)}</h3></div>
            <span className="stat-delta">{summary.byStatus.paid} fully paid customers</span>
          </article>
          <article className="stat-card amber">
            <div className="stat-info"><p>{t('Customers on credit')}</p><h3>{summary.customers}</h3></div>
            <span className="stat-delta">Total debt {formatCurrency(summary.totalDebt, currencyCode)}</span>
          </article>
          <article className={`stat-card ${summary.overdueCount > 0 ? 'rose' : ''}`}>
            <div className="stat-info"><p>{t('Overdue debts')}</p><h3>{summary.overdueCount > 0 ? formatCurrency(summary.overdueTotal, currencyCode) : '—'}</h3></div>
            <span className="stat-delta">{summary.overdueCount > 0 ? `${summary.overdueCount} past due` : 'Nothing overdue'}</span>
          </article>
        </section>
      )}

      {summary?.overdueCount > 0 && (
        <div className="notice-banner" role="status">
          <span>{summary.overdueCount} customer{summary.overdueCount === 1 ? ' is' : 's are'} overdue on credit totalling {formatCurrency(summary.overdueTotal, currencyCode)}. See the debt collection report below.</span>
        </div>
      )}

      <div className="panel table-panel">
        <div className="panel-header">
          <div><p className="eyebrow">{t('Customer debts')}</p><h3>{t('Debtors')}</h3></div>
          {isAdmin && <button type="button" className="primary-button small" onClick={onRegisterCustomer}>{t('Register customer')}</button>}
        </div>
        <div className="debt-toolbar">
          <label className="debt-search">
            <span className="sr-only">Search debtors</span>
            <input
              type="search"
              placeholder={t('Search by name or phone…')}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </label>
          <label className="debt-filter">
            <span className="sr-only">Filter by debt status</span>
            <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
              <option value="">All debt statuses</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partially paid</option>
              <option value="paid">Fully paid</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>{t('Customer')}</th><th>{t('Address')}</th><th>{t('Total debt')}</th><th>{t('Amount paid')}</th><th>{t('Balance')}</th><th>{t('Last transaction')}</th><th>{t('Status')}</th></tr></thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <button type="button" className="customer-name-link" onClick={() => onOpenCustomer(customer)}>
                      <strong>{customer.name}</strong>
                      <small>{customer.phone || 'No phone'}</small>
                    </button>
                  </td>
                  <td>{customer.address || '—'}</td>
                  <td>{formatCurrency(customer.totalDebt, currencyCode)}</td>
                  <td>{formatCurrency(customer.amountPaid, currencyCode)}</td>
                  <td><strong className={customer.balance > 0.005 ? 'debt-balance' : ''}>{formatCurrency(customer.balance, currencyCode)}</strong></td>
                  <td>{customer.lastTransactionAt ? new Date(customer.lastTransactionAt).toLocaleString() : '—'}</td>
                  <td>{debtStatusBadge(customer.debtStatus, language)}</td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan="7" className="empty-table">
                  {search || statusFilter ? 'No customers match the current search or filter.' : 'No customers registered yet. Register a customer to start recording credit sales.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {summary && summary.overdueCount > 0 && (
        <div className="panel table-panel">
          <div className="panel-header"><div><p className="eyebrow">{t('Debt collection report')}</p><h3>{t('Overdue customers')}</h3></div></div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Customer</th><th>Phone</th><th>Balance</th><th>Last transaction</th><th>Days overdue</th></tr></thead>
              <tbody>
                {summary.overdue.map((customer) => (
                  <tr key={customer.id}>
                    <td><button type="button" className="customer-name-link" onClick={() => onOpenCustomer(customer)}><strong>{customer.name}</strong></button></td>
                    <td>{customer.phone || '—'}</td>
                    <td><strong>{formatCurrency(customer.balance, currencyCode)}</strong></td>
                    <td>{customer.lastTransactionAt ? new Date(customer.lastTransactionAt).toLocaleDateString() : '—'}</td>
                    <td><span className="status-badge danger">{customer.overdueDays} days</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

function CustomerDebtDetails({ customer, currencyCode, isAdmin, onBack, onAddDebt, onPayment, onEditCustomer, onDeleteCustomer, onCorrect, onVoid, language = 'en' }) {
  const t = (text) => translate(text, language)
  if (!customer) return null
  return (
    <div className="customer-debt-details">
      <button type="button" className="detail-back" onClick={onBack} aria-label={t('Back to customer debts')}>← {t('Back to customer debts')}</button>

      <section className="panel debt-detail-header">
        <div className="detail-identity">
          <div className="detail-avatar">{customer.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div>
          <div>
            <p className="eyebrow">{t('Debtor')}</p>
            <h1>{customer.name}</h1>
            <p className="detail-owner">{customer.phone || 'No phone'}{customer.address ? ` · ${customer.address}` : ''}</p>
            <p className="detail-registered">Registered {new Date(customer.createdAt).toLocaleDateString()}</p>
          </div>
          {debtStatusBadge(customer.debtStatus, language)}
        </div>
        <div className="debt-balance-grid">
          <div><span>{t('Total debt')}</span><strong>{formatCurrency(customer.totalDebt, currencyCode)}</strong></div>
          <div><span>{t('Amount paid')}</span><strong>{formatCurrency(customer.amountPaid, currencyCode)}</strong></div>
          <div><span>{t('Outstanding balance')}</span><strong className={customer.balance > 0.005 ? 'debt-balance' : ''}>{formatCurrency(customer.balance, currencyCode)}</strong></div>
          <div><span>{t('Debt items')}</span><strong>{customer.transactionCount}</strong></div>
        </div>
      </section>

      <div className="debt-detail-actions">
        <button type="button" className="primary-button" onClick={onAddDebt}>{t('+ Add Debt / Add Items')}</button>
        <button type="button" className="ghost-button" onClick={onPayment} disabled={customer.balance <= 0.005}>{t('Record payment')}</button>
        {isAdmin && <button type="button" className="ghost-button" onClick={onEditCustomer}>{t('Edit details')}</button>}
        {isAdmin && <button type="button" className="danger-button" onClick={onDeleteCustomer}>{t('Delete customer')}</button>}
      </div>

      <section className="panel table-panel">
        <div className="panel-header"><div><p className="eyebrow">{t('Credit ledger')}</p><h3>{t('Items taken on credit')}</h3></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>{t('Date & time')}</th><th>{t('Item')}</th><th>{t('Qty')}</th><th>{t('Unit price')}</th><th>{t('Total')}</th><th>{t('Notes')}</th>{isAdmin && <th>{t('Actions')}</th>}</tr></thead>
            <tbody>
              {customer.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.businessDateTime || new Date(transaction.transactionDate).toLocaleString()}</td>
                  <td><strong>{transaction.productName}</strong></td>
                  <td>{transaction.quantity}</td>
                  <td>{formatCurrency(transaction.unitPrice, currencyCode)}</td>
                  <td>{formatCurrency(transaction.totalAmount, currencyCode)}</td>
                  <td>{transaction.notes || '—'}</td>
                  {isAdmin && (
                    <td>
                      <div className="agent-actions">
                        <button type="button" className="text-action" onClick={() => onCorrect(transaction)}>Correct</button>
                        <button type="button" className="text-action danger-action" onClick={() => onVoid(transaction)}>Remove</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {customer.transactions.length === 0 && <tr><td colSpan={isAdmin ? 7 : 6} className="empty-table">No items taken on credit yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-header"><div><p className="eyebrow">{t('Payment history')}</p><h3>{t('Payments received')}</h3></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>{t('Date & time')}</th><th>{t('Amount')}</th><th>{t('Note')}</th><th>{t('Recorded by')}</th></tr></thead>
            <tbody>
              {customer.payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{payment.businessDateTime || new Date(payment.receivedAt).toLocaleString()}</td>
                  <td><strong>{formatCurrency(payment.amount, currencyCode)}</strong></td>
                  <td>{payment.notes || '—'}</td>
                  <td>{payment.recordedByName}</td>
                </tr>
              ))}
              {customer.payments.length === 0 && <tr><td colSpan="4" className="empty-table">No payments recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function DebtCustomerDialog({ customer, busy, onCancel, onSave, language = 'en' }) {
  const t = (text) => translate(text, language)
  const editing = Boolean(customer)
  const [form, setForm] = useState({
    name: customer?.name || '',
    phone: customer?.phone || '',
    address: customer?.address || '',
  })
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="debt-customer-title">
        <div className="modal-heading">
          <div><p className="eyebrow">{t('Customer details')}</p><h2 id="debt-customer-title">{editing ? t('Edit customer') : t('Register a customer')}</h2></div>
          <button type="button" className="modal-close" aria-label={t('Close dialog')} onClick={onCancel}>×</button>
        </div>
        <form className="modal-form" onSubmit={(event) => {
          event.preventDefault()
          onSave({ name: form.name.trim(), phone: form.phone.trim(), address: form.address.trim() })
        }}>
          <label>{t('Full name')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required autoFocus maxLength="150" /></label>
          <label>{t('Contact phone number')}<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} type="tel" maxLength="40" placeholder={t('e.g. 0718 000 000')} /></label>
          <label>{t('Address (optional)')}<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength="250" /></label>
          <p className="form-copy">{t('One profile per customer. Adding goods on credit later uses this same profile — no duplicate customers.')}</p>
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onCancel}>{t('Cancel')}</button>
            <button type="submit" className="primary-button" disabled={busy || !form.name.trim()}>{busy ? t('Saving…') : (editing ? t('Save changes') : t('Register customer'))}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function AddDebtDialog({ customer, products, currencyCode, language = 'en', busy, onCancel, onSave }) {
  const t = (text) => translate(text, language)
  const availableProducts = products.filter((product) => product.status === 'active')
  const [lines, setLines] = useState([{ key: 1, productId: '', productName: '', quantity: 1, unitPrice: '', notes: '' }])
  const [transactionDate, setTransactionDate] = useState(localDateTimeNow())
  const nextKey = useRef(2)

  const updateLine = (key, patch) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))
  const addLine = () => setLines((current) => [...current, { key: nextKey.current++, productId: '', productName: '', quantity: 1, unitPrice: '', notes: '' }])
  const removeLine = (key) => setLines((current) => current.length > 1 ? current.filter((line) => line.key !== key) : current)

  const selectedProduct = (line) => line.productId ? availableProducts.find((product) => product.id === line.productId) : null
  const total = lines.reduce((sum, line) => {
    const product = selectedProduct(line)
    const price = product ? Number(product.sellingPrice) : (Number(line.unitPrice) || 0)
    return sum + price * (Number(line.quantity) || 0)
  }, 0)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="add-debt-title">
        <div className="modal-heading">
          <div><p className="eyebrow">{t('Credit sale')}</p><h2 id="add-debt-title">{t('Add debt / items for')} {customer.name}</h2></div>
          <button type="button" className="modal-close" aria-label={t('Close dialog')} onClick={onCancel}>×</button>
        </div>
        <form className="modal-form" onSubmit={(event) => {
          event.preventDefault()
          const items = lines.map((line) => {
            const product = selectedProduct(line)
            if (product) return { productId: product.id, quantity: Number(line.quantity), notes: line.notes.trim() }
            return { productName: line.productName.trim(), quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), notes: line.notes.trim() }
          })
          onSave({ items, transactionDate })
        }}>
          <p className="form-copy">{t('Selecting an inventory product uses its current selling price and deducts stock once. Manual items do not affect stock.')}</p>
          <div className="debt-lines-editor">
            {lines.map((line) => {
              const product = selectedProduct(line)
              return (
                <div className="debt-line-row" key={line.key}>
                  <label className="debt-line-product">{t('Item')}
                    <select value={line.productId} onChange={(event) => updateLine(line.key, { productId: event.target.value, productName: '', unitPrice: '' })}>
                      <option value="">{t('Other (manual item)…')}</option>
                      {availableProducts.map((product) => (
                        <option key={product.id} value={product.id}>{product.name} — {product.stock} left</option>
                      ))}
                    </select>
                  </label>
                  {product ? (
                    <>
                      <label className="debt-line-number">{t('Price')}
                        <input type="text" value={formatCurrency(product.sellingPrice, currencyCode)} readOnly aria-label="Unit price from product" />
                      </label>
                      <label className="debt-line-number">{t('Qty')}
                        <input type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} required />
                      </label>
                      <label className="debt-line-stock">{t('Stock')} <em>{product.stock}</em></label>
                    </>
                  ) : (
                    <>
                      <label className="debt-line-name">{t('Item name')}
                        <input value={line.productName} onChange={(event) => updateLine(line.key, { productName: event.target.value })} placeholder={t('e.g. Sugar (2kg)')} required maxLength="200" />
                      </label>
                      <label className="debt-line-number">{t('Unit price')} ({currencyCode})
                        <input type="number" min="0.01" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })} placeholder="0.00" required />
                      </label>
                    </>
                  )}
                  <label className="debt-line-notes">{t('Notes')}
                    <input value={line.notes} onChange={(event) => updateLine(line.key, { notes: event.target.value })} maxLength="500" />
                  </label>
                  <button type="button" className="text-action danger-action" onClick={() => removeLine(line.key)} aria-label={t('Remove this item line')}>{t('Remove')}</button>
                </div>
              )
            })}
          </div>
          <button type="button" className="ghost-button small" onClick={addLine}>{t('+ Add another item')}</button>
          <label className="debt-date-field">{t('Date and time taken')}
            <input type="datetime-local" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} required />
          </label>
          <div className="debt-line-total">{t('New debt total')} <strong>{formatCurrency(total, currencyCode)}</strong></div>
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onCancel}>{t('Cancel')}</button>
            <button type="submit" className="primary-button" disabled={busy || lines.some((line) => {
              const product = selectedProduct(line)
              if (product) return !line.quantity || Number(line.quantity) < 1
              return !line.productName.trim() || !Number(line.unitPrice) || Number(line.unitPrice) <= 0
            })}>{busy ? t('Saving…') : t('Add to debt')}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function DebtPaymentDialog({ customer, currencyCode, busy, onCancel, onSave }) {
  const balance = customer.balance > 0 ? customer.balance : 0
  const [form, setForm] = useState({ amount: String(balance), receivedAt: localDateTimeNow(), notes: '' })
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="record-payment-title">
        <div className="modal-heading">
          <div><p className="eyebrow">Debt payment</p><h2 id="record-payment-title">Record payment for {customer.name}</h2></div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onCancel}>×</button>
        </div>
        <form className="modal-form" onSubmit={(event) => {
          event.preventDefault()
          onSave({ amount: Number(form.amount), receivedAt: form.receivedAt, notes: form.notes.trim() })
        }}>
          <div className="restock-product-summary">
            <strong>Outstanding balance: {formatCurrency(balance, currencyCode)}</strong>
            <span>Payment updates the balance and debt status automatically.</span>
          </div>
          <label>Amount received ({currencyCode})
            <input type="number" min="0.01" step="0.01" max={balance} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required autoFocus />
          </label>
          <label>Received on
            <input type="datetime-local" value={form.receivedAt} onChange={(event) => setForm({ ...form, receivedAt: event.target.value })} required />
          </label>
          <label>Notes (optional)
            <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength="500" placeholder="e.g. Cash received at the counter" />
          </label>
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy || !Number(form.amount) || Number(form.amount) <= 0 || Number(form.amount) > balance + 0.005}>
              {busy ? 'Saving…' : 'Record payment'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function CorrectDebtTransactionDialog({ customer, transaction, products, currencyCode, busy, onCancel, onSave }) {
  const availableProducts = products.filter((product) => product.status === 'active')
  const [itemType, setItemType] = useState(transaction.productId ? 'product' : 'manual')
  const [productId, setProductId] = useState(transaction.productId || '')
  const [productName, setProductName] = useState(transaction.recordedProductName || transaction.productName || '')
  const [unitPrice, setUnitPrice] = useState(transaction.originalUnitPrice != null ? String(transaction.originalUnitPrice) : '')
  const [quantity, setQuantity] = useState(String(transaction.quantity))
  const [notes, setNotes] = useState(transaction.notes || '')
  const [transactionDate, setTransactionDate] = useState(() => {
    const date = new Date(transaction.transactionDate)
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  })
  const chosenProduct = itemType === 'product' && productId ? availableProducts.find((product) => product.id === productId) : null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="correct-debt-title">
        <div className="modal-heading">
          <div><p className="eyebrow">Audited correction</p><h2 id="correct-debt-title">Correct debt item</h2></div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onCancel}>×</button>
        </div>
        <form className="modal-form" onSubmit={(event) => {
          event.preventDefault()
          if (itemType === 'product') {
            onSave({ productId, quantity: Number(quantity), notes, transactionDate })
          } else {
            onSave({ productId: null, productName: productName.trim(), unitPrice: Number(unitPrice), quantity: Number(quantity), notes, transactionDate })
          }
        }}>
          <p className="form-copy">Correcting {transaction.productName} on {customer.name}'s account keeps a full audit record. Inventory prices and stock are refreshed automatically.</p>
          <label>Item type
            <select value={itemType} onChange={(event) => setItemType(event.target.value)}>
              <option value="product">Inventory product</option>
              <option value="manual">Manual item</option>
            </select>
          </label>
          {itemType === 'product' ? (
            <>
              <label>Product
                <select value={productId} onChange={(event) => setProductId(event.target.value)} required>
                  <option value="">Select a product…</option>
                  {availableProducts.map((product) => (
                    <option key={product.id} value={product.id}>{product.name} — {product.stock} left</option>
                  ))}
                </select>
              </label>
              <label>Unit price
                <input type="text" value={chosenProduct ? formatCurrency(chosenProduct.sellingPrice, currencyCode) : '—'} readOnly aria-label="Unit price from product" />
              </label>
            </>
          ) : (
            <>
              <label>Item name<input value={productName} onChange={(event) => setProductName(event.target.value)} required maxLength="200" /></label>
              <label>Unit price ({currencyCode})<input type="number" min="0.01" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} required /></label>
            </>
          )}
          <div className="form-columns">
            <label>Quantity<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
            <label>Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength="500" /></label>
          </div>
          <label>Date and time taken
            <input type="datetime-local" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} required />
          </label>
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy || !Number(quantity) || Number(quantity) < 1 || (itemType === 'product' ? !productId : (!productName.trim() || !Number(unitPrice) || Number(unitPrice) <= 0))}>
              {busy ? 'Saving…' : 'Save correction'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ConfirmDebtActionDialog({ eyebrow, title, description, confirmLabel, danger, busy, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-debt-title">
        <div className="modal-heading">
          <div><p className="eyebrow">{eyebrow}</p><h2 id="confirm-debt-title">{title}</h2></div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onCancel}>×</button>
        </div>
        <div className="modal-form">
          <p className="form-copy">{description}</p>
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>
            <button type="button" className={danger ? 'danger-button' : 'primary-button'} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
          </div>
        </div>
      </section>
    </div>
  )
}

function approvalStatusBadge(status) {
  if (status === 'approved') return <span className="status-badge ok">Approved</span>
  if (status === 'pending') return <span className="status-badge warning">Pending</span>
  if (status === 'rejected') return <span className="status-badge danger">Rejected</span>
  return <span className="status-badge neutral">Legacy</span>
}

function BusinessDetailsPage({ business, onBack, onChangeAccess, onSuspend, onResetPassword, onDelete, onRecordPayment, onVerifyPayment, onReviewApplication }) {
  if (!business) return null
  const suspended = business.status === 'suspended'
  const isApplication = Boolean(business.isApplication)
  return (
    <div className="business-details">
      <button type="button" className="detail-back" onClick={onBack} aria-label="Back to customer accounts">← Back to customer accounts</button>

      <section className="panel business-detail-header">
        <div className="detail-identity">
          <div className="detail-avatar">{business.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div>
          <div>
            <p className="eyebrow">{business.industry || 'Customer account'}</p>
            <h1>{business.name}</h1>
            <p className="detail-owner">{business.ownerName || business.ownerEmail || 'No owner listed'}</p>
          </div>
        </div>
        <div className="detail-badges">
          {approvalStatusBadge(business.approvalStatus)}
          <span className={`status-badge ${business.status === 'active' ? 'ok' : business.status === 'suspended' ? 'danger' : 'warning'}`}>
            {isApplication ? (business.status === 'approved' ? 'No account yet' : 'Awaiting approval') : business.status === 'active' ? 'Access active' : business.status === 'suspended' ? 'Access suspended' : business.status}
          </span>
          {paymentStatusBadge(business.paymentStatus)}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><p className="eyebrow">Business information</p><h3>Account details</h3></div></div>
        <dl className="detail-meta-grid">
          <div><dt>Owner's full name</dt><dd>{business.ownerName || '—'}</dd></div>
          <div><dt>Email address</dt><dd>{business.ownerEmail || business.email || '—'}</dd></div>
          <div><dt>Phone number</dt><dd>{business.phone || '—'}</dd></div>
          <div><dt>{isApplication ? (business.status === 'approved' && business.reviewedAt ? 'Approved on' : 'Application date') : 'Registration date'}</dt><dd>{new Date(business.reviewedAt || business.createdAt).toLocaleDateString()}</dd></div>
          <div><dt>Subscription plan</dt><dd>{business.planName || 'No plan'}</dd></div>
          <div><dt>Monthly fee</dt><dd>{business.fee ? `${formatCurrency(business.fee, business.feeCurrency)} / month` : '—'}</dd></div>
          <div><dt>Payment status</dt><dd>{paymentStatusBadge(business.paymentStatus)}{business.dueDate && <small className="owner-period-end">Due {new Date(business.dueDate).toLocaleDateString()}</small>}</dd></div>
          <div><dt>Last payment</dt>
            <dd>
              {business.lastPaymentAt
                ? <>Received {new Date(business.lastPaymentAt).toLocaleDateString()}{business.lastPaymentAmount ? ` · ${formatCurrency(business.lastPaymentAmount, business.lastPaymentCurrency)}` : ''}</>
                : 'No payment recorded'}
            </dd>
          </div>
        </dl>
      </section>

      {isApplication ? (
        <section className="panel">
          <div className="panel-header"><div><p className="eyebrow">Application status</p><h3>{business.status === 'approved' ? 'Approved application' : 'Awaiting approval'}</h3></div></div>
          <p className="section-description">
            {business.status === 'approved'
              ? 'This application was approved, but no business account exists for it — the account may have been deleted or never created. Review the record in Applications &amp; approvals.'
              : 'This business has applied to join the platform and is waiting for your approval. Approving the application creates the business account and lets the owner sign in — until then nobody from this business can access the platform.'}
          </p>
          <div className="detail-action-row">
            <button type="button" className="primary-button" onClick={onReviewApplication}>Review in Applications &amp; approvals</button>
          </div>
        </section>
      ) : (
        <>
          <section className="panel">
        <div className="panel-header"><div><p className="eyebrow">Subscription &amp; billing</p><h3>Payments</h3></div></div>
        <div className="detail-action-row">
          <button type="button" className="ghost-button" onClick={() => onRecordPayment(business)}>Record payment</button>
          {business.pendingPayment && (
            <button type="button" className="primary-button" onClick={() => onVerifyPayment(business, business.pendingPayment.id)}>Verify payment</button>
          )}
        </div>
        {business.pendingPayment && (
          <p className="form-copy">
            A payment of <strong>{formatCurrency(business.pendingPayment.amount, business.pendingPayment.currency)}</strong> is pending verification.
            {business.pendingPayment.reference ? ` Reference: ${business.pendingPayment.reference}.` : ''}
          </p>
        )}
        {business.outstandingBalance > 0 && (
          <p className="form-copy detail-outstanding">Outstanding balance: {formatCurrency(business.outstandingBalance, business.feeCurrency)}.</p>
        )}
      </section>

      <section className="panel account-actions-panel">
        <div className="panel-header"><div><p className="eyebrow">Account management actions</p><h3>Sensitive actions</h3></div></div>
        <div className="account-actions-grid">
          <article className="account-action-card">
            <h4>{suspended ? 'Reactivate account' : 'Suspend account'}</h4>
            <p>
              {suspended
                ? 'Restore sign-in access for every user of this business immediately.'
                : 'Signs out every user of this business and blocks sign-ins until you reactivate the account.'}
            </p>
            {suspended ? (
              <button type="button" className="primary-button" onClick={() => onChangeAccess(business, 'active')}>Reactivate account</button>
            ) : (
              <button type="button" className="danger-button" onClick={() => onSuspend(business)}>Suspend account</button>
            )}
            {suspended && business.suspendedReason && (
              <p className="detail-reason">Suspended{business.suspendedAt ? ` on ${new Date(business.suspendedAt).toLocaleDateString()}` : ''} — reason: {business.suspendedReason}</p>
            )}
          </article>
          <article className="account-action-card">
            <h4>Reset admin password</h4>
            <p>Sets a new password for the business administrator and signs them out of existing sessions. Pass the new password to the owner securely.</p>
            <button type="button" className="ghost-button" onClick={() => onResetPassword(business)} disabled={!business.ownerUserId}>Reset admin password</button>
          </article>
          <article className="account-action-card">
            <h4>Delete permanently</h4>
            <p>Permanently removes the business and all of its data. Requires your current password and explicit confirmation, and cannot be undone.</p>
            <button type="button" className="danger-button" onClick={() => onDelete(business)}>Delete permanently</button>
          </article>
        </div>
      </section>
        </>
      )}
    </div>
  )
}

function OwnerConsole({ user, businesses, applications, settings, onSignOut, onChangeAccess, onDeleteBusiness, onResetAdminPassword, onApproveApplication, onRejectApplication, onUpdateSubscriptionSettings, onRecordPayment, onVerifyPayment, onRefresh, theme, language, onThemeChange, onLanguageChange, onProfileImageUpdated, onChangePassword, onNotice }) {
  const t = (text) => translate(text, language)
  const [businessToDelete, setBusinessToDelete] = useState(null)
  const [businessToReset, setBusinessToReset] = useState(null)
  const [businessToSuspend, setBusinessToSuspend] = useState(null)
  const [businessToRecordPayment, setBusinessToRecordPayment] = useState(null)
  const [selectedBusinessId, setSelectedBusinessId] = useState(null)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  useEffect(() => {
    if (!mobileNavigationOpen) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMobileNavigationOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileNavigationOpen])
  const businessEmails = new Set(businesses.map((business) => String(business.email || '').toLowerCase()))
  const applicationRows = applications
    .filter((application) =>
      (application.status === 'pending' || application.status === 'approved')
      && !businessEmails.has(String(application.email || '').toLowerCase()),
    )
    .map((application) => ({
      id: `application-${application.id}`,
      name: application.businessName,
      email: application.email,
      phone: application.phone,
      industry: application.industry,
      status: application.status,
      createdAt: application.createdAt,
      registeredAt: application.createdAt,
      reviewedAt: application.reviewedAt,
      reviewedByName: application.reviewedByName,
      ownerUserId: null,
      ownerName: application.ownerName,
      ownerEmail: application.email,
      userCount: 0,
      approvalStatus: application.status,
      planName: null,
      fee: null,
      feeCurrency: 'TZS',
      paymentStatus: null,
      dueDate: null,
      outstandingBalance: 0,
      lastPaymentStatus: null,
      lastPaymentAt: null,
      suspendedAt: null,
      suspendedReason: null,
      pendingPayment: null,
      isApplication: true,
      applicationId: application.id,
    }))
  const overviewBusinesses = [...applicationRows, ...businesses]
  const openBusiness = overviewBusinesses.find((business) => business.id === selectedBusinessId) || null
  const [ownerView, setOwnerView] = useState('businesses')
  const ownerViewInitializedRef = useRef(false)
  useEffect(() => {
    if (ownerViewInitializedRef.current) return
    if (!applications.length) return
    ownerViewInitializedRef.current = true
    if (applications.some((application) => application.status === 'pending')) setOwnerView('applications')
  }, [applications])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [accessFilter, setAccessFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const activeCount = businesses.filter((business) => business.status === 'active').length
  const suspendedCount = businesses.filter((business) => business.status === 'suspended').length
  const overdueCount = businesses.filter((business) => business.paymentStatus === 'overdue').length
  const pendingApplications = applications.filter((application) => application.status === 'pending')
  const approvedApplications = applications.filter((application) => application.status === 'approved')
  const rejectedApplications = applications.filter((application) => application.status === 'rejected')

  const query = filterQuery.trim().toLowerCase()
  const filteredBusinesses = overviewBusinesses.filter((business) => {
    if (accessFilter !== 'all' && business.status !== accessFilter) return false
    if (paymentFilter !== 'all' && (business.paymentStatus || 'none') !== paymentFilter) return false
    if (query) {
      const haystack = [business.name, business.ownerName, business.email, business.industry]
        .filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })

  async function saveSettings(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setSavingSettings(true)
    setSettingsError('')
    try {
      await onUpdateSubscriptionSettings({
        monthlyFee: Number(formData.get('monthlyFee')),
        currency: formData.get('currency'),
        graceDays: Number(formData.get('graceDays')),
      })
    } catch (error) {
      setSettingsError(error.message)
    } finally {
      setSavingSettings(false)
    }
  }

  function applicationStatusBadge(application) {
    if (application.status === 'approved') return <span className="status-badge ok">{t('Approved')}</span>
    if (application.status === 'rejected') return <span className="status-badge danger">{t('Rejected')}</span>
    return <span className="status-badge warning">{t('Pending review')}</span>
  }

  return (
    <div className="owner-shell">
      {pendingApplications.length > 0 && ownerView !== 'applications' && (
        <div className="owner-pending-banner" role="status">
          <span>{pendingApplications.length} business application{pendingApplications.length === 1 ? '' : 's'} awaiting approval.</span>
          <button type="button" className="primary-button small" onClick={() => { setSelectedBusinessId(null); setOwnerView('applications') }}>Review now</button>
        </div>
      )}
      <UnifiedSidebar id="owner-navigation" className="owner-sidebar" open={mobileNavigationOpen} collapsed={sidebarCollapsed} onClose={() => setMobileNavigationOpen(false)} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} closeLabel={t('Close navigation')} collapseLabel={t('Collapse navigation')} expandLabel={t('Expand navigation')} signOutLabel={t('Sign out')} onSignOut={onSignOut} brand={<><span className="unified-brand-mark">B</span><span className="unified-brand-copy"><strong>Business Management</strong><small>Platform owner</small></span></>} profile={<div className="account-controls"><ProfileImageControl user={user} language={language} onUpdated={onProfileImageUpdated} onNotice={onNotice} /><button type="button" className="ghost-button account-password-button" onClick={() => setOwnerChangePasswordOpen(true)}>{t('Change password')}</button></div>}>
        <div className="brand-area">
          <div className="brand-mark">B</div>
          <div><strong>Business Management</strong><span>Platform owner</span></div>
          <button
            type="button"
            className="mobile-navigation-close"
            aria-label="Close navigation"
            onClick={() => setMobileNavigationOpen(false)}
          >×</button>
        </div>
        <div className="owner-nav-label">{t('System management')}</div>
        <nav className="owner-nav" aria-label="Owner console navigation">
          <button
            type="button"
            className={`owner-nav-item${ownerView === 'applications' ? ' active' : ''}`}
            aria-current={ownerView === 'applications' ? 'page' : undefined}
            onClick={() => { setSelectedBusinessId(null); setOwnerView('applications'); setMobileNavigationOpen(false) }}
          >
            <span className="nav-item-icon" aria-hidden="true">▦</span><span>{t('Applications & approvals')}</span>{pendingApplications.length > 0 && <span className="owner-nav-badge">{pendingApplications.length}</span>}
            {pendingApplications.length > 0 && <span className="owner-nav-badge">{pendingApplications.length}</span>}
          </button>
          <button
            type="button"
            className={`owner-nav-item${ownerView === 'businesses' ? ' active' : ''}`}
            aria-current={ownerView === 'businesses' ? 'page' : undefined}
            onClick={() => { setSelectedBusinessId(null); setOwnerView('businesses'); setMobileNavigationOpen(false) }}
          >
            <span className="nav-item-icon" aria-hidden="true">▣</span><span>{t('Businesses & subscriptions')}</span>
          </button>
          <button
            type="button"
            className={`owner-nav-item${ownerView === 'settings' ? ' active' : ''}`}
            aria-current={ownerView === 'settings' ? 'page' : undefined}
            onClick={() => { setSelectedBusinessId(null); setOwnerView('settings'); setMobileNavigationOpen(false) }}
          >
            <span className="nav-item-icon" aria-hidden="true">⚙</span><span>{t('Subscription settings')}</span>
          </button>
        </nav>
      </UnifiedSidebar>
      {mobileNavigationOpen && (
        <>
          <button
            type="button"
            className="mobile-navigation-backdrop"
            aria-label={t('Close navigation')}
            onClick={() => setMobileNavigationOpen(false)}
          />
          {createPortal(
            <button type="button" className="mobile-navigation-open-toggle" aria-label={t('Close navigation')} aria-controls="owner-navigation" aria-expanded="true" onClick={() => setMobileNavigationOpen(false)}>
              <span /><span /><span />
            </button>,
            document.body,
          )}
        </>
      )}
      <main className="owner-main">
        <header className="topbar owner-topbar">
          <button
            type="button"
            className="mobile-navigation-toggle"
            aria-label={t(mobileNavigationOpen ? 'Close navigation' : 'Open navigation')}
            aria-controls="owner-navigation"
            aria-expanded={mobileNavigationOpen}
            onClick={() => setMobileNavigationOpen((open) => !open)}
          >
            <span /><span /><span />
          </button>
          <div><p className="eyebrow">{t('Platform administration')}</p><h2>Business Management Portal</h2></div>
          <div className="topbar-tools">
            <div className="owner-header-profile"><UserAvatar user={user} /><span>{user.name}</span></div>
            <PreferenceControls theme={theme} language={language} onThemeChange={onThemeChange} onLanguageChange={onLanguageChange} />
            <button type="button" className="ghost-button" onClick={onRefresh}>{t('Refresh')}</button>
          </div>
        </header>
        {ownerView === 'applications' ? (
          <>
            <section className="page-header">
              <div><p className="eyebrow">{t('System owner workspace')}</p><h1>{t('Business approval management')}</h1><p className="section-description">{t('Review business registrations. Approved businesses can sign in; pending and rejected applicants are blocked until approved.')}</p></div>
              <div className="header-status"><span className="status-dot" />{t('Owner access')}</div>
            </section>
            <section className="stats-grid owner-stats">
              <article className="stat-card amber"><div className="stat-info"><p>{t('Pending review')}</p><h3>{pendingApplications.length}</h3></div><span className="stat-delta">{t('Awaiting decision')}</span></article>
              <article className="stat-card green"><div className="stat-info"><p>{t('Approved')}</p><h3>{approvedApplications.length}</h3></div><span className="stat-delta">{t('Can sign in')}</span></article>
              <article className="stat-card rose"><div className="stat-info"><p>{t('Rejected')}</p><h3>{rejectedApplications.length}</h3></div><span className="stat-delta">{t('Denied access')}</span></article>
            </section>
            <section className="panel owner-business-panel">
              <div className="panel-header">
                <div><p className="eyebrow">{t('Registration queue')}</p><h3>{t('Business applications')}</h3></div>
                <span className="owner-table-count">{applications.length} total</span>
              </div>
              <p className="section-description">Approving an application creates the business account and lets its owner sign in. Rejecting it keeps the applicant out of the system.</p>
              <div className="table-scroll">
                <table className="owner-business-table">
                  <thead><tr><th>Business / owner</th><th>Contact</th><th>Applied</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {applications.map((application) => (
                      <tr key={application.id}>
                        <td><div className="owner-business-identity"><strong>{application.businessName}</strong><span>{application.ownerName}</span><small>{application.industry}</small></div></td>
                        <td><div className="owner-business-identity"><span>{application.email}</span><small>{application.phone}</small></div></td>
                        <td>{new Date(application.createdAt).toLocaleDateString()}</td>
                        <td>
                          {applicationStatusBadge(application)}
                          {application.reviewedAt && <small className="owner-period-end">Reviewed {new Date(application.reviewedAt).toLocaleDateString()}{application.reviewedByName ? ` by ${application.reviewedByName}` : ''}</small>}
                        </td>
                        <td>
                          {application.status === 'pending' && (
                            <div className="owner-business-actions">
                              <button type="button" className="text-action" onClick={() => onApproveApplication(application)}>Approve</button>
                              <button type="button" className="text-action danger-action" onClick={() => onRejectApplication(application)}>Reject</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {applications.length === 0 && <tr><td colSpan="5" className="empty-table">No business applications have been submitted yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : ownerView === 'settings' ? (
          <>
            <section className="page-header">
              <div><p className="eyebrow">System owner workspace</p><h1>Subscription settings</h1><p className="section-description">Set the monthly subscription fee, currency, and payment grace period. New billing periods use the current fee; existing invoices and recorded payments are never changed.</p></div>
              <div className="header-status"><span className="status-dot" />Owner access</div>
            </section>
            <section className="panel owner-business-panel">
              <div className="panel-header">
                <div><p className="eyebrow">Billing configuration</p><h3>Monthly subscription fee</h3></div>
                <span className="owner-table-count">{settings?.planName || 'Business Growth'}</span>
              </div>
              <form key={`settings-${settings?.monthlyFee ?? 'x'}-${settings?.currency ?? 'x'}-${settings?.graceDays ?? 'x'}`} className="modal-form subscription-settings-form" onSubmit={saveSettings}>
                <label>Monthly fee
                  <input type="number" name="monthlyFee" min="0" step="0.01" defaultValue={settings && settings.monthlyFee != null ? Number(settings.monthlyFee) : ''} required />
                </label>
                <label>Currency
                  <select name="currency" defaultValue={settings?.currency || 'TZS'}>
                    {supportedCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}
                  </select>
                </label>
                <label>Payment grace period (days)
                  <input type="number" name="graceDays" min="0" max="365" step="1" defaultValue={settings?.graceDays ?? 0} />
                </label>
                {settingsError && <p className="login-error" role="alert">{settingsError}</p>}
                <p className="form-copy">Changing the fee never alters existing invoices or recorded payments — they keep the amount they were charged. Subscriptions unpaid past the due date (plus the grace period) are flagged <strong>Overdue</strong> across the business overview so you can act. Suspend accounts manually for non-payment, and reactivate them once a payment is verified.</p>
                <div className="modal-actions"><button type="submit" className="primary-button" disabled={savingSettings}>{savingSettings ? 'Saving…' : 'Save settings'}</button></div>
              </form>
            </section>
          </>
        ) : openBusiness ? (
          <BusinessDetailsPage
            business={openBusiness}
            onBack={() => setSelectedBusinessId(null)}
            onChangeAccess={onChangeAccess}
            onSuspend={setBusinessToSuspend}
            onResetPassword={setBusinessToReset}
            onDelete={setBusinessToDelete}
            onRecordPayment={setBusinessToRecordPayment}
            onVerifyPayment={onVerifyPayment}
            onReviewApplication={() => { setSelectedBusinessId(null); setOwnerView('applications') }}
          />
        ) : (
          <>
            <section className="page-header">
              <div><p className="eyebrow">System owner workspace</p><h1>Customer accounts</h1><p className="section-description">Review every business account on the platform. Open a business with the ⋮ menu to view its details and manage access, passwords, billing, or permanent deletion.</p></div>
              <div className="header-status"><span className="status-dot" />Owner access</div>
            </section>
            <section className="stats-grid owner-stats">
              <article className="stat-card blue"><div className="stat-info"><p>Total businesses</p><h3>{businesses.length}</h3></div><span className="stat-delta">Registered</span></article>
              <article className="stat-card green"><div className="stat-info"><p>Active access</p><h3>{activeCount}</h3></div><span className="stat-delta">Can sign in</span></article>
              <article className="stat-card rose"><div className="stat-info"><p>Overdue</p><h3>{overdueCount}</h3></div><span className="stat-delta">Payment past due</span></article>
              <article className="stat-card amber"><div className="stat-info"><p>Suspended</p><h3>{suspendedCount}</h3></div><span className="stat-delta">Access disabled</span></article>
            </section>
            <section className="panel owner-business-panel">
              <div className="panel-header">
                <div><p className="eyebrow">Customer accounts</p><h3>Businesses on the platform</h3></div>
                <span className="owner-table-count">{filteredBusinesses.length} shown</span>
              </div>
              <div className="owner-toolbar">
                <input type="search" className="owner-search" placeholder="Search business, owner, email…" value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} aria-label="Search businesses" />
                <select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)} aria-label="Filter by account access">
                  <option value="all">All access</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
                <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} aria-label="Filter by payment status">
                  <option value="all">All payment statuses</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                  <option value="overdue">Overdue</option>
                  <option value="suspended">Suspended</option>
                  <option value="none">No subscription</option>
                </select>
              </div>
              <p className="section-description">Use the ⋮ menu next to a business to open its details and manage the account. Accounts awaiting your approval — or approved but without a live business account — appear at the top of this list as well.</p>
              <div className="table-scroll">
                <table className="owner-business-table">
                  <thead><tr><th>Business / owner</th><th>Registered</th><th>Approval</th><th>Plan</th><th>Payment</th><th>Access</th><th aria-label="Actions"></th></tr></thead>
                  <tbody>
                    {filteredBusinesses.map((business) => (
                      <tr key={business.id} className={business.paymentStatus === 'overdue' ? 'owner-row-overdue' : undefined}>
                        <td>
                          <div className="owner-business-identity">
                            <strong>{business.name}</strong>
                            <span>{business.ownerName || business.email}</span>
                            <small>{business.industry} · {business.userCount} user{business.userCount === 1 ? '' : 's'}</small>
                          </div>
                        </td>
                        <td>{business.registeredAt ? new Date(business.registeredAt).toLocaleDateString() : '—'}</td>
                        <td>{business.approvalStatus ? approvalStatusBadge({ status: business.approvalStatus }) : '—'}</td>
                        <td>
                          {business.fee ? (
                            <div className="owner-business-identity"><strong>{formatCurrency(business.fee, business.feeCurrency)}</strong><span>{business.planName || 'Subscription'} · monthly</span></div>
                          ) : (
                            <div className="owner-business-identity"><span>No plan</span></div>
                          )}
                        </td>
                        <td>
                          {paymentStatusBadge(business.paymentStatus)}
                          {business.pendingPayment && <small className="owner-period-end">Pending {formatCurrency(business.pendingPayment.amount, business.pendingPayment.currency)}</small>}
                          {business.lastPaymentAt && <small className="owner-period-end">Last payment {new Date(business.lastPaymentAt).toLocaleDateString()}</small>}
                          {business.dueDate && <small className="owner-period-end">Due {new Date(business.dueDate).toLocaleDateString()}</small>}
                          {business.nextPaymentDate && <small className="owner-period-end">Next payment {new Date(business.nextPaymentDate).toLocaleDateString()}</small>}
                          {business.outstandingBalance > 0 && <small className="owner-period-end">Outstanding {formatCurrency(business.outstandingBalance, business.feeCurrency)}</small>}
                        </td>
                        <td>
                          <span className={`status-badge ${business.status === 'active' || (business.isApplication && business.status === 'approved') ? 'ok' : business.status === 'suspended' ? 'danger' : 'warning'}`}>
                            {business.isApplication ? (business.status === 'approved' ? 'Approved' : 'Awaiting approval') : business.status === 'active' ? 'Active' : business.status === 'suspended' ? 'Suspended' : business.status}
                          </span>
                          {business.isApplication && business.status === 'approved' && <small className="owner-period-end">No business account yet</small>}
                          {business.status === 'suspended' && business.suspendedReason && <small className="owner-period-end">Reason: {business.suspendedReason}</small>}
                          {business.status === 'suspended' && business.suspendedAt && <small className="owner-period-end">Since {new Date(business.suspendedAt).toLocaleDateString()}</small>}
                        </td>
                        <td className="owner-kebab-cell">
                          <button
                            type="button"
                            className="owner-kebab"
                            aria-label={`Open details for ${business.name}`}
                            title="Open business details"
                            onClick={() => setSelectedBusinessId(business.id)}
                          >⋮</button>
                        </td>
                      </tr>
                    ))}
                    {filteredBusinesses.length === 0 && <tr><td colSpan="7" className="empty-table">{overviewBusinesses.length === 0 ? 'No businesses have registered yet.' : 'No businesses match the current search or filters.'}</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
      {businessToSuspend && (
        <SuspendBusinessDialog
          business={businessToSuspend}
          onCancel={() => setBusinessToSuspend(null)}
          onConfirm={async (reason) => {
            await onChangeAccess(businessToSuspend, 'suspended', reason)
            setBusinessToSuspend(null)
          }}
        />
      )}
      {businessToRecordPayment && (
        <RecordPaymentDialog
          business={businessToRecordPayment}
          onCancel={() => setBusinessToRecordPayment(null)}
          onConfirm={async (payment) => {
            await onRecordPayment(businessToRecordPayment, payment)
            setBusinessToRecordPayment(null)
          }}
        />
      )}
      {businessToDelete && (
        <DeleteBusinessDialog
          business={businessToDelete}
          onCancel={() => setBusinessToDelete(null)}
          onConfirm={async (password) => {
            await onDeleteBusiness(businessToDelete, password)
            setBusinessToDelete(null)
          }}
        />
      )}
      {businessToReset && (
        <ResetPasswordDialog
          eyebrow="Password recovery"
          title="Reset business admin password"
          description={<>
            Set a new password for <strong>{businessToReset.ownerName || businessToReset.name}</strong>.
            Give it to them through a secure channel; they can change it after signing in.
          </>}
          requireOwnerPassword
          onCancel={() => setBusinessToReset(null)}
          onConfirm={async ({ ownerPassword, password }) => {
            await onResetAdminPassword(businessToReset, { ownerPassword, password })
            setBusinessToReset(null)
          }}
        />
      )}
    </div>
  )
}

function AgentWorkspace({ agent, business, products, productsLoaded, productCategories, debtProducts, customers, cart, cartTotal, saleSubmitting, transactions, currencyCode, expenseDialogOpen, onOpenExpense, onCloseExpense, onAddExpense, debtActionBusy, onAddAgentDebt, onAddAgentCustomer, onChangePassword, onProfileImageUpdated, onNotice, onAddProduct, onChangeQuantity, onClearCart, onCompleteSale, onRefresh, onExit, theme, language, onThemeChange, onLanguageChange }) {
  const reduceMotion = useReducedMotion()
  const t = (text) => translate(text, language)
  const [customer, setCustomer] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [debitPickerOpen, setDebitPickerOpen] = useState(false)
  const [agentCustomerOpen, setAgentCustomerOpen] = useState(false)
  const [selectedDebtCustomer, setSelectedDebtCustomer] = useState(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const refreshInProgressRef = useRef(false)
  const normalizedProductQuery = productSearch.trim().replace(/\s+/g, ' ').toLowerCase()
  const visibleProducts = products.filter((product) => {
    const searchableProductText = [product.label, product.sku, product.barcode].filter(Boolean).join(' ').toLowerCase()
    const matchesSearch = !normalizedProductQuery || searchableProductText.includes(normalizedProductQuery)
    return matchesSearch && (!categoryFilter || product.categoryId === categoryFilter)
  })
  const cartItemCount = cart.reduce((count, item) => count + item.qty, 0)

  async function handleRefresh() {
    if (refreshInProgressRef.current) return
    refreshInProgressRef.current = true
    setRefreshing(true)
    try {
      const refreshed = await onRefresh()
      if (refreshed !== false) onNotice(t('Sales workspace refreshed.'))
    } catch (error) {
      onNotice(error.message)
    } finally {
      refreshInProgressRef.current = false
      setRefreshing(false)
    }
  }

  async function handleCompleteAgentSale() {
    const completed = await onCompleteSale(customer.trim() || 'Walk-in customer', paymentMethod)
    if (completed) {
      setCustomer('')
      setMobileCartOpen(false)
    }
  }

  useEffect(() => {
    if (!navigationOpen && !mobileCartOpen) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setNavigationOpen(false)
        setMobileCartOpen(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [navigationOpen, mobileCartOpen])

  return (
    <div className="agent-app">
    <header className="agent-topbar">
      <button
        type="button"
        className="agent-menu-toggle"
        aria-label={t(navigationOpen ? 'Close navigation' : 'Open navigation')}
        aria-expanded={navigationOpen}
        aria-controls="agent-navigation"
        onClick={() => setNavigationOpen((open) => !open)}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <div className="business-brand">
        {business?.logoUpdatedAt ? <img src={`/api/business/logo?v=${encodeURIComponent(business.logoUpdatedAt)}`} alt="" className="business-brand-logo" /> : <span className="business-brand-fallback" aria-hidden="true">▧</span>}
        <strong>{business?.name || agent.businessName}</strong>
      </div>
      <div className="agent-account">
        <UserAvatar user={agent} />
        <div><strong>{agent.name}</strong><small>{t('Sales agent')}</small></div>
      </div>
      <PreferenceControls theme={theme} language={language} onThemeChange={onThemeChange} onLanguageChange={onLanguageChange} />
      </header>
      {navigationOpen && (
        createPortal(<div className="agent-navigation-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setNavigationOpen(false)
        }}>
          <UnifiedSidebar id="agent-navigation" className="agent-navigation" open collapsed={sidebarCollapsed} onClose={() => setNavigationOpen(false)} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} closeLabel={t('Close navigation')} collapseLabel={t('Collapse navigation')} expandLabel={t('Expand navigation')} signOutLabel={t('Sign out')} onSignOut={() => { setNavigationOpen(false); onExit() }} brand={<>{business?.logoUpdatedAt ? <img src={`/api/business/logo?v=${encodeURIComponent(business.logoUpdatedAt)}`} alt="" className="business-brand-logo unified-business-logo" /> : <span className="unified-brand-mark">B</span>}<span className="unified-brand-copy"><strong title={business?.name || agent.businessName || 'My Business'}>{business?.name || agent.businessName || 'My Business'}</strong><small>Sales agent</small></span></>} profile={<div className="account-controls"><ProfileImageControl user={agent} language={language} onUpdated={onProfileImageUpdated} onNotice={onNotice} /><button type="button" className="ghost-button account-password-button" onClick={() => setChangePasswordOpen(true)}>{t('Change password')}</button></div>}>
            <div className="agent-navigation-heading">
              <strong>{t('Menu')}</strong>
              <button type="button" className="modal-close" aria-label={t('Close navigation')} onClick={() => setNavigationOpen(false)}>×</button>
            </div>
            <button type="button" className="agent-navigation-item" onClick={() => {
              setNavigationOpen(false)
              document.getElementById('agent-sale')?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' })
            }}>
              <span aria-hidden="true">＋</span>{t('Add Sale')}
            </button>
            <button type="button" className="agent-navigation-item" onClick={() => {
              setNavigationOpen(false)
              setDebitPickerOpen(true)
            }}>
              <span aria-hidden="true">▤</span>{t('Add Debit')}
            </button>
            <button type="button" className="agent-navigation-item" onClick={() => {
              setNavigationOpen(false)
              setAccountOpen(true)
            }}>
              <span aria-hidden="true">◉</span>{t('Account')}
            </button>
            <button type="button" className="agent-navigation-item" onClick={() => {
              setNavigationOpen(false)
              onOpenExpense()
            }}>
              <span aria-hidden="true">＋</span>{t('Add Expense')}
            </button>
            <button type="button" className="agent-navigation-item agent-navigation-signout" onClick={() => {
              setNavigationOpen(false)
              onExit()
            }}>
              <span aria-hidden="true">↪</span>{t('Sign out')}
            </button>
          </UnifiedSidebar>
        </div>, document.body)
      )}
      <main className="agent-content">
        <section className="page-header agent-page-heading">
          <div><p className="eyebrow">{t('Sales workspace')}</p><h1>{t('Welcome,')} {agent.name.split(' ')[0]}</h1><p className="section-description">{t('Create a sale, take payment, and review your completed transactions.')}</p></div>
          <div className="header-status"><span className="status-dot" />{t('Agent account active')}</div><button type="button" className="ghost-button agent-refresh-button" onClick={handleRefresh} disabled={refreshing} aria-label={t(refreshing ? 'Refreshing…' : 'Refresh sales workspace')} title={t('Refresh sales workspace')}><RefreshCw size={16} className={refreshing ? 'agent-refresh-spinning' : ''} />{refreshing ? t('Refreshing…') : t('Refresh')}</button>
        </section>
        <div className="agent-stat-grid">
          <article className="stat-card blue"><div className="stat-info"><p>{t('Sales completed')}</p><h3>{transactions.length}</h3></div><span className="stat-delta">{t('Your transactions')}</span></article>
          <article className="stat-card indigo"><div className="stat-info"><p>{t('Sales today')}</p><h3>{formatCurrency(transactions.reduce((total, sale) => total + sale.amount, 0), currencyCode)}</h3></div><span className="stat-delta">{currencyCode}</span></article>
        </div>
        <section className="sales-pos-layout agent-sales-pos-layout" id="agent-sale">
          <div className="panel pos-catalog-panel">
            <div className="pos-catalog-heading">
              <div><p className="eyebrow">{t('Available products')}</p><h2>{t('Product Catalog')}</h2><p>{visibleProducts.length} {t('products available')}</p></div>
              <button type="button" className="ghost-button pos-mobile-cart-toggle" onClick={() => setMobileCartOpen(true)} aria-expanded={mobileCartOpen}><ShoppingCart size={16} />{t('Shopping Cart')} <span className="pos-cart-badge">{cartItemCount}</span></button>
            </div>
            <div className="pos-product-search pos-catalog-search" role="search">
              <label htmlFor="agent-product-search">{t('Search products')}</label>
              <div className="agent-search-input-wrap"><Search size={17} aria-hidden="true" /><input id="agent-product-search" type="search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder={t('Search products by name or SKU...')} />{productSearch && <button type="button" aria-label={t('Clear search')} onClick={() => setProductSearch('')}><X size={16} /></button>}</div>
            </div>
            <div className="pos-category-filters" role="group" aria-label={t('Filter products by category')}>
              <button type="button" className={!categoryFilter ? 'pos-category-filter active' : 'pos-category-filter'} aria-pressed={!categoryFilter} onClick={() => setCategoryFilter('')}>{t('All products')}</button>
              {productCategories.map((category) => <button type="button" key={category.id} className={categoryFilter === category.id ? 'pos-category-filter active' : 'pos-category-filter'} aria-pressed={categoryFilter === category.id} onClick={() => setCategoryFilter(category.id)}>{category.name}</button>)}
            </div>
            <div className="pos-product-grid">
              {visibleProducts.map((product) => <article className="pos-product-card" key={product.id}>
                <div className="pos-product-art"><ProductImageView product={product} className="product-art-image" /></div>
                <div className="pos-product-card-copy"><strong title={product.label}>{product.label}</strong><small>{product.sku || t('No SKU')}</small></div>
                <div className="pos-product-card-meta"><strong>{formatCurrency(product.price, currencyCode)}</strong><span className={product.stock <= product.reorderLevel ? 'pos-stock low' : 'pos-stock'}>{product.stock > 0 ? product.stock + ' ' + t('in stock') : t('Out of stock')}</span></div>
                <button type="button" className="pos-add-button" onClick={() => onAddProduct(product)} disabled={product.stock <= 0 || saleSubmitting}>{product.stock > 0 ? t('Add to cart') : t('Unavailable')}</button>
              </article>)}
              {!visibleProducts.length && <p className="pos-search-empty">{!productsLoaded ? t('Loading products...') : products.length ? t('No matching products found.') : t('No products have been added yet.')}</p>}
            </div>
          </div>
          {mobileCartOpen && <button type="button" className="pos-cart-backdrop" aria-label={t('Close cart')} onClick={() => setMobileCartOpen(false)} />}
          <aside className={mobileCartOpen ? 'panel pos-cart-panel mobile-cart-open' : 'panel pos-cart-panel'} role={mobileCartOpen ? 'dialog' : undefined} aria-modal={mobileCartOpen ? 'true' : undefined} aria-label={t('Shopping Cart')}>
            <div className="pos-cart-heading"><div><p className="eyebrow">{t('Checkout')}</p><h2>{t('Shopping Cart')}</h2></div><span className="pos-cart-badge">{cartItemCount}</span><button type="button" className="pos-cart-close" onClick={() => setMobileCartOpen(false)} aria-label={t('Close cart')}>&times;</button></div>
            <button type="button" className="pos-clear-cart" onClick={onClearCart} disabled={!cart.length || saleSubmitting}>{t('Clear cart')}</button>
            <div className="pos-cart-items" aria-live="polite">
              {cart.length === 0 ? <div className="pos-empty-cart"><span><Package size={28} /></span><strong>{t('Your cart is empty')}</strong><p>{t('Select a product to start a sale.')}</p></div> : cart.map((item) => <article className="pos-cart-item" key={item.id}>
                <div className="pos-cart-item-top"><ProductImageView product={item} className="pos-cart-product-image" /><div><strong>{item.name}</strong><small>{formatCurrency(item.price, currencyCode)} {t('each')}</small></div><button type="button" className="pos-remove-item" onClick={() => onChangeQuantity(item.id, -item.qty)} aria-label={t('Remove item')} disabled={saleSubmitting}>&times;</button></div>
                <div className="pos-cart-item-bottom"><div className="quantity-controls"><button type="button" aria-label={t('Decrease quantity')} onClick={() => onChangeQuantity(item.id, -1)} disabled={saleSubmitting}>?</button><span>{item.qty}</span><button type="button" aria-label={t('Increase quantity')} onClick={() => onChangeQuantity(item.id, 1)} disabled={saleSubmitting || item.qty >= item.stock}>+</button></div><strong>{formatCurrency(item.price * item.qty, currencyCode)}</strong></div>
              </article>)}
            </div>
            <div className="pos-cart-summary">
              <div><span>{t('Subtotal')}</span><strong>{formatCurrency(cartTotal, currencyCode)}</strong></div>
              <div className="pos-total-row"><span>{t('Total due')}</span><strong>{formatCurrency(cartTotal, currencyCode)}</strong></div>
              <label>{t('Customer name (optional)')}<input value={customer} onChange={(event) => setCustomer(event.target.value)} maxLength="150" placeholder={t('Walk-in customer')} /></label>
              <label>{t('Payment method')}<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">{t('Cash')}</option><option value="mobile_money">{t('Mobile money')}</option><option value="card">{t('Card')}</option><option value="bank_transfer">{t('Bank transfer')}</option><option value="other">{t('Other')}</option></select></label>
              <button type="button" className="primary-button large pos-checkout-button" onClick={handleCompleteAgentSale} disabled={!cart.length || cart.some((item) => item.stock < 1 || item.qty > item.stock) || saleSubmitting}>{saleSubmitting ? t('Processing sale...') : t('COMPLETE SALE')}</button>
            </div>
          </aside>
        </section>
        <section className="panel recent-panel agent-history">
          <div className="panel-header"><div><p className="eyebrow">{t('Your activity')}</p><h3>{t('Completed sales')}</h3></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Date &amp; time</th><th>Receipt</th><th>Customer</th><th>Items</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {transactions.map((sale) => <tr key={sale.id}><td>{sale.businessDateTime || '—'}</td><td>{sale.id}</td><td>{sale.customer}</td><td>{sale.item}</td><td>{formatCurrency(sale.amount, currencyCode)}</td><td><span className="status-badge ok">{sale.status}</span></td></tr>)}
              {transactions.length === 0 && <tr><td colSpan="6" className="empty-table">{t('Your completed sales will appear here.')}</td></tr>}
            </tbody>
          </table></div>
        </section>
      </main>
      {expenseDialogOpen && (
        createPortal(<Modal
          type="expense"
          currencyCode={currencyCode}
          onClose={onCloseExpense}
          onAddExpense={onAddExpense}
        />, document.body)
      )}
      {debitPickerOpen && (
        createPortal(<AgentCustomerPicker
          customers={customers}
          currencyCode={currencyCode}
          language={language}
          onCancel={() => setDebitPickerOpen(false)}
          onAddCustomer={() => {
            setDebitPickerOpen(false)
            setAgentCustomerOpen(true)
          }}
          onSelect={(selectedCustomer) => {
            setDebitPickerOpen(false)
            setSelectedDebtCustomer(selectedCustomer)
          }}
        />, document.body)
      )}
      {agentCustomerOpen && (
        createPortal(<DebtCustomerDialog
          language={language}
          busy={debtActionBusy}
          onCancel={() => {
            setAgentCustomerOpen(false)
            setDebitPickerOpen(true)
          }}
          onSave={async (payload) => {
            const createdCustomer = await onAddAgentCustomer(payload)
            if (createdCustomer) {
              setAgentCustomerOpen(false)
              setSelectedDebtCustomer(createdCustomer)
            }
          }}
        />, document.body)
      )}
      {selectedDebtCustomer && (
        createPortal(<AddDebtDialog
          customer={selectedDebtCustomer}
          products={debtProducts}
          currencyCode={currencyCode}
          language={language}
          busy={debtActionBusy}
          onCancel={() => setSelectedDebtCustomer(null)}
          onSave={async (payload) => {
            const saved = await onAddAgentDebt(selectedDebtCustomer.id, payload)
            if (saved) setSelectedDebtCustomer(null)
          }}
        />, document.body)
      )}
      {accountOpen && (
        createPortal(<AgentAccountDialog
          agent={agent}
          business={business}
          language={language}
          onCancel={() => setAccountOpen(false)}
          onChangePassword={() => {
            setAccountOpen(false)
            setChangePasswordOpen(true)
          }}
        />, document.body)
      )}
      {changePasswordOpen && (
        createPortal(<ChangePasswordDialog
          language={language}
          onCancel={() => setChangePasswordOpen(false)}
          onSave={onChangePassword}
        />, document.body)
      )}
    </div>
  )
}

function AgentCustomerPicker({ customers, currencyCode, language, onCancel, onAddCustomer, onSelect }) {
  const t = (text) => translate(text, language)
  const [search, setSearch] = useState('')
  const matches = customers.filter((customer) =>
    `${customer.name} ${customer.phone || ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section className="modal-card agent-customer-picker" role="dialog" aria-modal="true" aria-labelledby="agent-customer-picker-title">
        <div className="modal-heading">
          <div><p className="eyebrow">{t('Credit sale')}</p><h2 id="agent-customer-picker-title">{t('Choose a customer for the debit')}</h2></div>
          <button type="button" className="modal-close" aria-label={t('Cancel')} onClick={onCancel}>×</button>
        </div>
        <label className="agent-customer-field">{t('Search customers')}
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
        </label>
        <div className="agent-customer-results">
          {matches.map((customer) => (
            <button type="button" className="agent-customer-option" key={customer.id} onClick={() => onSelect(customer)}>
              <span><strong>{customer.name}</strong><small>{customer.phone || t('No phone number')}</small></span>
              <span>{formatCurrency(customer.balance || 0, currencyCode)}</span>
            </button>
          ))}
          {matches.length === 0 && <p className="empty-cart">{customers.length ? t('No customers match your search.') : t('No customers are registered yet. Ask your business administrator to add one.')}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>{t('Cancel')}</button>
          <button type="button" className="primary-button" onClick={onAddCustomer}>{t('Add Customer')}</button>
        </div>
      </section>
    </div>
  )
}

function AgentAccountDialog({ agent, business, language, onCancel, onChangePassword }) {
  const t = (text) => translate(text, language)
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="agent-account-title">
        <div className="modal-heading">
          <div><p className="eyebrow">{t('Account')}</p><h2 id="agent-account-title">{t('Account details')}</h2></div>
          <button type="button" className="modal-close" aria-label={t('Cancel')} onClick={onCancel}>×</button>
        </div>
        <dl className="agent-account-details">
          <div><dt>{t('Full name')}</dt><dd>{agent.name}</dd></div>
          <div><dt>{t('Email address')}</dt><dd>{agent.email || '—'}</dd></div>
          <div><dt>{t('Phone number')}</dt><dd>{agent.phone || '—'}</dd></div>
          <div><dt>{t('Business')}</dt><dd>{business?.name || agent.businessName || '—'}</dd></div>
          <div><dt>{t('Role')}</dt><dd>{t('Sales agent')}</dd></div>
        </dl>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>{t('Close')}</button>
          <button type="button" className="primary-button" onClick={onChangePassword}>{t('Change password')}</button>
        </div>
      </section>
    </div>
  )
}

function ChangePasswordDialog({ language, onCancel, onSave }) {
  const t = (text) => translate(text, language)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      await onSave({
        currentPassword: form.get('currentPassword'),
        newPassword: form.get('newPassword'),
        confirmPassword: form.get('confirmPassword'),
      })
      onCancel()
    } catch (requestError) {
      setError(t(requestError.message))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="agent-change-password-title">
        <div className="modal-heading">
          <div><p className="eyebrow">{t('Account security')}</p><h2 id="agent-change-password-title">{t('Change password')}</h2></div>
          <button type="button" className="modal-close" aria-label={t('Cancel')} onClick={onCancel} disabled={busy}>×</button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          <label>{t('Current password')}<input type="password" name="currentPassword" autoComplete="current-password" required /></label>
          <label>{t('New password')}<input type="password" name="newPassword" autoComplete="new-password" minLength="8" maxLength="128" required /></label>
          <label>{t('Confirm new password')}<input type="password" name="confirmPassword" autoComplete="new-password" minLength="8" maxLength="128" required /></label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>{t('Cancel')}</button>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? t('Saving…') : t('Change password')}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function SuspendBusinessDialog({ business, onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(reason.trim())
    } catch (requestError) {
      setError(requestError.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel()
    }}>
      <section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="suspend-business-title">
        <div className="modal-heading">
          <div><p className="eyebrow">Access control</p><h2 id="suspend-business-title">Suspend {business.name}?</h2></div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onCancel} disabled={submitting}>×</button>
        </div>
        <p className="form-copy">
          Suspending immediately signs out every user of <strong>{business.name}</strong> and blocks all sign-ins until you reactivate the account. This is how you disable access for unpaid subscriptions.
        </p>
        <form className="modal-form" onSubmit={submit}>
          <label>Reason for suspension
            <textarea name="reason" placeholder="For example: missed subscription payment" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} required />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onCancel} disabled={submitting}>Cancel</button>
            <button type="submit" className="danger-button" disabled={submitting || !reason.trim()}>
              {submitting ? 'Suspending…' : 'Suspend account'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function RecordPaymentDialog({ business, onCancel, onConfirm }) {
  const defaultAmount = business.outstandingBalance > 0 ? business.outstandingBalance : business.fee
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '')
  const [currency, setCurrency] = useState(business.feeCurrency || 'TZS')
  const [method, setMethod] = useState('mobile_money')
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onConfirm({ amount: Number(amount), currency, method, reference: reference.trim() || null })
    } catch (requestError) {
      setError(requestError.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel()
    }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="record-payment-title">
        <div className="modal-heading">
          <div><p className="eyebrow">Subscription billing</p><h2 id="record-payment-title">Record payment for {business.name}</h2></div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onCancel} disabled={submitting}>×</button>
        </div>
        <p className="form-copy">
          The payment is recorded as <strong>pending</strong> until you verify it. Verifying applies the credit, marks the invoice paid, and extends the subscription period.
        </p>
        <form className="modal-form" onSubmit={submit}>
          <label>Amount
            <input type="number" name="amount" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </label>
          <label>Currency
            <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {supportedCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label>Payment method
            <select value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="mobile_money">Mobile money</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Reference (optional)
            <input type="text" name="reference" placeholder="Transaction ID" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={100} />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onCancel} disabled={submitting}>Cancel</button>
            <button type="submit" className="danger-button" disabled={submitting || !Number(amount)}>
              {submitting ? 'Recording…' : 'Record payment'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function DeleteBusinessDialog({ business, onCancel, onConfirm }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(password)
    } catch (requestError) {
      setError(requestError.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel()
    }}>
      <section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-business-title">
        <div className="modal-heading">
          <div><p className="eyebrow">Irreversible action</p><h2 id="delete-business-title">Delete customer account?</h2></div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onCancel} disabled={submitting}>×</button>
        </div>
        <p className="form-copy">
          Permanently delete <strong>{business.name}</strong> and its users, products, sales, expenses, subscriptions, payments, and business history. This cannot be undone.
        </p>
        <form className="modal-form" onSubmit={submit}>
          <PasswordField
            label="System owner password"
            className="password-field-label"
            visuallyHiddenLabel={false}
            name="password"
            placeholder="Enter your owner password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="login-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onCancel} disabled={submitting}>Cancel</button>
            <button type="submit" className="danger-button" disabled={submitting || !password}>
              {submitting ? 'Deleting…' : 'Confirm permanent deletion'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function DeleteAgentDialog({ agent, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-agent-title">
        <div className="modal-heading"><div><p className="eyebrow">Remove access</p><h2 id="delete-agent-title">Delete sales agent?</h2></div><button type="button" className="modal-close" aria-label="Close dialog" onClick={onCancel}>×</button></div>
        <p className="form-copy">This will disable sign-in for <strong>{agent.name}</strong>. Existing sales history will be retained.</p>
        <div className="modal-actions"><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button><button type="button" className="danger-button" onClick={onConfirm}>Delete agent</button></div>
      </section>
    </div>
  )
}

function ResetPasswordDialog({ eyebrow = 'Password recovery', title, description, requireOwnerPassword = false, onCancel, onConfirm }) {
  const [ownerPassword, setOwnerPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onConfirm({ ownerPassword, password })
    } catch (requestError) {
      setError(requestError.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel()
    }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
        <div className="modal-heading">
          <div><p className="eyebrow">{eyebrow}</p><h2 id="reset-password-title">{title}</h2></div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onCancel} disabled={submitting}>×</button>
        </div>
        {description && <p className="form-copy">{description}</p>}
        <form className="modal-form" onSubmit={submit}>
          {requireOwnerPassword && (
            <PasswordField
              label="System owner password"
              className="password-field-label"
              visuallyHiddenLabel={false}
              name="ownerPassword"
              placeholder="Enter your owner password"
              autoComplete="current-password"
              value={ownerPassword}
              onChange={(event) => setOwnerPassword(event.target.value)}
              required
            />
          )}
          <PasswordField
            label="New password"
            className="password-field-label"
            visuallyHiddenLabel={false}
            name="password"
            placeholder="New password"
            minLength="8"
            maxLength="128"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus={!requireOwnerPassword}
            required
          />
          <PasswordField
            label="Confirm new password"
            className="password-field-label"
            visuallyHiddenLabel={false}
            name="confirmPassword"
            placeholder="Enter the new password again"
            minLength="8"
            maxLength="128"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
          <p className="form-copy">Share the new password with the user through a secure channel. Their existing sessions are signed out immediately.</p>
          {error && <p className="login-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onCancel} disabled={submitting}>Cancel</button>
            <button type="submit" className="primary-button" disabled={submitting || !password || (requireOwnerPassword && !ownerPassword)}>
              {submitting ? 'Resetting…' : 'Reset password'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function productImageSrc(product) {
  if (!product?.id) return ''
  return '/api/products/' + encodeURIComponent(product.id) + '/image' + (product.imageUpdatedAt ? '?v=' + encodeURIComponent(product.imageUpdatedAt) : '')
}

function ProductImageView({ product, className = '' }) {
  const src = productImageSrc(product)
  const [failedSrc, setFailedSrc] = useState('')
  const [loadedSrc, setLoadedSrc] = useState('')
  const isLoading = Boolean(src) && failedSrc !== src && loadedSrc !== src
  if (!src || failedSrc === src) {
    return <span className={className + ' product-image-placeholder'} aria-label="No product image"><Package size={20} /></span>
  }
  return (
    <span className={className + ' product-image-frame'}>
      {isLoading && <span className="product-image-loading" aria-hidden="true" />}
      <img
        className={className}
        src={src}
        alt={product?.name || product?.label ? (product.name || product.label) + ' product' : 'Product'}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrc(src)}
        style={{ opacity: loadedSrc === src ? 1 : 0 }}
      />
    </span>
  )
}

function ProductImageUploader({ currentImageUrl = '', productName = 'Product', maxBytes, disabled = false }) {
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [remove, setRemove] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : '', [file])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  function choose(next) {
    if (!next) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(next.type)) {
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      setError('Choose a PNG, JPG, or WebP image.')
      return
    }
    if (next.size > maxBytes) {
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      setError('This image exceeds the ' + Math.round(maxBytes / 1024 / 1024) + ' MB size limit.')
      return
    }
    const transfer = new DataTransfer()
    transfer.items.add(next)
    if (inputRef.current) inputRef.current.files = transfer.files
    setError(''); setRemove(false); setFile(next)
  }
  const hasCurrent = Boolean(currentImageUrl)
  return <div className={'product-image-uploader' + (dragging ? ' is-dragging' : '')} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0]) }}>
    <input ref={inputRef} hidden type="file" name="productImage" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={(event) => choose(event.target.files?.[0])} />
    <div className="product-image-preview">{previewUrl ? <img src={previewUrl} alt={productName + ' preview'} /> : hasCurrent && !remove ? <img src={currentImageUrl} alt={productName + ' current image'} /> : <Package size={28} />}</div>
    <div className="product-image-upload-copy"><strong>{file ? file.name : hasCurrent && !remove ? 'Current product image' : 'Product image (optional)'}</strong><span>PNG, JPG, or WebP ? up to {Math.round(maxBytes / 1024 / 1024)} MB</span>
      <div className="product-image-upload-actions"><button type="button" className="text-action" disabled={disabled} onClick={() => { if (inputRef.current) inputRef.current.value = ''; setFile(null); inputRef.current?.click() }}>{file || (hasCurrent && !remove) ? 'Choose another image' : 'Choose image'}</button>{file && <button type="button" className="text-action" disabled={disabled} onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = '' }}>Clear selection</button>}{hasCurrent && <button type="button" className="text-action danger-action" disabled={disabled} onClick={() => { setRemove(!remove); setFile(null); if (inputRef.current) inputRef.current.value = ''; setError('') }}>{remove ? 'Undo remove' : 'Remove image'}</button>}</div>
      {remove && <span className="image-remove-note">Image will be removed when you save.</span>}
      {error && <span role="alert" className="image-upload-error">{error}</span>}
    </div>
    <input type="hidden" name="productImageError" value={error} />
    <input type="hidden" name="removeProductImage" value={remove ? 'true' : 'false'} />
  </div>
}

function Modal({ type, onClose, onAddProduct, onAddAgent, onAddExpense, onRestockProduct, restockProduct, product, maxProductImageBytes = 5 * 1024 * 1024, productImageBusy = false, onSaveProductImage, currencyCode = 'TZS' }) {
  const isProduct = type === 'product'
  const isSalesAgent = type === 'sales-agent'
  const isExpense = type === 'expense'
  const title = {
    product: 'Add a product',
    restock: 'Restock product',
    'sales-agent': 'Register a sales agent',
    expense: 'Record an expense',
    forgot: 'Reset your password',
  }[type]

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div><p className="eyebrow">Business Management Portal</p><h2 id="modal-title">{title}</h2></div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>
        {type === 'product-image' ? (
          <form className="modal-form" onSubmit={onSaveProductImage}>
            <p className="form-copy">Update the image shown for {product?.name}. Product images are visible to your business users.</p>
            <ProductImageUploader currentImageUrl={productImageSrc(product)} productName={product?.name} maxBytes={maxProductImageBytes} disabled={productImageBusy} />
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose} disabled={productImageBusy}>Cancel</button><button type="submit" className="primary-button" disabled={productImageBusy}>{productImageBusy ? 'Saving?' : 'Save image'}</button></div>
          </form>
        ) : type === 'restock' ? (
          <form className="modal-form" onSubmit={onRestockProduct}>
            <div className="restock-product-summary">
              <strong>{restockProduct?.name}</strong>
              <span>Current stock: {restockProduct?.stock}</span>
            </div>
            <label>Quantity to add<input name="quantity" type="number" min="1" step="1" required autoFocus /></label>
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Update stock</button></div>
          </form>
        ) : isSalesAgent ? (
          <form className="modal-form" onSubmit={onAddAgent}>
            <label>Full name<input name="name" autoFocus required /></label>
            <label>Work email<input name="email" type="email" required /></label>
            <label>Phone number<input name="phone" type="tel" required /></label>
            <PasswordField label="Temporary password" className="password-field-label" visuallyHiddenLabel={false} name="password" minLength="8" autoComplete="new-password" required />
            <p className="form-copy">Share the temporary password securely with the agent. Their account role is detected automatically at sign-in.</p>
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Register agent</button></div>
          </form>
        ) : isProduct ? (
          <form className="modal-form" onSubmit={onAddProduct}>
            <label>Product name<input name="name" required autoFocus /></label>
            <label>SKU (optional)<input name="sku" maxLength="100" placeholder="Leave blank to generate automatically" /></label>
            <div className="form-columns">
              <label>Buying price ({currencyCode})<input name="buyingPrice" type="number" min="0" step="0.01" required /></label>
              <label>Selling price ({currencyCode})<input name="sellingPrice" type="number" min="0.01" step="0.01" required /></label>
            </div>
            <div className="form-columns">
              <label>Stock quantity<input name="stock" type="number" min="0" step="1" required /></label>
              <p className="profit-hint">Gross profit per item is selling price minus buying price.</p>
            </div>
            <ProductImageUploader maxBytes={maxProductImageBytes} disabled={productImageBusy} />
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose} disabled={productImageBusy}>Cancel</button><button type="submit" className="primary-button" disabled={productImageBusy}>{productImageBusy ? 'Saving?' : 'Save product'}</button></div>
          </form>
        ) : isExpense ? (
          <form className="modal-form" onSubmit={onAddExpense}>
            <label>Category<input name="category" required autoFocus /></label>
            <label>Description<input name="description" required /></label>
            <label>Amount ({currencyCode})<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Date<input name="expenseDate" type="date" defaultValue={todayDate} required /></label>
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Save expense</button></div>
          </form>
        ) : (
          <div className="modal-form">
            <p className="form-copy">Contact the system admin for password reset.</p>
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Close</button></div>
          </div>
        )}
      </section>
    </div>
  )
}

export default App
