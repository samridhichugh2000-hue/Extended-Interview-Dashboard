'use client';
import { useState } from 'react';

const fieldStyle = {
  width: '100%',
  minHeight: 80,
  marginTop: 8,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  padding: '10px 12px',
  color: '#E8EAF2',
  fontFamily: 'inherit',
  fontSize: 13.5,
  lineHeight: 1.5,
  resize: 'vertical',
};

export default function ResponseForm({ token, q1, q2, hint1, hint2 }) {
  const [a1, setA1] = useState('');
  const [a2, setA2] = useState('');
  const [state, setState] = useState('idle'); // idle | submitting | done | error
  const [error, setError] = useState('');

  async function submit() {
    if (!a1.trim() || !a2.trim()) {
      setError('Please answer both questions before submitting.');
      return;
    }
    setError('');
    setState('submitting');
    try {
      const res = await fetch(`/api/weekly-response/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a1: a1.trim(), a2: a2.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Submission failed.');
      setState('done');
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div style={{ marginTop: 20, fontSize: 14, color: '#5EEAD4' }}>
        Thanks — your response has been recorded. A confirmation email is on its way.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`.respond-textarea::placeholder { color: rgba(232,234,242,0.42); }`}</style>
      <div>
        <div className="mono" style={{ fontSize: 14, color: '#6366F1' }}>{q1}</div>
        <textarea className="respond-textarea" style={fieldStyle} placeholder={hint1} value={a1} onChange={(e) => setA1(e.target.value)} disabled={state === 'submitting'} />
      </div>
      <div>
        <div className="mono" style={{ fontSize: 14, color: '#6366F1' }}>{q2}</div>
        <textarea className="respond-textarea" style={fieldStyle} placeholder={hint2} value={a2} onChange={(e) => setA2(e.target.value)} disabled={state === 'submitting'} />
      </div>
      {error && <div style={{ fontSize: 12.5, color: '#F87171' }}>{error}</div>}
      <button
        type="button"
        onClick={submit}
        disabled={state === 'submitting'}
        style={{
          alignSelf: 'flex-start',
          border: 'none',
          font: 'inherit',
          cursor: state === 'submitting' ? 'default' : 'pointer',
          opacity: state === 'submitting' ? 0.6 : 1,
          background: '#6366F1',
          color: '#fff',
          fontWeight: 600,
          fontSize: 13.5,
          borderRadius: 8,
          padding: '10px 20px',
        }}
      >
        {state === 'submitting' ? 'Submitting…' : 'Submit answers'}
      </button>
    </div>
  );
}
