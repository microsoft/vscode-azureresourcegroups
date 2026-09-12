// App header with navigation

import { Toolbar, ToolbarButton, Title3, Avatar } from '@fluentui/react-components';
import { HomeRegular } from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';

export function AppHeader() {
  const navigate = useNavigate();

  return (
    <Toolbar
      style={{
        background: '#F7F8FA',
        borderBottom: '1px solid #E1E4E8',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      <Title3 style={{ flex: 1, color: '#1B1E23', margin: 0 }}>Task Tracker</Title3>
      <ToolbarButton
        icon={<HomeRegular />}
        appearance="subtle"
        onClick={() => navigate('/')}
      >
        Home
      </ToolbarButton>
      <Avatar name="User" color="brand" />
    </Toolbar>
  );
}
