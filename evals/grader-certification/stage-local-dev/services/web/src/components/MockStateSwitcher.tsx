// Mock State Switcher - dev-only corner toggle for forcing data states

import { useEffect, useState } from 'react';
import { Button, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem } from '@fluentui/react-components';
import { ChevronDownRegular } from '@fluentui/react-icons';
import { getPreviewState, setPreviewState, type PreviewDataState } from '../api/previewState';

const states: PreviewDataState[] = ['data', 'loading', 'empty', 'error'];

export function MockStateSwitcher() {
  const [currentState, setCurrentState] = useState<PreviewDataState>(getPreviewState());

  useEffect(() => {
    const handler = () => setCurrentState(getPreviewState());
    window.addEventListener('previewStateChange', handler);
    return () => window.removeEventListener('previewStateChange', handler);
  }, []);

  const handleStateChange = (state: PreviewDataState) => {
    setPreviewState(state);
    window.location.reload();
  };

  // Only show in dev mode
  if (import.meta.env.PROD) {
    return null;
  }

  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 9999 }}>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="primary" icon={<ChevronDownRegular />} iconPosition="after">
            {currentState}
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {states.map(state => (
              <MenuItem key={state} onClick={() => handleStateChange(state)}>
                {state}
              </MenuItem>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}
