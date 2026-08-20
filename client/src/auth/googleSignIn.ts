export interface GoogleSignInOptions {
  clientId: string
  onToken: (idToken: string) => void
  onError: (message: string) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | null = null

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null // allow a retry on next call instead of permanently poisoning the module
      reject(new Error('failed to load Google sign-in script'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export async function renderGoogleButton(
  container: HTMLElement,
  options: GoogleSignInOptions
): Promise<void> {
  try {
    await loadGoogleScript()
  } catch {
    options.onError('Google sign-in unavailable')
    return
  }
  window.google!.accounts.id.initialize({
    client_id: options.clientId,
    callback: (response) => options.onToken(response.credential),
  })
  window.google!.accounts.id.renderButton(container, { theme: 'outline', size: 'large' })
}
