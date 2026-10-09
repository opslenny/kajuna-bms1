export const supportedCurrencies = Object.freeze(['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP'])

const exchangeApiUrl = 'https://open.er-api.com/v6/latest/USD'
const staleRateLimitMs = 7 * 24 * 60 * 60 * 1000
let cachedRates
let pendingRequest

function isValidRateSet(rates) {
  return supportedCurrencies.every((code) => Number.isFinite(rates[code]) && rates[code] > 0)
    && rates.USD === 1
}

async function fetchExchangeRates() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(exchangeApiUrl, { signal: controller.signal })
    if (!response.ok) throw new Error(`Exchange-rate service responded with HTTP ${response.status}.`)
    const payload = await response.json()
    if (payload.result !== 'success' || payload.base_code !== 'USD'
      || !payload.rates || typeof payload.rates !== 'object'
      || !Number.isFinite(payload.time_last_update_unix)
      || !Number.isFinite(payload.time_next_update_unix)
      || payload.time_next_update_unix <= payload.time_last_update_unix) {
      throw new Error('Exchange-rate service returned an invalid response.')
    }

    const rates = Object.fromEntries(
      Object.entries(payload.rates)
        .filter(([code, rate]) => /^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0 && rate <= 1_000_000_000_000),
    )
    if (!isValidRateSet(rates)) throw new Error('Exchange-rate service is missing one or more supported currencies.')

    const nowSeconds = Date.now() / 1000
    if (payload.time_last_update_unix > nowSeconds + 300 || payload.time_next_update_unix <= nowSeconds) {
      throw new Error('Exchange-rate service returned expired or future-dated rates.')
    }
    const updatedAt = new Date(payload.time_last_update_unix * 1000).toISOString()
    const nextUpdateAt = new Date(payload.time_next_update_unix * 1000).toISOString()
    cachedRates = {
      rates,
      updatedAt,
      nextUpdateAt,
      refreshAt: payload.time_next_update_unix * 1000,
      provider: 'ExchangeRate-API Open Access',
      isStale: false,
    }
    return cachedRates
  } finally {
    clearTimeout(timeout)
  }
}

export async function getExchangeRates() {
  if (cachedRates && Date.now() < cachedRates.refreshAt) return cachedRates
  if (!pendingRequest) {
    pendingRequest = fetchExchangeRates()
      .catch((error) => {
        if (cachedRates && Date.now() - Date.parse(cachedRates.updatedAt) <= staleRateLimitMs) {
          cachedRates = { ...cachedRates, refreshAt: Date.now() + 5 * 60 * 1000, isStale: true }
          return cachedRates
        }
        throw error
      })
      .finally(() => { pendingRequest = undefined })
  }
  return pendingRequest
}

export function isSupportedCurrency(currency) {
  return supportedCurrencies.includes(currency)
}

export function currencyRate(fromCurrency, toCurrency, rates) {
  if (!/^[A-Z]{3}$/.test(fromCurrency) || !/^[A-Z]{3}$/.test(toCurrency)) {
    throw new Error('Currency codes must be three uppercase letters.')
  }
  const fromRate = rates?.[fromCurrency]
  const toRate = rates?.[toCurrency]
  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
    throw new Error(`No exchange rate is available for ${fromCurrency} to ${toCurrency}.`)
  }
  return toRate / fromRate
}

export function roundCurrencyAmount(amount) {
  if (!Number.isFinite(amount) || Math.abs(amount) > 999_999_999_999) {
    throw new Error('The converted amount is outside the supported range.')
  }
  return Math.round((amount + Math.sign(amount) * Number.EPSILON) * 100) / 100
}

export function convertCurrency(amount, fromCurrency, toCurrency, rates) {
  const numericAmount = Number(amount)
  if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) > 999_999_999_999) {
    throw new Error('The amount to convert is invalid or outside the supported range.')
  }
  if (!/^[A-Z]{3}$/.test(fromCurrency) || !/^[A-Z]{3}$/.test(toCurrency)) {
    throw new Error('Currency codes must be three uppercase letters.')
  }
  if (fromCurrency === toCurrency) return roundCurrencyAmount(numericAmount)
  return roundCurrencyAmount(numericAmount * currencyRate(fromCurrency, toCurrency, rates))
}
