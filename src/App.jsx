import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const navigation = [
  { title: 'Dashboard', items: ['Overview', 'Performance', 'Reports'] },
  { title: 'Products', items: ['All Products', 'Add Product', 'Categories'] },
  { title: 'Inventory', items: ['Stock', 'Stock Adjustments', 'Low Stock'] },
  { title: 'Sales', items: ['New Sale / POS', 'Sales History', 'Receipts'] },
  { title: 'Expenses', items: ['Expenses', 'Add Expense'] },
  { title: 'Reports', items: ['Daily Sales', 'Weekly Sales', 'Monthly Sales', 'Profit', 'Expenses'] },
  { title: 'Users', items: ['Sales Agents', 'User Management'] },
  { title: 'Subscription', items: ['Current Plan', 'Subscription Status', 'Payments'] },
  { title: 'Settings', items: ['Business Profile', 'System Settings'] },
]

const navigationViews = {
  Overview: 'overview',
  Performance: 'performance',
  Reports: 'transactions',
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
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
  )
}

const metricCards = [
  { label: "Today's Sales", key: 'todaySales', tone: 'blue', detail: 'Today' },
  { label: 'Expenses', key: 'todayExpenses', tone: 'amber', detail: 'Today' },
  { label: 'Low Stock', key: 'lowStock', tone: 'rose', detail: 'At reorder level' },
]

const supportedCurrencies = ['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP']

const emptyDashboard = {
  metrics: { todaySales: 0, todayExpenses: 0, revenue: 0, profit: 0, expenses: 0, productsSold: 0, lowStock: 0, productCount: 0 },
  chart: [],
  subscription: null,
  currency: 'TZS',
}

const now = new Date()
const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

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

function productForPos(product) {
  return {
    id: product.id,
    label: product.name,
    price: product.sellingPrice,
    buyingPrice: product.buyingPrice,
    stock: product.stock,
    tone: 'blue',
  }
}

