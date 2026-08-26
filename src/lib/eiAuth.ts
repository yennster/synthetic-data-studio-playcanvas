/**
 * Edge Impulse auth gating.
 *
 * The original app documented `?bypassAuth=1` ("Skip EI auth checks.
 * Offline UI testing.") but never consumed the flag — the only URL
 * parameter with zero runtime effect (ORIGINAL-FEATURES §8.1). The
 * rebuild wires it for real: everywhere the UI would disable an
 * upload/retrain affordance because no API key is set, the flag makes
 * the gate pass so the flows can be demoed offline. The network calls
 * themselves still use whatever key is present (an empty key fails
 * loudly at the API — that's the point of *UI* testing).
 *
 * Pure over its inputs so it's trivially unit-testable; callers pass
 * `URL_FLAGS.bypassAuth` for the second argument.
 */
export function eiAuthSatisfied(apiKey: string, bypassAuth: boolean): boolean {
  return bypassAuth || apiKey.trim().length > 0;
}
