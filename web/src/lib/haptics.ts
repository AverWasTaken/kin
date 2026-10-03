/** Light haptic tick where supported (Android). A no-op on iOS Safari. */
export function tick(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