function PerformanceGraph({ chart, currencyCode }) {
  const width = 960
  const height = 330
  const padding = { top: 24, right: 24, bottom: 48, left: 88 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const values = chart.flatMap((point) => [point.revenue, point.expenses, point.netProfit])
  const minimum = Math.min(0, ...values)
  const maximum = Math.max(1, ...values)
  const valueRange = maximum - minimum || 1
  const x = (index) => padding.left + (chart.length < 2 ? plotWidth / 2 : (index / (chart.length - 1)) * plotWidth)
  const y = (value) => padding.top + ((maximum - value) / valueRange) * plotHeight
  const series = [
    { key: 'revenue', label: 'Revenue', color: '#2563eb' },
    { key: 'expenses', label: 'Expenses', color: '#f59e0b' },
    { key: 'netProfit', label: 'Net Profit', color: '#16a34a' },
  ]
  const labelIndexes = [...new Set([0, Math.floor((chart.length - 1) / 4), Math.floor((chart.length - 1) / 2), Math.floor(((chart.length - 1) * 3) / 4), chart.length - 1])]
    .filter((index) => index >= 0)

  return (
    <div className="performance-chart">
      <div className="performance-legend" aria-label="Graph series">
        {series.map((item) => <span key={item.key}><i style={{ backgroundColor: item.color }} />{item.label}</span>)}
      </div>
      <div className="performance-plot">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Business revenue, expenses, and net profit over time">
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
            const points = chart.map((point, index) => `${x(index)},${y(point[item.key])}`).join(' ')
            return (
              <g key={item.key}>
                {chart.length > 1 && <polyline points={points} fill="none" stroke={item.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
                {chart.map((point, index) => (
                  <circle key={point.date} cx={x(index)} cy={y(point[item.key])} r="4" fill={item.color}>
                    <title>{`${point.date}: ${item.label} ${formatCurrency(point[item.key], currencyCode)}`}</title>
                  </circle>
                ))}
              </g>
            )
          })}
          {labelIndexes.map((index) => (
            <text key={chart[index]?.date} x={x(index)} y={height - 14} className="chart-axis-label" textAnchor="middle">
              {chart[index]?.label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}

function App() {
  const [sessionUser, setSessionUser] = useState(null)
  const [authMode, setAuthMode] = useState('login')
  const [loginError, setLoginError] = useState('')
  const [setupRequired, setSetupRequired] = useState(false)
  const [platformOwnerSetupAvailable, setPlatformOwnerSetupAvailable] = useState(false)
  const [platformBusinesses, setPlatformBusinesses] = useState([])
  const [googleClientId, setGoogleClientId] = useState(null)
  const [googleCredential, setGoogleCredential] = useState('')
  const [registrationProfile, setRegistrationProfile] = useState({ ownerName: '', email: '' })
  const googleButtonRef = useRef(null)
  const [selectedNav, setSelectedNav] = useState('Overview')
  const [expandedNavGroup, setExpandedNavGroup] = useState('Dashboard')
  const [modal, setModal] = useState('')
  const [notice, setNotice] = useState('')
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
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
  const [chartRange, setChartRange] = useState('Today')
  const [chartDate, setChartDate] = useState(todayDate)
  const [salesDate, setSalesDate] = useState(todayDate)
  const salesDateRef = useRef(todayDate)
  const [showAllSales, setShowAllSales] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [agents, setAgents] = useState([])
  const [agentToDelete, setAgentToDelete] = useState(null)
  const [productToRestock, setProductToRestock] = useState(null)
  const posProducts = products.map(productForPos)
  const selectedView = navigationViews[selectedNav] || 'overview'

  const cartTotal = useMemo(
    () => cart.reduce((total, item) => total + item.price * item.qty, 0),
    [cart],
  )
  const refreshWorkspace = useCallback(async (user, rangeName = 'Today', date = todayDate) => {
    if (!user) return
    if (user.role === 'platform_admin') {
      const result = await apiRequest('/platform/businesses')
      setPlatformBusinesses(result.businesses)
      return
    }
    const salesPath = user.role === 'business_admin' && salesDateRef.current
      ? `/sales?date=${encodeURIComponent(salesDateRef.current)}`
      : '/sales'
    const [productResult, saleResult] = await Promise.all([
      apiRequest('/products'),
      apiRequest(salesPath),
    ])
    setProducts(productResult.products)
    setTransactions(saleResult.sales)
    if (user.role === 'business_admin') {
      const range = { Today: 'today', 'This Week': 'week', 'This Month': 'month', '3 Months': '3months', '1 Year': 'year', day: 'day' }[rangeName]
      const [dashboardResult, staffResult, expenseResult, businessResult] = await Promise.all([
        apiRequest(`/dashboard?range=${range}&date=${encodeURIComponent(date)}`),
        apiRequest('/staff'),
        apiRequest('/expenses'),
        apiRequest('/business'),
      ])
      setDashboard(dashboardResult)
      setAgents(staffResult.agents)
      setExpenses(expenseResult.expenses)
      setBusiness(businessResult.business)
      setDisplayCurrency(businessResult.business.currency)
    }
  }, [])

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
    document.title = 'KAJUNA BMS | Business Management System'
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
        setSessionUser(user)
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
      .then(({ googleClientId: clientId }) => setGoogleClientId(clientId))
      .catch((error) => setLoginError(`Could not load sign-in options: ${error.message}`))
  }, [])

  useEffect(() => {
    if (sessionUser?.role !== 'business_admin') return undefined
    const syncBusinessActivity = () => {
      if (document.visibilityState === 'visible') {
        const range = { Today: 'today', 'This Week': 'week', 'This Month': 'month', '3 Months': '3months', '1 Year': 'year', day: 'day' }[chartRange]
        Promise.all([
          apiRequest(`/dashboard?range=${range}&date=${encodeURIComponent(chartDate)}`),
          apiRequest(salesDateRef.current ? `/sales?date=${encodeURIComponent(salesDateRef.current)}` : '/sales'),
        ])
          .then(([dashboardResult, salesResult]) => {
            setDashboard(dashboardResult)
            setTransactions(salesResult.sales)
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
              setSessionUser(user)
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

  async function loadDashboardChart(range, date) {
    const apiRange = { Today: 'today', 'This Week': 'week', 'This Month': 'month', '3 Months': '3months', '1 Year': 'year', day: 'day' }[range]
    setChartRange(range)
    setChartDate(date)
    try {
      const result = await apiRequest(`/dashboard?range=${apiRange}&date=${encodeURIComponent(date)}`)
      setDashboard(result)
    } catch (error) {
      setNotice(error.message)
    }
  }

  function openSection(item) {
    setSelectedNav(item)
    const group = navigation.find((section) => section.items.includes(item))
    if (group) setExpandedNavGroup(group.title)
    if (item === 'Add Product') setModal('product')
    if (item === 'Add Expense') setModal('expense')
  }

  function addToCart(product) {
    const existing = cart.find((item) => item.id === product.id)
    if ((!existing && product.stock < 1) || (existing && existing.qty >= product.stock)) {
      setNotice(`${product.label} is out of stock.`)
      return
    }
    setCart((items) => {
      if (existing) {
        return items.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item)
      }
      return [...items, { id: product.id, name: product.label, price: product.price, buyingPrice: product.buyingPrice, stock: product.stock, qty: 1 }]
    })
    setNotice(`${product.label} added to the sale.`)
  }

  function changeQuantity(name, change) {
    setCart((items) => items
      .map((item) => item.name === name ? { ...item, qty: Math.min(item.stock, item.qty + change) } : item)
      .filter((item) => item.qty > 0))
  }

  async function completeSale(customer = 'Walk-in customer') {
    if (cart.length === 0) {
      setNotice('Add a product to the cart before completing a sale.')
      return
    }
    try {
      const { sale, ratesStale } = await apiRequest('/sales', {
        method: 'POST',
        body: JSON.stringify({
          customer,
          items: cart.map((item) => ({ productId: item.id, quantity: item.qty })),
        }),
      })
      setCart([])
      await refreshWorkspace(sessionUser, chartRange, chartDate)
      setNotice(`Sale ${sale.id} completed for ${formatCurrency(sale.amount, displayCurrency)}.${ratesStale ? ' Warning: an outdated exchange-rate snapshot was used.' : ''}`)
    } catch (error) {
      setNotice(error.message)
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
    link.download = 'kajuna-bms-sales.csv'
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
    if (!payload.name || !Number.isFinite(payload.buyingPrice) || payload.buyingPrice < 0 || !Number.isFinite(payload.sellingPrice) || payload.sellingPrice <= payload.buyingPrice || !Number.isInteger(payload.quantity) || payload.quantity < 0) {
      setNotice('Enter a product name, a valid buying price, a selling price above the buying price, and a valid stock quantity.')
      return
    }
    await performAction(async () => {
      const productPayload = { ...payload }
      if (!productPayload.sku) delete productPayload.sku
      await apiRequest('/products', { method: 'POST', body: JSON.stringify(productPayload) })
      setModal('')
    }, `${payload.name} added to products.`)
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

  function submitSimpleForm(event, successMessage) {
    event.preventDefault()
    setNotice(successMessage)
    setModal('')
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
      setSessionUser(user)
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
      setSessionUser(user)
      await refreshWorkspace(user)
    } catch (error) {
      setLoginError(error.message)
    }
  }

  async function changeBusinessAccess(business) {
    const status = business.status === 'active' ? 'suspended' : 'active'
    const action = status === 'suspended' ? 'suspend' : 'reactivate'
    if (!window.confirm(`${action === 'suspend' ? 'Suspend' : 'Reactivate'} ${business.name}?${status === 'suspended' ? ' All signed-in users will be signed out.' : ''}`)) return
    try {
      await apiRequest(`/platform/businesses/${business.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      await refreshWorkspace(sessionUser)
      setNotice(`${business.name} access ${status === 'suspended' ? 'suspended' : 'reactivated'}.`)
    } catch (error) {
      setNotice(error.message)
    }
  }

  async function deleteCustomerBusiness(business, password) {
    await apiRequest(`/platform/businesses/${business.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    })
    setPlatformBusinesses((current) => current.filter((item) => item.id !== business.id))
    setNotice(`${business.name} and its business data were permanently deleted.`)
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
    delete payload.confirmPassword
    if (googleCredential) payload.googleCredential = googleCredential
    try {
      const result = await apiRequest('/auth/register-business', { method: 'POST', body: JSON.stringify(payload) })
      setGoogleCredential('')
      if (result.user) {
        setSessionUser(result.user)
        setSetupRequired(false)
        try {
          await refreshWorkspace(result.user)
          setNotice(`Business ${result.user.businessName} is ready.`)
        } catch (error) {
          setNotice(error.message)
        }
      } else {
        setNotice(result.message)
        setAuthMode('login')
      }
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

  async function signOut() {
    try {
      await apiRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) })
    } catch (error) {
      setNotice(error.message)
    } finally {
      // Prevent Google One Tap from automatically re-signing the user in.
      window.google?.accounts?.id?.disableAutoSelect()
      setSessionUser(null)
      setCart([])
      setTransactions([])
      setProducts([])
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
        <div className={`login-shell${isAuthenticatingOwner ? ' register-mode' : ''}`}>
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
            <h2>{isOwnerSetup ? 'Set up system owner' : isRegistering ? 'Register your business' : 'Login'}</h2>
            {isRegistering && <p className="form-copy">Create a business account to get started. Scroll within this form to complete all details.</p>}
            {isOwnerSetup && <p className="form-copy">Create the private owner account used to manage business access and subscriptions. Scroll within this form to complete setup.</p>}
            {notice && (
              <div className="login-notice" role="status">
                <span>{notice}</span>
                <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button>
              </div>
            )}
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
                  {setupRequired && (
                    <PasswordField label="First-time setup key" name="setupToken" placeholder="First-time setup key" autoComplete="off" required />
                  )}
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
          </div>
        </div>
        {modal && <Modal type={modal} onClose={() => setModal('')} onSubmit={submitSimpleForm} />}
      </div>
    )
  }

  if (sessionUser.role === 'platform_admin') {
    return (
      <OwnerConsole
        user={sessionUser}
        businesses={platformBusinesses}
        notice={notice}
        onDismissNotice={() => setNotice('')}
        onSignOut={signOut}
        onChangeAccess={changeBusinessAccess}
        onDeleteBusiness={deleteCustomerBusiness}
        onRefresh={() => refreshWorkspace(sessionUser)}
      />
    )
  }

  if (sessionUser.role === 'sales_agent') {
    return (
      <AgentWorkspace
        agent={sessionUser}
        products={posProducts}
        currencyCode={displayCurrency}
        cart={cart}
        cartTotal={cartTotal}
        transactions={transactions}
        notice={notice}
        onDismissNotice={() => setNotice('')}
        onAddProduct={addToCart}
        onChangeQuantity={changeQuantity}
        onCompleteSale={completeSale}
        onExit={signOut}
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-area">
          <div className="brand-mark">K</div>
          <div><strong>KAJUNA</strong><span>BMS</span></div>
        </div>

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
                  <span>{group.title}</span><span className="nav-chevron" aria-hidden="true">⌄</span>
                </button>
              </h2>
              {expandedNavGroup === group.title && (
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>
                      <button type="button" className={selectedNav === item ? 'nav-item active' : 'nav-item'} onClick={() => openSection(item)}>
                        {item}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </nav>
        <div className="sidebar-account">
          <div className="user-chip">
            <span className="mini-avatar">{sessionUser.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
            <div><strong>{sessionUser.name}</strong><small>Business admin</small></div>
          </div>
          <button type="button" className="sidebar-signout" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div><p className="eyebrow">Business admin dashboard</p><h2>KAJUNA BMS</h2></div>
          <div className="topbar-tools">
            {selectedView === 'transactions' && <button type="button" className="ghost-button" onClick={exportTransactions}>Export</button>}
            {selectedView === 'sales' && <button type="button" className="primary-button" onClick={() => openSection('New Sale / POS')}>+ Add Sale</button>}
          </div>
        </header>

        {notice && (
          <div className="notice-banner" role="status">
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button>
          </div>
        )}

        <section className="page-header">
          <div>
            <p className="eyebrow">{selectedView === 'overview' ? 'Multi-tenant operations' : selectedNav}</p>
            <h1>{selectedView === 'overview' ? business?.name || sessionUser.businessName : selectedNav}</h1>
          </div>
          {selectedView === 'overview' && <div className="header-status"><span className="status-dot" />Business overview</div>}
        </section>
        {dashboard.fxWarnings?.map((warning) => <p className="fx-warning" role="status" key={warning}>{warning}</p>)}

        {selectedView === 'overview' && <section className="stats-grid">
          {metricCards.map((card) => (
            <article className={`stat-card ${card.tone}`} key={card.label}>
              <div className="stat-info">
                <p>{card.label}</p>
                <h3>{['todaySales', 'todayExpenses', 'revenue', 'profit', 'expenses'].includes(card.key)
                  ? formatCurrency(dashboard.metrics[card.key], displayCurrency)
                  : dashboard.metrics[card.key].toLocaleString('en-TZ')}</h3>
              </div>
              <span className="stat-delta">{card.detail}</span>
            </article>
          ))}
        </section>}

        {(selectedView === 'overview' || selectedView === 'performance') && <section className="content-grid single-column-grid">
          <div className="panel chart-panel">
            <div className="panel-header">
              <div><p className="eyebrow">Business Performance</p><h3>Revenue, expenses &amp; net profit</h3></div>
              <div className="chart-filters">
                <label className="range-select-label">
                  <span className="sr-only">Performance graph time range</span>
                <select
                  className="range-select"
                  aria-label="Performance graph time range"
                  value={chartRange}
                  onChange={(event) => loadDashboardChart(event.target.value, todayDate)}
                >
                  <option>Today</option>
                  <option>This Week</option>
                  <option>This Month</option>
                  <option>3 Months</option>
                  <option>1 Year</option>
                </select>
                </label>
                <label className="chart-date-label">
                  <span>Jump to date</span>
                  <input
                    type="date"
                    aria-label="Jump to a specific date"
                    value={chartDate}
                    max={todayDate}
                    onChange={(event) => {
                      if (event.target.value) loadDashboardChart('day', event.target.value)
                    }}
                  />
                </label>
              </div>
            </div>
            <PerformanceGraph chart={dashboard.chart} currencyCode={displayCurrency} />
          </div>
        </section>}

        {selectedView === 'subscription' && <section className="panel subscription-panel page-section">
            <div className="panel-header"><div><p className="eyebrow">Subscription</p><h3>Current plan</h3></div><span className={`pill ${dashboard.subscription?.status === 'active' ? 'success' : ''}`}>{dashboard.subscription?.status || 'Not set up'}</span></div>
            {dashboard.subscription ? (
              <>
                <div className="plan-box">
                  <strong>{dashboard.subscription.name}</strong>
                  <div className="plan-meta"><span>{formatCurrency(dashboard.subscription.price, displayCurrency)} / {dashboard.subscription.billingPeriod}</span><span>Renews: {new Date(dashboard.subscription.currentPeriodEnd).toLocaleDateString()}</span></div>
                </div>
                <ul className="feature-stack"><li>Unlimited products</li><li>Multi-user access</li><li>Advanced reporting</li></ul>
              </>
            ) : <p className="section-description">No subscription is currently assigned to this business.</p>}
          </section>}

        {selectedView === 'products' && <section className="bottom-grid single-column-grid">
          <div className="panel table-panel" id="products">
            <div className="panel-header">
              <div><p className="eyebrow">Inventory</p><h3>Product stock</h3></div>
              <span className="inventory-value">Stock cost value: {formatCurrency(dashboard.metrics.inventoryValue || 0, displayCurrency)}</span>
              <button type="button" className="primary-button small" onClick={() => setModal('product')}>Add Product</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Selling price</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {products.map((row) => (
                    <tr key={row.sku}>
                      <td>{row.name}</td><td>{row.sku}</td><td>{row.stock}</td><td>{formatCurrency(row.sellingPrice, displayCurrency)}</td>
                      <td><span className={row.stock <= row.reorderLevel ? 'status-badge danger' : 'status-badge ok'}>{row.stock <= row.reorderLevel ? 'Review stock' : 'Healthy'}</span></td>
                      <td><button type="button" className="text-action" onClick={() => { setProductToRestock(row); setModal('restock') }}>Restock</button></td>
                    </tr>
                  ))}
                  {products.length === 0 && <tr><td colSpan="6" className="empty-table">No products have been added yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

        </section>}

        {selectedView === 'sales' && <section className="bottom-grid single-column-grid">
          <div className={`panel pos-panel${drawerOpen ? ' drawer-open' : ''}`}>
            <div className="panel-header">
              <div><p className="eyebrow">Fast sales</p><h3>POS</h3></div>
              <button type="button" className="ghost-button" aria-expanded={drawerOpen} onClick={() => setDrawerOpen((open) => !open)}>
                {drawerOpen ? 'Close drawer' : 'Open drawer'}
              </button>
            </div>
            {drawerOpen && <p className="drawer-status" role="status">Cash drawer ready for checkout.</p>}
            <div className="pos-grid">
              {posProducts.map((product) => (
                <button type="button" key={product.label} className="pos-item" onClick={() => addToCart(product)} aria-label={`Add ${product.label} to sale`}>
                  <span className={`item-dot ${product.tone}`} />
                  <strong>{product.label}</strong>
                  <small>{formatCurrency(product.price, displayCurrency)}</small>
                  <em>{product.stock} left</em>
                </button>
              ))}
            </div>
            <div className="cart-wrap">
              <div className="cart-row"><span>Cart total</span><strong>{formatCurrency(cartTotal, displayCurrency)}</strong></div>
              {cart.length === 0 && <p className="empty-cart">Your cart is empty. Select a product to start a sale.</p>}
              {cart.map((item) => (
                <div className="cart-item" key={item.name}>
                  <span>{item.name}</span>
                  <div className="quantity-controls">
                    <button type="button" aria-label={`Remove one ${item.name}`} onClick={() => changeQuantity(item.name, -1)}>−</button>
                    <span>{item.qty}</span>
                    <button type="button" aria-label={`Add one ${item.name}`} onClick={() => changeQuantity(item.name, 1)}>+</button>
                  </div>
                  <strong>{formatCurrency(item.price * item.qty, displayCurrency)}</strong>
                </div>
              ))}
              <button type="button" className="primary-button large" onClick={() => completeSale()}>COMPLETE SALE</button>
            </div>
          </div>
        </section>
        }

        {selectedView === 'transactions' && <section className="panel recent-panel">
          <div className="panel-header">
            <div><p className="eyebrow">Transactions</p><h3>Recent sales</h3></div>
            <div className="sales-history-controls">
              <label className="chart-date-label">
                <span>Sales date</span>
                <input
                  type="date"
                  aria-label="Filter sales by date"
                  value={salesDate}
                  max={todayDate}
                  onChange={(event) => loadSalesForDate(event.target.value)}
                />
              </label>
              {salesDate && <button type="button" className="ghost-button" onClick={() => loadSalesForDate('')}>All dates</button>}
              {!salesDate && <button type="button" className="ghost-button" onClick={() => setShowAllSales((show) => !show)}>{showAllSales ? 'Show recent' : 'View all'}</button>}
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date &amp; time</th><th>Receipt</th><th>Customer</th><th>Item</th><th>Sold by</th><th>Amount</th><th>Gross profit</th><th>Status</th></tr></thead>
              <tbody>
                {(showAllSales ? transactions : transactions.slice(0, 4)).map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{transaction.businessDateTime || '—'}</td><td>{transaction.id}</td><td>{transaction.customer}</td><td>{transaction.item}</td><td>{transaction.soldBy || 'Unknown'}</td><td title={`Snapshot conversion: ${transaction.rateUpdatedAt ? new Date(transaction.rateUpdatedAt).toLocaleString() : 'same-currency transaction'}`}><strong>{formatCurrency(transaction.amount, displayCurrency)}</strong><small className="money-origin">Recorded: {formatCurrency(transaction.originalAmount, transaction.originalCurrency)}</small></td><td>{transaction.profit == null ? '—' : formatCurrency(transaction.profit, displayCurrency)}</td>
                    <td><span className={transaction.status === 'Pending' ? 'status-badge warning' : 'status-badge ok'}>{transaction.status}</span></td>
                  </tr>
                ))}
                {transactions.length === 0 && <tr><td colSpan="8" className="empty-table">{salesDate ? `No sales were recorded on ${salesDate}.` : 'No sales have been recorded yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>}

        {selectedView === 'costs' && <section className="panel recent-panel">
          <div className="panel-header">
            <div><p className="eyebrow">Business costs</p><h3>Recent expenses</h3></div>
            <button type="button" className="primary-button small" onClick={() => setModal('expense')}>+ Add expense</button>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{new Date(`${expense.expense_date.slice(0, 10)}T00:00:00`).toLocaleDateString()}</td>
                    <td>{expense.category}</td><td>{expense.description}</td><td title={`Snapshot conversion: ${expense.rateUpdatedAt ? new Date(expense.rateUpdatedAt).toLocaleString() : 'same-currency transaction'}`}><strong>{formatCurrency(expense.amount, displayCurrency)}</strong><small className="money-origin">Recorded: {formatCurrency(expense.originalAmount, expense.originalCurrency)}</small></td>
                  </tr>
                ))}
                {expenses.length === 0 && <tr><td colSpan="4" className="empty-table">No expenses have been recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>}

        {selectedView === 'team' && <section className="panel agents-panel">
          <div className="panel-header">
            <div><p className="eyebrow">Team access</p><h3>Sales agents</h3></div>
            <button type="button" className="primary-button small" onClick={() => setModal('sales-agent')}>+ Register sales agent</button>
          </div>
          <p className="section-description">Manage agent access to the {business?.name || 'business'} sales workspace.</p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Agent</th><th>Contact</th><th>Sales</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td><div className="agent-identity"><span className="mini-avatar">{agent.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><strong>{agent.name}</strong><small>{agent.id}</small></span></div></td>
                    <td><span>{agent.email}</span><small className="contact-phone">{agent.phone}</small></td>
                    <td>{agent.sales}</td>
                    <td><span className={`status-badge ${agent.status === 'active' ? 'ok' : 'warning'}`}>{agent.status === 'active' ? 'Active' : 'Paused'}</span></td>
                    <td>
                      <div className="agent-actions">
                        <button type="button" className="text-action" onClick={() => toggleAgentStatus(agent)}>{agent.status === 'active' ? 'Pause' : 'Resume'}</button>
                        <button type="button" className="text-action danger-action" onClick={() => setAgentToDelete(agent)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {agents.length === 0 && <tr><td colSpan="5" className="empty-table">No sales agents are registered. Register an agent to provide sales access.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>}

        {selectedView === 'settings' && <section className="panel page-section">
          <div className="panel-header">
            <div><p className="eyebrow">Business settings</p><h3>{selectedNav === 'Business Profile' ? 'Business profile' : 'System settings'}</h3></div>
          </div>
          {selectedNav === 'Business Profile' ? (
            <form className="settings-form" onSubmit={saveBusinessSettings}>
              <p className="section-description">Update the contact and profile details associated with your business.</p>
              <div className="settings-fields">
                <label>Business name<input name="name" defaultValue={business?.name || ''} required maxLength="150" /></label>
                <label>Business email<input name="email" type="email" defaultValue={business?.email || ''} required maxLength="254" /></label>
                <label>Phone number<input name="phone" type="tel" defaultValue={business?.phone || ''} required maxLength="40" /></label>
                <label>Industry<input name="industry" defaultValue={business?.industry || ''} required maxLength="100" /></label>
              </div>
              <div className="settings-actions"><button type="submit" className="primary-button" disabled={settingsSaving}>{settingsSaving ? 'Saving…' : 'Save business profile'}</button></div>
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
      </main>
      {modal && <Modal type={modal} setupRequired={setupRequired} currencyCode={displayCurrency} onClose={() => { setModal(''); setProductToRestock(null) }} onSubmit={submitSimpleForm} onAddProduct={addProduct} onAddAgent={addAgent} onAddExpense={addExpense} onRestockProduct={restockProduct} restockProduct={productToRestock} />}
      {agentToDelete && <DeleteAgentDialog agent={agentToDelete} onCancel={() => setAgentToDelete(null)} onConfirm={deleteAgent} />}
    </div>
  )
}

function OwnerConsole({ user, businesses, notice, onDismissNotice, onSignOut, onChangeAccess, onDeleteBusiness, onRefresh }) {
  const [businessToDelete, setBusinessToDelete] = useState(null)
  const attentionCount = businesses.filter((business) => !business.subscriptionStatus || business.subscriptionOverdue).length
  const activeCount = businesses.filter((business) => business.status === 'active').length
  const suspendedCount = businesses.filter((business) => business.status === 'suspended').length

  function subscriptionState(business) {
    if (!business.subscriptionStatus) return 'No subscription'
    if (business.subscriptionOverdue) return 'Payment overdue'
    return business.subscriptionStatus === 'trial' ? 'Trial' : 'Paid / current'
  }

  return (
    <div className="owner-shell">
      <aside className="owner-sidebar">
        <div className="brand-area">
          <div className="brand-mark">K</div>
          <div><strong>KAJUNA</strong><span>BMS · Owner</span></div>
        </div>
        <div className="owner-nav-label">SYSTEM MANAGEMENT</div>
        <div className="owner-nav-item active">Businesses &amp; subscriptions</div>
        <div className="owner-sidebar-account">
          <div className="user-chip">
            <span className="mini-avatar">{user.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
            <div><strong>{user.name}</strong><small>System owner</small></div>
          </div>
          <button type="button" className="sidebar-signout" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>
      <main className="owner-main">
        <header className="topbar owner-topbar">
          <div><p className="eyebrow">Platform administration</p><h2>KAJUNA BMS</h2></div>
          <div className="topbar-tools"><button type="button" className="ghost-button" onClick={onRefresh}>Refresh</button></div>
        </header>
        {notice && <div className="notice-banner" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={onDismissNotice}>×</button></div>}
        <section className="page-header">
          <div><p className="eyebrow">System owner workspace</p><h1>Business access</h1><p className="section-description">Review businesses using your system and manage access when subscriptions are unpaid.</p></div>
          <div className="header-status"><span className="status-dot" />Owner access</div>
        </section>
        <section className="stats-grid owner-stats">
          <article className="stat-card blue"><div className="stat-info"><p>Total businesses</p><h3>{businesses.length}</h3></div><span className="stat-delta">Registered</span></article>
          <article className="stat-card green"><div className="stat-info"><p>Active access</p><h3>{activeCount}</h3></div><span className="stat-delta">Can sign in</span></article>
          <article className="stat-card amber"><div className="stat-info"><p>Payment attention</p><h3>{attentionCount}</h3></div><span className="stat-delta">Past due / no plan</span></article>
          <article className="stat-card rose"><div className="stat-info"><p>Suspended</p><h3>{suspendedCount}</h3></div><span className="stat-delta">Access disabled</span></article>
        </section>
        <section className="panel owner-business-panel">
          <div className="panel-header">
            <div><p className="eyebrow">Customer accounts</p><h3>Businesses on KAJUNA BMS</h3></div>
            <span className="owner-table-count">{businesses.length} total</span>
          </div>
          <p className="section-description">Suspending a business immediately signs out its users and blocks future sign-ins. Permanent deletion removes its business data and cannot be undone.</p>
          <div className="table-scroll">
            <table className="owner-business-table">
              <thead><tr><th>Business / owner</th><th>Plan</th><th>Subscription</th><th>Last payment</th><th>Access</th><th>Action</th></tr></thead>
              <tbody>
                {businesses.map((business) => {
                  const subscription = subscriptionState(business)
                  const attention = subscription === 'Payment overdue' || subscription === 'No subscription'
                  return (
                    <tr key={business.id}>
                      <td><div className="owner-business-identity"><strong>{business.name}</strong><span>{business.ownerName || business.email}</span><small>{business.industry} · {business.userCount} users</small></div></td>
                      <td>{business.planName || '—'}</td>
                      <td><span className={`status-badge ${attention ? 'warning' : 'ok'}`}>{subscription}</span>{business.currentPeriodEnd && <small className="owner-period-end">Through {new Date(business.currentPeriodEnd).toLocaleDateString()}</small>}</td>
                      <td>{business.lastPaymentAt ? <><span className={`status-badge ${business.lastPaymentStatus === 'succeeded' ? 'ok' : 'warning'}`}>{business.lastPaymentStatus || 'Unknown'}</span><small className="owner-period-end">{new Date(business.lastPaymentAt).toLocaleDateString()}</small></> : 'No payment recorded'}</td>
                      <td><span className={`status-badge ${business.status === 'active' ? 'ok' : business.status === 'suspended' ? 'danger' : 'warning'}`}>{business.status}</span></td>
                      <td>
                        <div className="owner-business-actions">
                          {['active', 'suspended'].includes(business.status) && (
                            <button
                              type="button"
                              className={`text-action ${business.status === 'active' ? 'danger-action' : ''}`}
                              onClick={() => onChangeAccess(business)}
                            >{business.status === 'active' ? 'Suspend access' : 'Reactivate'}</button>
                          )}
                          <button
                            type="button"
                            className="text-action danger-action"
                            onClick={() => setBusinessToDelete(business)}
                          >Delete permanently</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {businesses.length === 0 && <tr><td colSpan="6" className="empty-table">No businesses have registered yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>
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
    </div>
  )
}

function AgentWorkspace({ agent, products, cart, cartTotal, transactions, currencyCode, notice, onDismissNotice, onAddProduct, onChangeQuantity, onCompleteSale, onExit }) {
  const [customer, setCustomer] = useState('')

  function submitSale(event) {
    event.preventDefault()
    onCompleteSale(customer.trim() || 'Walk-in customer')
    setCustomer('')
  }

  return (
    <div className="agent-app">
      <header className="agent-topbar">
        <div className="brand-area agent-brand">
          <div className="brand-mark">K</div>
          <div><strong>KAJUNA</strong><span>BMS · Sales</span></div>
        </div>
        <div className="agent-account">
          <span className="mini-avatar">{agent.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
          <div><strong>{agent.name}</strong><small>Sales agent · {agent.businessName}</small></div>
          <button type="button" className="ghost-button" onClick={onExit}>Sign out</button>
        </div>
      </header>
      <main className="agent-content">
        {notice && <div className="notice-banner" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={onDismissNotice}>×</button></div>}
        <section className="page-header agent-page-heading">
          <div><p className="eyebrow">Sales workspace</p><h1>Welcome, {agent.name.split(' ')[0]}</h1><p className="section-description">Create a sale, take payment, and review your completed transactions.</p></div>
          <div className="header-status"><span className="status-dot" />Agent account active</div>
        </section>
        <div className="agent-stat-grid">
          <article className="stat-card blue"><div className="stat-info"><p>Sales completed</p><h3>{transactions.length}</h3></div><span className="stat-delta">Your transactions</span></article>
          <article className="stat-card indigo"><div className="stat-info"><p>Sales today</p><h3>{formatCurrency(transactions.reduce((total, sale) => total + sale.amount, 0), currencyCode)}</h3></div><span className="stat-delta">{currencyCode}</span></article>
        </div>
        <section className="agent-work-grid">
          <div className="panel agent-products">
            <div className="panel-header"><div><p className="eyebrow">Available products</p><h3>Start a sale</h3></div></div>
            <div className="agent-product-grid">
              {products.map((product) => (
                <button type="button" className="agent-product-card" key={product.label} onClick={() => onAddProduct(product)} disabled={product.stock <= 0}>
                  <span className={`item-dot ${product.tone}`} /><strong>{product.label}</strong><span>{formatCurrency(product.price, currencyCode)}</span><small>{product.stock} available</small>
                </button>
              ))}
            </div>
          </div>
          <div className="panel agent-checkout">
            <div className="panel-header"><div><p className="eyebrow">Checkout</p><h3>Current sale</h3></div></div>
            <form onSubmit={submitSale}>
              <label className="agent-customer-field">Customer name (optional)<input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Walk-in customer" /></label>
              <div className="agent-cart">
                {cart.length === 0 && <p className="empty-cart">Select products to add them to this sale.</p>}
                {cart.map((item) => (
                  <div className="cart-item" key={item.name}>
                    <span>{item.name}</span>
                    <div className="quantity-controls"><button type="button" aria-label={`Remove one ${item.name}`} onClick={() => onChangeQuantity(item.name, -1)}>−</button><span>{item.qty}</span><button type="button" aria-label={`Add one ${item.name}`} onClick={() => onChangeQuantity(item.name, 1)}>+</button></div>
                    <strong>{formatCurrency(item.price * item.qty, currencyCode)}</strong>
                  </div>
                ))}
              </div>
              <div className="agent-total"><span>Total due</span><strong>{formatCurrency(cartTotal, currencyCode)}</strong></div>
              <button type="submit" className="primary-button large">COMPLETE SALE</button>
            </form>
          </div>
        </section>
        <section className="panel recent-panel agent-history">
          <div className="panel-header"><div><p className="eyebrow">Your activity</p><h3>Completed sales</h3></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Date &amp; time</th><th>Receipt</th><th>Customer</th><th>Items</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {transactions.map((sale) => <tr key={sale.id}><td>{sale.businessDateTime || '—'}</td><td>{sale.id}</td><td>{sale.customer}</td><td>{sale.item}</td><td>{formatCurrency(sale.amount, currencyCode)}</td><td><span className="status-badge ok">{sale.status}</span></td></tr>)}
              {transactions.length === 0 && <tr><td colSpan="6" className="empty-table">Your completed sales will appear here.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </main>
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

function Modal({ type, onClose, onSubmit, onAddProduct, onAddAgent, onAddExpense, onRestockProduct, restockProduct, currencyCode = 'TZS' }) {
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
          <div><p className="eyebrow">KAJUNA BMS</p><h2 id="modal-title">{title}</h2></div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>
        {type === 'restock' ? (
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
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Save product</button></div>
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
          <form className="modal-form" onSubmit={(event) => onSubmit(event, 'Password reset email is not configured. Contact your business administrator to reset access.')}>
            <p className="form-copy">Password reset email is not configured yet. Contact your business administrator to reset access.</p>
            <label>Email address<input name="email" type="email" required autoFocus /></label>
            <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Close</button></div>
          </form>
        )}
      </section>
    </div>
  )
}

export default App
