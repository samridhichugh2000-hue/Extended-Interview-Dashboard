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

const MAX_ATTACH_BYTES = 3 * 1024 * 1024; // the request body (base64) has to fit Vercel's ~4.5 MB limit
const ATTACH_EXT = /\.(xlsx|xlsm|xls|csv|pdf|docx|doc|pptx|png|jpe?g)$/i;

const toBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error('Could not read the attached file.'));
  reader.readAsDataURL(file);
});

export default function ResponseForm({ token, q1, q2, q3, hint1, hint2 }) {
  const [a1, setA1] = useState('');
  const [a2, setA2] = useState('');
  const [a3, setA3] = useState(''); // '' | 'Yes' | 'No'
  const [file, setFile] = useState(null);
  const [state, setState] = useState('idle'); // idle | submitting | done | error
  const [error, setError] = useState('');

  async function submit() {
    if (!a1.trim() || !a2.trim()) {
      setError('Please answer both questions before submitting.');
      return;
    }
    if (q3 && !a3) {
      setError('Please say whether you are maintaining an experiment sheet.');
      return;
    }
    if (q3 && a3 === 'Yes' && file) {
      if (!ATTACH_EXT.test(file.name)) { setError('Attach an Excel, CSV, PDF, Word, PowerPoint or image file.'); return; }
      if (file.size > MAX_ATTACH_BYTES) { setError('The attachment is over 3 MB - please attach a smaller file.'); return; }
    }
    setError('');
    setState('submitting');
    try {
      const attachment = q3 && a3 === 'Yes' && file ? { name: file.name, type: file.type || 'application/octet-stream', content: await toBase64(file) } : null;
      const res = await fetch(`/api/weekly-response/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a1: a1.trim(), a2: a2.trim(), ...(q3 ? { a3, attachment } : {}) }),
      });
      // A timeout or crash can return an empty/non-JSON body; don't let that
      // surface as a raw "Unexpected end of JSON input".
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'We could not save your response just now. Please try again in a few minutes.');
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
      {q3 && (
        <div>
          <div className="mono" style={{ fontSize: 14, color: '#6366F1' }}>{q3}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            {['Yes', 'No'].map((v) => (
              <div key={v} onClick={() => state !== 'submitting' && setA3(v)} style={{ cursor: 'pointer', border: `1px solid ${a3 === v ? '#6366F1' : 'rgba(255,255,255,0.12)'}`, background: a3 === v ? 'rgba(99,102,241,0.16)' : 'transparent', color: a3 === v ? '#A5A7FA' : '#C7CBDA', borderRadius: 8, padding: '8px 18px', fontSize: 13.5 }}>{v}</div>
            ))}
          </div>
          {a3 === 'Yes' && (
            <div style={{ marginTop: 10 }}>
              <input type="file" accept=".xlsx,.xlsm,.xls,.csv,.pdf,.docx,.doc,.pptx,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={state === 'submitting'} style={{ fontSize: 13, color: '#C7CBDA' }} />
              <div style={{ fontSize: 11.5, color: 'rgba(232,234,242,0.5)', marginTop: 4 }}>Optional, up to 3 MB. It is sent with your response by email and is not stored on the dashboard.</div>
            </div>
          )}
        </div>
      )}
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
