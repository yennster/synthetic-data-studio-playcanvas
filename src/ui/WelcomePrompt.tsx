import { useState } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import { importSampleAsset } from './sampleImport';
import { SAMPLE_ASSETS } from '../lib/sampleAssets';

const CHOICE_KEY = 'sds-welcome-choice';

/**
 * First-load yes/no: offer the sample apartment splat as the default
 * environment. Shown once per browser (until storage is cleared) and
 * only when nothing has been imported yet.
 */
export function WelcomePrompt() {
  const engine = useEngine();
  const engineStatus = useStore((s) => s.engineStatus);
  const splats = useStore((s) => s.splats);
  const pendingSplats = useStore((s) => s.pendingSplats);
  const setStatus = useStore((s) => s.setStatus);
  const [choice, setChoice] = useState<string | null>(() =>
    localStorage.getItem(CHOICE_KEY)
  );
  const [loading, setLoading] = useState(false);

  const apartment = SAMPLE_ASSETS.find((s) => s.name === 'Apartment');
  const shouldShow =
    engineStatus === 'ready' &&
    engine !== null &&
    choice === null &&
    splats.length === 0 &&
    pendingSplats.length === 0 &&
    apartment !== undefined;

  if (!shouldShow) return null;

  const decide = async (load: boolean) => {
    localStorage.setItem(CHOICE_KEY, load ? 'yes' : 'no');
    setChoice(load ? 'yes' : 'no');
    if (load && engine && apartment) {
      setLoading(true);
      try {
        await importSampleAsset(engine, apartment);
      } catch (err) {
        setStatus('err', (err as Error).message);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="welcome-prompt" role="dialog" aria-label="Load sample environment">
      <h3>Start in a photoreal environment?</h3>
      <p>
        Load the sample <strong>Apartment</strong> gaussian-splat scan
        ({apartment.sizeMB} MB · {apartment.license} · {apartment.author}) as
        your capture backdrop. You can remove it or pick others from the
        Sample gallery anytime.
      </p>
      <div className="button-row">
        <button className="primary" disabled={loading} onClick={() => void decide(true)}>
          {loading ? 'Loading…' : 'Yes, load it'}
        </button>
        <button disabled={loading} onClick={() => void decide(false)}>
          No thanks
        </button>
      </div>
    </div>
  );
}
