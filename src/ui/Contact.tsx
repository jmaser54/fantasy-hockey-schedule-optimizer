import { useState } from 'react';
import { MESSAGE_MAX, sendContact } from '../contact.ts';

/** Contact form shown inside the League Settings dialog. */
export function ContactForm({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [honey, setHoney] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || status === 'sending') return;
    setStatus('sending');
    try {
      await sendContact({ name, email, message }, honey);
      setStatus('sent');
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  };

  return (
    <>
      <div className="panel-head">
        <h2>Contact</h2>
        <button className="btn ghost" onClick={onBack}>
          Back
        </button>
      </div>
      {status === 'sent' ? (
        <div className="panel-body stack">
          <p style={{ margin: 0 }}>
            <b>Message sent.</b> Thanks for getting in touch!
          </p>
          <div>
            <button className="btn" onClick={onBack}>
              Back to Settings
            </button>
          </div>
        </div>
      ) : (
        <form className="panel-body stack contact-form" onSubmit={submit} noValidate>
          <p className="small muted" style={{ margin: 0 }}>
            Questions, ideas or problems with Playoff Planner? Send a message.
          </p>
          <div className="form-row">
            <div className="field">
              <label htmlFor="contact-name">Name (optional)</label>
              <input id="contact-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>
            <div className="field">
              <label htmlFor="contact-email">Email (optional, for a reply)</label>
              <input id="contact-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="contact-message">Message</label>
            <textarea id="contact-message" required value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MESSAGE_MAX} />
          </div>
          {/* Spam trap: hidden from people, filled in by some bots. */}
          <input className="contact-honey" tabIndex={-1} autoComplete="off" aria-hidden="true" value={honey} onChange={(e) => setHoney(e.target.value)} name="_honey" />
          {status === 'error' && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <div>
            <button className="btn primary" type="submit" disabled={!message.trim() || status === 'sending'}>
              {status === 'sending' ? 'Sending…' : 'Send Message'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
