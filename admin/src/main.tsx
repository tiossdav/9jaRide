import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import WorkingOverlay from './WorkingOverlay';
import './styles.css';
import './refine.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <WorkingOverlay />
    </BrowserRouter>
  </StrictMode>,
);
