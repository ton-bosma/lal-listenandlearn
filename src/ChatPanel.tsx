import { useState } from 'react'
import { type ChatMsg, chatSend } from './lib/explain'
import { mdToHtml } from './lib/markdown'

interface ChatPanelProps {
  title: string
  seed: ChatMsg[]
  context?: { fragment: string; sentence: string }
  onBack: () => void
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Onbekende fout.'
}

/**
 * Full-screen chat met de tutor. Twee ingangen delen dit scherm:
 *  - vrije chat (lege `seed`, geen `context`)
 *  - vanuit de uitleg (geseede history + fragment-context).
 * De thread start vers bij mount (geen persistentie tussen keren).
 */
export default function ChatPanel({ title, seed, context, onBack }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>(seed)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function send() {
    const q = input.trim()
    if (q === '' || sending) return
    const history = messages
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: q }])
    setSending(true)
    setError(null)
    chatSend(history, q, context)
      .then((text) => setMessages((prev) => [...prev, { role: 'model', text }]))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setSending(false))
  }

  const placeholder = messages.length > 0 ? 'Vraag verder…' : 'Stel een vraag…'

  return (
    <>
      <div className="screen-head">
        <button className="btn practice-back" onClick={onBack}>
          ← Terug
        </button>
        <h2 className="screen-title">{title}</h2>
      </div>
      <div className="chat-body">
        <div className="explain-thread chat-thread">
          {messages.map((m, i) =>
            m.role === 'model' ? (
              <div
                className="explain-text explain-md"
                key={i}
                dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }}
              />
            ) : (
              <p className="explain-q" key={i}>
                {m.text}
              </p>
            ),
          )}
          {sending && <p className="explain-typing">Antwoord ophalen…</p>}
          {error && <p className="warn">{error}</p>}
        </div>
        <div className="explain-ask chat-ask">
          <input
            className="explain-input"
            placeholder={placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
          />
          <button className="btn" onClick={send} disabled={input.trim() === '' || sending}>
            Vraag
          </button>
        </div>
      </div>
    </>
  )
}
