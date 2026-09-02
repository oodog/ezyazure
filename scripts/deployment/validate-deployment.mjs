const apiEndpoint = process.env.SERVICE_API_ENDPOINT_URL
const webEndpoint = process.env.SERVICE_WEB_ENDPOINT_URL

if (!apiEndpoint || !webEndpoint) {
  console.error('Deployment outputs are incomplete; API and web endpoints are required.')
  process.exit(1)
}

async function waitFor(url, label) {
  let lastError = 'no response'
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' })
      if (response.ok) {
        console.log(`${label} ready: ${url}`)
        return
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  throw new Error(`${label} did not become ready: ${lastError}`)
}

try {
  await waitFor(`${apiEndpoint.replace(/\/$/, '')}/health`, 'EasyAzure API')
  await waitFor(webEndpoint, 'EasyAzure frontend')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}