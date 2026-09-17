import type { TempSessionEntry } from '../api/types'

export function ResumeSessionModal({
  entries,
  onContinue,
  onDiscard,
}: {
  entries: TempSessionEntry[]
  onContinue: (filename: string) => void
  onDiscard: (filename: string) => void
}) {
  return (
    <div className="resume-session-modal">
      <div className="resume-session-modal-header">
        <span>Continue editing?</span>
      </div>
      <div className="resume-session-modal-body">
        <p>You have unsaved edits from a previous session:</p>
        <ul>
          {entries.map((e) => (
            <li key={e.filename}>
              <span className="resume-session-entry-details">
                {e.filename} — last edited {e.last_edited_at ?? e.created_at}
              </span>
              <div className="resume-session-entry-actions">
                <button type="button" onClick={() => onContinue(e.filename)}>
                  Continue
                </button>
                <button
                  type="button"
                  className="resume-session-discard-btn"
                  onClick={() => onDiscard(e.filename)}
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
