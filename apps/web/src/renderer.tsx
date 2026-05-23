import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyBaseStyles } from './theme';

applyBaseStyles();

const el = document.getElementById('root');
if (!el) throw new Error('Root element not found');
createRoot(el).render(<App />);
