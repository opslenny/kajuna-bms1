import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export async function downloadReportPdf({ reportData, reportType, reportCustomStart, reportCustomEnd, setNotice, setReportError, setReportDownloading }) {
  if (!reportData) return
  if (setReportDownloading) setReportDownloading(true)
  try {
    const doc = new jsPDF()
    let logoDataUrl = null
    try {
      const resp = await fetch('/api/business/logo', { credentials: 'same-origin' })
      if (resp.ok) {
        const blob = await resp.blob()
        logoDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
      }
    } catch (e) {}

    const currency = reportData.business.currency
    const fmt = (n) => new Intl.NumberFormat('en-TZ', { style: 'currency', currency }).format(n)
    let y = 14
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, 'AUTO', 14, y, 18, 18) } catch (e) {}
    }
    doc.setFontSize(16)
    doc.text(reportData.business.name, logoDataUrl ? 36 : 14, y + 6)
    doc.setFontSize(11)
    doc.text('Monthly Financial Report', logoDataUrl ? 36 : 14, y + 13)
    doc.setFontSize(9)
    doc.text('Reporting period: ' + reportData.period.startDay + ' to ' + reportData.period.endDay, 14, y + 24)
    doc.text('Date generated: ' + new Date().toLocaleString(), 14, y + 30)

    autoTable(doc, {
      startY: y + 36,
      head: [['Financial Metric', 'Amount']],
      body: [
        ['Total Revenue', fmt(reportData.summary.totalRevenue)],
        ['Total Expenses', fmt(reportData.summary.totalExpenses)],
        ['Net Profit', fmt(reportData.summary.netProfit)],
        ['Cash', fmt(reportData.summary.cash)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 138] },
    })

    let currentY = doc.lastAutoTable.finalY + 8
    doc.setFontSize(12)
    doc.text('Sales Summary', 14, currentY)
    currentY += 6
    autoTable(doc, {
      startY: currentY,
      head: [['Item', 'Value']],
      body: [
        ['Total sales transactions', String(reportData.summary.salesCount)],
        ['Total sales revenue', fmt(reportData.summary.totalRevenue)],
        ['Total sales returns and refunds', fmt(reportData.summary.refundedAmount) + ' (' + reportData.summary.refundedCount + ')'],
        ['Profit margin', reportData.summary.profitMargin.toFixed(2) + '%'],
      ],
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 138] },
    })

    currentY = doc.lastAutoTable.finalY + 8
    doc.setFontSize(12)
    doc.text('Expense Breakdown', 14, currentY)
    currentY += 6
    autoTable(doc, {
      startY: currentY,
      head: [['Category', 'Amount', 'Count', 'Percentage']],
      body: reportData.expenseBreakdown.map((e) => [
        e.category,
        fmt(e.amount),
        String(e.count),
        e.percentage.toFixed(1) + '%',
      ]),
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 138] },
    })

    currentY = doc.lastAutoTable.finalY + 8
    doc.setFontSize(12)
    doc.text('Payment Methods Breakdown', 14, currentY)
    currentY += 6
    autoTable(doc, {
      startY: currentY,
      head: [['Method', 'Amount', 'Count']],
      body: reportData.paymentMethods.map((p) => [p.method, fmt(p.amount), String(p.count)]),
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 138] },
    })

    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.text('Page ' + i + ' / ' + pageCount, 196, 290, { align: 'right' })
    }

    const monthName = reportType === 'custom'
      ? reportCustomStart + '_to_' + reportCustomEnd
      : new Date(reportData.period.startDay).toLocaleString('en', { month: 'long', year: 'numeric' }).replace(' ', '_')
    const safeName = (reportData.business.name || 'Business').replace(/[^a-zA-Z0-9]/g, '_')
    const filename = safeName + '_' + (reportType === 'custom' ? 'Custom_Report' : 'Monthly_Report') + '_' + monthName + '.pdf'
    doc.save(filename)
    if (setNotice) setNotice('Report downloaded successfully.')
  } catch (error) {
    if (setReportError) setReportError(error.message)
    if (setNotice) setNotice(error.message)
  } finally {
    if (setReportDownloading) setReportDownloading(false)
  }
}
