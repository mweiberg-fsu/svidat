// Modifier keys are named differently on Apple platforms (Cmd/Option) than
// elsewhere (Ctrl/Alt, with the Meta key usually being the Windows key).
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

// The key that adds individual items to a native <select multiple>.
export const MULTI_SELECT_KEY = IS_MAC ? 'Cmd' : 'Ctrl'
