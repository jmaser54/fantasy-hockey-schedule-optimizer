import { useState } from 'react';
import { CONTACT_ACTION, CONTACT_FIELDS, MESSAGE_MAX, contactReturnUrl } from '../contact.ts';

/** Contact form shown inside the League Settings dialog. Submits as a normal form post to FormSubmit. */
export function ContactForm({ onBack }: { onBack: () => void }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  return (
    <>
      <div className="panel-head">
        <h2>Contact</h2>
        <button className="btn ghost" onClick={onBack}>
          Back
        </button>
      </div>
      <form className="panel-body stack contact-form" action={CONTACT_ACTION} method="POST" onSubmit={() => setSending(true)}>
        {Object.entries(CONTACT_FIELDS).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name="_next" value={contactReturnUrl()} />
        <p className="small muted" style={{ margin: 0 }}>
          Questions, ideas or problems with Playoff Planner? Send a message.
        </p>
        <div className="form-row">
          <div className="field">
            <label htmlFor="contact-name">Name (optional)</label>
            <input id="contact-name" name="name" autoComplete="name" maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="contact-email">Email (optional, for a reply)</label>
            <input id="contact-email" name="email" type="email" autoComplete="email" inputMode="email" maxLength={200} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="contact-message">Message</label>
          <textarea id="contact-message" name="message" required value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MESSAGE_MAX} />
        </div>
        <div>
          <button className="btn primary" type="submit" disabled={!message.trim() || sending}>
            {sending ? 'Sending…' : 'Send Message'}
          </button>
        </div>
      </form>
    </>
  );
}
