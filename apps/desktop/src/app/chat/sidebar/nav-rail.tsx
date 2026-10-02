import { useStore } from '@nanostores/react'

import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Tip, TipHintLabel } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { formatCombo } from '@/lib/keybinds/combo'
import { cn } from '@/lib/utils'
import { recordAction } from '@/store/desktop-metrics'
import { $bindings } from '@/store/keybinds'
import { $newChatProfile } from '@/store/profile'
import { openRouteTile } from '@/store/route-tiles'

import type { AppView } from '../../routes'
import type { SidebarNavItem } from '../../types'
import { type NewSessionSplitHandler, startNewSessionDrag } from '../new-session-drag'

import { CONTEXT_SPLIT_KIT, SplitSubmenu } from './split-submenu'

// The nav destinations as a slim icon rail down the sidebar's left edge — the
// VS Code / Codex activity-bar shape: icon only, name + keybind on hover, and
// the current page marked with the kit's active treatment rather than a label.
//
// It replaces the labeled rows that used to sit ABOVE the session list: the
// rows spent ~150px of the column's height on five destinations the user picks
// once, and pushed the list (the thing they actually read) below the fold. The
// rail keeps every behaviour the rows had — click routing, the "New session"
// drag onto a chat zone, the right-click "Open in split" submenu, the recorded
// action metric, the `sidebar-nav-<id>` tour handle — and only changes how the
// five are presented.
//
// Geometry follows the terminal rail (`app/right-sidebar/terminal/rail.tsx`):
// w-9 column, size-7 squares, theme vars throughout, `placement="left-rail"`
// for the tip (a left-edge rail opens its tips to the RIGHT — see
// `TOOLTIP_PLACEMENTS`).
const RAIL_BUTTON = cn(
  'grid size-7 shrink-0 place-items-center rounded-md border border-transparent',
  'text-(--ui-text-secondary) transition-colors duration-100 ease-out',
  // no-drag: the rail sits directly under the titlebar's
  // [-webkit-app-region:drag] strips with only ~6px of clearance. Drag regions
  // win hit-testing over DOM (pointer-events cannot override), and on Linux/WSLg
  // the resolved region has been observed to swallow clicks on the top rows.
  '[-webkit-app-region:no-drag]',
  'hover:bg-(--ui-control-hover-background) hover:text-foreground hover:transition-none',
  'focus-visible:bg-(--ui-control-hover-background) focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring'
)

const RAIL_BUTTON_ACTIVE =
  'border-(--ui-stroke-tertiary) bg-(--ui-control-active-background) text-foreground shadow-none hover:border-(--ui-stroke-tertiary)!'

const RAIL_BUTTON_INERT =
  'cursor-default hover:border-transparent hover:bg-transparent hover:text-inherit'

interface SidebarNavRailProps {
  currentView: AppView
  items: readonly SidebarNavItem[]
  onNavigate: (item: SidebarNavItem) => void
  onNewSessionSplit: NewSessionSplitHandler
  pathname: string
}

export function SidebarNavRail({
  currentView,
  items,
  onNavigate,
  onNewSessionSplit,
  pathname
}: SidebarNavRailProps) {
  const { t } = useI18n()
  const s = t.sidebar
  const bindings = useStore($bindings)

  return (
    <nav
      aria-label={s.navAria}
      className={cn(
        'flex h-full w-9 shrink-0 flex-col items-center gap-0.5 self-stretch',
        'border-r border-(--ui-stroke-quaternary)',
        // Same top inset the labeled rows used: below the titlebar strip, and
        // clear of the drag region it reserves.
        'pb-2 pt-[calc(var(--titlebar-height)+0.375rem)]'
      )}
      data-tour="sidebar-nav-rail"
    >
      <ul className="flex min-h-0 flex-1 flex-col items-center gap-0.5 self-stretch overflow-y-auto overflow-x-hidden overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map(item => {
          const isInteractive = Boolean(item.action) || Boolean(item.route)

          const active =
            (item.id === 'capabilities' && currentView === 'capabilities') ||
            (item.id === 'messaging' && currentView === 'messaging') ||
            (item.id === 'artifacts' && currentView === 'artifacts') ||
            (item.id === 'cron' && currentView === 'cron') ||
            // Contributed rows light up at their own route.
            (currentView === 'extension' && Boolean(item.route) && pathname === item.route)

          const isNewSession = item.id === 'new-session'
          const label = s.nav[item.id] ?? item.label
          const hint = item.keybindActionId ? bindings[item.keybindActionId]?.[0] : undefined

          const button = (
            <Tip
              label={<TipHintLabel hint={hint && formatCombo(hint)} text={label} />}
              placement="left-rail"
            >
              <button
                aria-current={active ? 'page' : undefined}
                aria-disabled={!isInteractive}
                aria-label={label}
                className={cn(RAIL_BUTTON, active && RAIL_BUTTON_ACTIVE, !isInteractive && RAIL_BUTTON_INERT)}
                data-tour={`sidebar-nav-${item.id}`}
                onClick={() => {
                  // A plain new session lands in whatever profile the live
                  // gateway is on (= the active switcher context). null → no
                  // swap. The switcher header is the single place to change
                  // which profile that is.
                  if (isNewSession) {
                    $newChatProfile.set(null)
                  }

                  if (item.keybindActionId) {
                    recordAction(item.keybindActionId, 'click')
                  }

                  onNavigate(item)
                }}
                onPointerDown={event => {
                  // The "New session" rail button is a drag source too: drag it
                  // onto a chat zone's tab strip / edge / center to create the
                  // session exactly there (stack / split). The pointer drag
                  // session owns the gesture — a sub-threshold release falls
                  // through to the onClick above (ordinary new session), and an
                  // engaged drag suppresses that click so it never
                  // double-creates. The create callback sets $newChatProfile
                  // itself (the suppressed click cannot), so a dragged new
                  // session lands in the same profile a click would.
                  if (!isNewSession) {
                    return
                  }

                  startNewSessionDrag(placement => {
                    $newChatProfile.set(null)
                    onNewSessionSplit(placement.dir, {
                      anchor: placement.anchor,
                      before: placement.before
                    })
                  }, event)
                }}
                type="button"
              >
                <item.icon className="size-4 shrink-0" />
              </button>
            </Tip>
          )

          // New session + route-backed pages can open in a split — right-click
          // for the directional "Open in split" submenu. The trigger wraps the
          // list item (not the Tip) so `asChild` lands on a real element.
          return (
            <li className="relative flex w-full justify-center" key={item.id}>
              {isNewSession || item.route ? (
                <ContextMenu>
                  <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
                  <ContextMenuContent aria-label={label}>
                    <SplitSubmenu
                      kit={CONTEXT_SPLIT_KIT}
                      label={s.row.openInSplit}
                      onSplit={dir => {
                        if (isNewSession) {
                          onNewSessionSplit(dir)
                        } else if (item.route) {
                          openRouteTile(item.route, dir)
                        }
                      }}
                    />
                  </ContextMenuContent>
                </ContextMenu>
              ) : (
                button
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
