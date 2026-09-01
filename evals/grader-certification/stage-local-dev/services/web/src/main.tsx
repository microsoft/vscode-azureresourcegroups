import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider } from '@fluentui/react-components';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lightTheme, customTokens } from './theme';
import { AppHeader } from './components/AppHeader';
import { MockStateSwitcher } from './components/MockStateSwitcher';
import { TasksPage } from './pages/TasksPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { NewTaskPage } from './pages/NewTaskPage';

// Inject custom tokens
const style = document.createElement('style');
style.textContent = customTokens;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FluentProvider theme={lightTheme}>
      <BrowserRouter>
        <AppHeader />
        <Routes>
          <Route path="/" element={<TasksPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/tasks/new" element={<NewTaskPage />} />
        </Routes>
        <MockStateSwitcher />
      </BrowserRouter>
    </FluentProvider>
  </StrictMode>
);
