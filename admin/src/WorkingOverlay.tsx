import { useSyncExternalStore } from 'react';
import { subscribeWrites, writingNow } from './api';

/** "Please wait..." over the whole page while anything is being saved or uploaded: nothing underneath can be clicked until it is done. */
export default function WorkingOverlay() {
  const text = useSyncExternalStore(subscribeWrites, writingNow);
  if (!text) return null;
  return (
    <div className="scrim working" role="alert" aria-live="polite" aria-busy="true" style={{ zIndex: 60 }}>
      <div className="modal" style={{ width: 340, alignItems: 'center', textAlign: 'center' }}>
        <div className="spinner" aria-hidden="true" />
        <div style={{ fontWeight: 600 }}>{text}</div>
      </div>
    </div>
  );
}
