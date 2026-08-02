import { getResponseByToken } from '../../../lib/queries';
import { NJ_QUESTIONS } from '../../../lib/data';
import ResponseForm from './ResponseForm';

export const dynamic = 'force-dynamic';
export const metadata = { robots: 'noindex' };

const card = {
  maxWidth: 560,
  margin: '80px auto',
  border: '1px solid rgba(255,255,255,0.13)',
  borderRadius: 20,
  background: '#101422',
  padding: 32,
  boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)',
};

export default async function RespondPage({ params }) {
  const { token } = params;
  const r = await getResponseByToken(token);

  if (!r) {
    return (
      <div style={{ padding: '0 20px' }}>
        <div style={card}>
          <div className="disp" style={{ fontSize: 20, fontWeight: 600 }}>Link not found</div>
          <div style={{ fontSize: 13.5, color: '#8A90A8', marginTop: 10, lineHeight: 1.6 }}>
            This link isn't valid. If you followed a link from an email, please check it was copied in full — or reach out to HR.
          </div>
        </div>
      </div>
    );
  }

  if (r.state === 'Received') {
    return (
      <div style={{ padding: '0 20px' }}>
        <div style={card}>
          <div className="disp" style={{ fontSize: 20, fontWeight: 600, color: '#5EEAD4' }}>Already submitted</div>
          <div style={{ fontSize: 13.5, color: '#8A90A8', marginTop: 10, lineHeight: 1.6 }}>
            Thanks {r.name} — your response for {r.week} has already been recorded.
          </div>
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="mono" style={{ fontSize: 14, color: '#6366F1', marginBottom: 4 }}>{r.q1}</div>
              <div style={{ fontSize: 13.5, color: '#C7CBDA', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{r.a1}</div>
            </div>
            <div>
              <div className="mono" style={{ fontSize: 14, color: '#6366F1', marginBottom: 4 }}>{r.q2}</div>
              <div style={{ fontSize: 13.5, color: '#C7CBDA', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{r.a2}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 20px' }}>
      <div style={card}>
        <div className="disp" style={{ fontSize: 20, fontWeight: 600 }}>Hi {r.name} — quick check-in</div>
        <ResponseForm token={token} q1={r.q1} q2={r.q2} hint1={NJ_QUESTIONS.find((q) => q.team === r.team)?.hint1} hint2={NJ_QUESTIONS.find((q) => q.team === r.team)?.hint2} />
      </div>
    </div>
  );
}
