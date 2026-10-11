// Chinese + English OCR loaded only when the user asks to recognize a photo.
export async function recognizeImageText(file, onProgress = () => {}) {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('chi_sim+eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    logger: event => {
      if (event.status === 'recognizing text') onProgress(Math.round((event.progress || 0) * 100))
    },
  })
  try {
    const result = await worker.recognize(file)
    return String(result.data.text || '').trim()
  } finally {
    await worker.terminate()
  }
}
