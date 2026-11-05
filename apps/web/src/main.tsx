import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './components/App.tsx';
import { ensureFontsLoaded } from './fonts.ts';

void ensureFontsLoaded();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
