import { PublicClientApplication } from '@azure/msal-browser'

let msalInstance: PublicClientApplication | null = null
let initializePromise: Promise<void> | null = null

function getMsalInstance(clientId: string): PublicClientApplication {
  if (!msalInstance) {
    msalInstance = new PublicClientApplication({
      auth: { clientId, authority: 'https://login.microsoftonline.com/common' },
    })
  }
  return msalInstance
}

export async function signInWithMicrosoft(clientId: string): Promise<string> {
  const instance = getMsalInstance(clientId)
  // Cache the in-flight initialize() call so concurrent invocations (e.g. React StrictMode's
  // double-effect-invocation) await the same promise instead of each calling initialize() on
  // the same instance independently. Mirrors the fix applied to googleSignIn.ts's script-load
  // race. Reset on failure so a later call can retry instead of being permanently poisoned.
  if (!initializePromise) {
    initializePromise = instance.initialize().catch((err: unknown) => {
      initializePromise = null
      throw err
    })
  }
  await initializePromise

  const result = await instance.loginPopup({ scopes: ['openid', 'email', 'profile'] })
  if (!result.idToken) {
    throw new Error('microsoft sign-in did not return an id token')
  }
  return result.idToken
}
