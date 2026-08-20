import { useStore } from '../store/useStore';
import type { EiCategory } from '../lib/types';
import { CollapsibleCard } from './primitives';
import './ei.css';

/**
 * Shared Edge Impulse credentials card. Used by every mode's panel so
 * the user enters API key + category once, next to the upload /
 * inference flows that consume them.
 *
 * The HMAC field is only relevant for time-series JSON acquisition
 * payloads: Edge Impulse's HMAC mechanism signs the protected envelope
 * around the sensor payload before it is uploaded as a `.json` file.
 * Image uploads don't use this acquisition envelope, so we hide the
 * field there (vision panel omits `showHmac`) to avoid implying it's
 * used.
 *
 * The keys live in memory only — `ei` is deliberately excluded from
 * the store's persist partialize, so nothing is written to storage.
 */
export function EiAuthCard({ showHmac = false }: { showHmac?: boolean }) {
  const ei = useStore((s) => s.ei);
  const setEi = useStore((s) => s.setEi);
  return (
    <CollapsibleCard
      heading="Edge Impulse · auth"
      badge={ei.apiKey ? 'set' : undefined}
    >
      <form
        className="ei-form"
        autoComplete="off"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="ei-field">
          <span className="ei-field-label">API Key</span>
          <input
            type="password"
            name="edge-impulse-api-key"
            className="ei-input"
            value={ei.apiKey}
            onChange={(e) => setEi({ apiKey: e.target.value })}
            placeholder="ei_..."
            autoComplete="off"
          />
        </label>
        {showHmac && (
          <label className="ei-field">
            <span className="ei-field-label">HMAC Key (optional)</span>
            <input
              type="password"
              name="edge-impulse-hmac-key"
              className="ei-input"
              value={ei.hmacKey}
              onChange={(e) => setEi({ hmacKey: e.target.value })}
              placeholder="leave blank for unsigned"
              autoComplete="off"
            />
          </label>
        )}
        <label className="ei-field">
          <span className="ei-field-label">Category</span>
          <select
            name="edge-impulse-category"
            className="ei-select"
            value={ei.category}
            onChange={(e) => setEi({ category: e.target.value as EiCategory })}
          >
            <option value="training">Training</option>
            <option value="testing">Testing</option>
            <option value="split">Split 80:20 (training:testing)</option>
          </select>
        </label>
      </form>
    </CollapsibleCard>
  );
}
