import type { ReactNode } from 'react'
import type { KeyBindings } from '../api/types'
import { GESTURES, triggerLabel, useAppConfig } from '../appConfig'
import { MULTI_SELECT_KEY } from '../platform'
import { useBranding } from '../theme'
import { useAuth } from '../context/AuthContext'

// Shown in the plot area until a file and variables are picked: a quick
// tour of the site. Key labels come from the live keybindings (personal
// rebinds included) and button names from the admin's branding, so the
// guide always matches what the user will actually see.

function Keys({ children }: { children: ReactNode }) {
  return <kbd className="plot-guide-kbd">{children}</kbd>
}

function bindingLabel(bindings: KeyBindings, key: keyof KeyBindings) {
  const gesture = GESTURES.find((g) => g.key === key)!
  return triggerLabel(bindings[key], gesture.kind)
}

interface Step {
  icon: ReactNode
  title: string
  body: ReactNode
}

// Small inline icons (stroke = currentColor, so they pick up the theme).
const icon = (d: string) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const ICONS = {
  file: icon('M6 3h8l4 4v14H6zM14 3v4h4'),
  vars: icon('M4 6h16M4 12h10M4 18h6M17 15l2 2 3-4'),
  plot: icon('M3 3v18h18M7 15l4-5 3 3 5-7'),
  flag: icon('M5 21V4M5 4h11l-2 4 2 4H5'),
  tools: icon('M14 7l3-3 3 3-3 3M17 4v0M4 20l9-9M11 4l-1 4 4 1'),
  user: icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0'),
  bulk: icon('M4 5h4v4H4zM4 15h4v4H4zM11 7h9M11 17h9M5 7l1 1 2-2M5 17l1 1 2-2'),
  climo: icon('M3 17c3-6 6-6 9-2s6 4 9-2M5 9h.01M9 6h.01M13 9h.01M17 7h.01'),
}

export function PlotGuide({ roles }: { roles: string[] }) {
  const { keybindings } = useAppConfig()
  const { siteName, saveDraftLabel, publishLabel } = useBranding()
  const canEdit = roles.includes('qca')
  const kb = (key: keyof KeyBindings) => <Keys>{bindingLabel(keybindings, key)}</Keys>

  const steps: Step[] = [
    {
      icon: ICONS.file,
      title: 'Pick a file',
      body: (
        <>
          In the sidebar, choose <strong>Select ship</strong>, then <strong>Select year</strong>, then{' '}
          <strong>Select file</strong>.
        </>
      ),
    },
    {
      icon: ICONS.vars,
      title: 'Choose variables',
      body: (
        <>
          Click a variable in <strong>Variables</strong> to plot it. <Keys>{MULTI_SELECT_KEY}+click</Keys> adds
          more, <Keys>Shift+click</Keys> or drag selects a range, and <strong>Select all</strong> plots everything.
        </>
      ),
    },
    {
      icon: ICONS.plot,
      title: 'Explore the plot',
      body: (
        <ul className="plot-guide-keys">
          <li>
            {kb('x_zoom')} zoom time
          </li>
          <li>
            {kb('y_zoom')} zoom values
          </li>
          <li>
            {kb('box_zoom')} box zoom
          </li>
          <li>
            {kb('undo')} or <Keys>Right-click</Keys> undo zoom
          </li>
        </ul>
      ),
    },
    {
      icon: ICONS.climo,
      title: 'Climo & data points',
      body: (
        <>
          <strong>Show climo</strong> in the top bar overlays a dashed line of the monthly climatology.{' '}
          <strong>Show points</strong> marks every
          individual observation, which makes gaps and spikes easy to spot.
        </>
      ),
    },
    ...(canEdit
      ? [
          {
            icon: ICONS.flag,
            title: 'Flag & publish',
            body: (
              <>
                {kb('flag_select')} across points to open an edit session, then pick a flag code in the sidebar's
                flags panel. When you're done, use <strong>{saveDraftLabel}</strong> or{' '}
                <strong>{publishLabel}</strong> in the top bar. <strong>Close Session</strong> leaves without saving.
              </>
            ),
          },
          {
            icon: ICONS.bulk,
            title: 'Bulk edit',
            body: (
              <>
                Flag several variables at once: turn on <strong>Bulk edit</strong> in the top bar, tick the checkbox
                on each plot's tab you want included, then {kb('flag_select')} a time range on any of them and pick a
                flag code. It's applied to every ticked variable over that range; the button shows how many are
                selected.
              </>
            ),
          },
        ]
      : []),
    {
      icon: ICONS.tools,
      title: 'Handy tools',
      body: (
        <>
          The sidebar widgets open <strong>Audit History</strong>, <strong>Documentation</strong>,{' '}
          <strong>Keybinds</strong> and the <strong>Ship Track</strong> map. <strong>Save Image</strong> in the top
          bar exports the current plots.
        </>
      ),
    },
    {
      icon: ICONS.user,
      title: 'Make it yours',
      body: (
        <>
          On <strong>Profile</strong> you can rebind plot gestures, record your own keybinds, switch dark/light
          mode and change your photo.
        </>
      ),
    },
  ]

  return (
    <section className="plot-guide" aria-labelledby="plot-guide-title">
      <div className="plot-guide-hero">
        <p className="plot-guide-eyebrow">Getting started</p>
        <h2 id="plot-guide-title">Welcome to {siteName}</h2>
        <p className="plot-guide-lead">Select variables in the sidebar to view plots.</p>
        {!canEdit && (
          <p className="plot-guide-note">
            You have view-only access. Ask an admin for the qca role to flag and publish data.
          </p>
        )}
      </div>
      <ol className="plot-guide-steps">
        {steps.map((s, i) => (
          <li key={s.title} className="plot-guide-card" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="plot-guide-card-head">
              <span className="plot-guide-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="plot-guide-icon">{s.icon}</span>
            </div>
            <h3>{s.title}</h3>
            <div className="plot-guide-body">{s.body}</div>
          </li>
        ))}
      </ol>
    </section>
  )
}

// The guide for whoever is signed in (only rendered in the plot area's empty
// state, which always sits under AuthProvider).
export function CurrentUserPlotGuide() {
  const { roles } = useAuth()
  return <PlotGuide roles={roles} />
}
