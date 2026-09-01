// Mock State Switcher - forces data/loading/empty/error states for preview verification

export type PreviewDataState = 'data' | 'loading' | 'empty' | 'error';

function getInitialState(): PreviewDataState {
  // 1. Check URL query param
  const params = new URLSearchParams(window.location.search);
  const queryState = params.get('previewState') as PreviewDataState | null;
  if (queryState && ['data', 'loading', 'empty', 'error'].includes(queryState)) {
    localStorage.setItem('previewState', queryState);
    return queryState;
  }

  // 2. Check localStorage
  const storedState = localStorage.getItem('previewState') as PreviewDataState | null;
  if (storedState && ['data', 'loading', 'empty', 'error'].includes(storedState)) {
    return storedState;
  }

  // 3. Default to 'data'
  return 'data';
}

let currentState: PreviewDataState = getInitialState();

export function getPreviewState(): PreviewDataState {
  return currentState;
}

export function setPreviewState(state: PreviewDataState): void {
  currentState = state;
  localStorage.setItem('previewState', state);
  window.dispatchEvent(new Event('previewStateChange'));
}
