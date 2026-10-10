import React from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <React.StrictMode>
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, lineHeight: 1.7 }}>
      <h1>瀹跺涵璐＄尞璇勫垎濂栧姳绯荤粺</h1>
      <p>PWA skeleton is up. The first real screen is the W1 milestone: accounts, family creation and join.</p>
      <p style={{ color: '#666' }}>
        Rules live in <code>docs/PROJECT_GUIDE.md</code>. Claim a module in{' '}
        <code>docs/ai-logs/OWNERS.md</code> before writing feature code.
      </p>
    </main>
  </React.StrictMode>,
);