// jsPDF and html2canvas are only needed when someone actually clicks
// Export PDF, so they're dynamically imported here rather than at the top
// of the file — keeps them out of the main bundle for everyone else.

// Renders one DOM element to a canvas, high enough resolution to stay
// crisp on an A4 page, with an explicit white background (the app itself
// is on a light background, but this avoids any transparency surprises).
export async function captureElementToCanvas(el) {
  if (!el) return null
  const { default: html2canvas } = await import('html2canvas')
  return html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
  })
}

// Adds a captured canvas to the current last page of `doc`, scaled to fit
// within the page (minus a small margin) while preserving its aspect
// ratio, centered.
function addCanvasFitToPage(doc, canvas, marginMm = 8) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const maxWidth = pageWidth - marginMm * 2
  const maxHeight = pageHeight - marginMm * 2

  const imgRatio = canvas.width / canvas.height
  let renderWidth = maxWidth
  let renderHeight = renderWidth / imgRatio
  if (renderHeight > maxHeight) {
    renderHeight = maxHeight
    renderWidth = renderHeight * imgRatio
  }

  const x = (pageWidth - renderWidth) / 2
  const y = (pageHeight - renderHeight) / 2
  const imgData = canvas.toDataURL('image/png')
  doc.addImage(imgData, 'PNG', x, y, renderWidth, renderHeight)
}

// Builds and downloads a PDF from already-captured canvases. Report ->
// one portrait A4 page. Player Highlights -> one landscape A4 page.
// Either can be included alone, or both (report first).
export async function buildPdfFromCanvases({ reportCanvas, highlightsCanvas, fileName = 'catapult-report.pdf' }) {
  const { default: jsPDF } = await import('jspdf')
  let doc = null

  if (reportCanvas) {
    doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    addCanvasFitToPage(doc, reportCanvas)
  }

  if (highlightsCanvas) {
    if (!doc) {
      doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    } else {
      doc.addPage('a4', 'landscape')
    }
    addCanvasFitToPage(doc, highlightsCanvas)
  }

  if (!doc) return false
  doc.save(fileName)
  return true
}
