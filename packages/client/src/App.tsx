import { PROTOCOL_VERSION } from '@chaindrop/shared';

export function App() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#1a1a2e',
        color: '#ffd60a',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '4rem', margin: 0 }}>ChainDrop</h1>
        <p style={{ color: '#c8c8d8', marginTop: '1rem' }}>
          M0 scaffold — protocol v{PROTOCOL_VERSION}
        </p>
      </div>
    </main>
  );
}
