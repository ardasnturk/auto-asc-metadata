import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StudioProvider } from './store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StudioProvider>
    <App />
  </StudioProvider>,
);
