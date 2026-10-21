/**
 * Control states (docs/ui-redesign-plan.md 5a): every role in rest, hover, pressed, focus, pending
 * and disabled. Hover, pressed and focus are forced for the baselines (e2e/tests/kit/interaction
 * spec, Chrome's forced pseudo-classes on the `data-kit-force` cells); here they show at rest.
 * Sample copy from the PRD; preview builds only, so not in the i18n catalogs.
 */
import {
  Button,
  type ButtonVariant,
  Chip,
  IconButton,
  type IconName,
  List,
  ListRow,
  RailGroup,
  RailItem,
  RailNav,
  Switch,
  TabBar,
  TabBarItem,
} from '@fs/ui';
import { type ReactNode, useState } from 'react';
import { tick } from '../../lib/haptics';
import { useAction } from '../../lib/useAction';

type Forced = 'hover' | 'active' | 'focus-visible';

const FORCED: readonly { state: Forced; label: string }[] = [
  { state: 'hover', label: 'Hover' },
  { state: 'active', label: 'Pressed' },
  { state: 'focus-visible', label: 'Focus' },
];

const BUTTONS: readonly {
  variant: ButtonVariant;
  role: string;
  label: string;
  icon?: IconName;
  reason?: string;
}[] = [
  {
    variant: 'primary',
    role: 'Primary',
    label: 'Check in',
    icon: 'sign-in',
    reason: 'Check in opens at 09:00.',
  },
  { variant: 'secondary', role: 'Secondary', label: 'Step out', icon: 'sign-out' },
  { variant: 'tertiary', role: 'Tertiary', label: 'Skip for now' },
  { variant: 'danger-secondary', role: 'Destructive', label: 'Reject', icon: 'x-circle' },
  { variant: 'danger', role: 'Destructive, armed', label: 'Remove phone', icon: 'x-circle' },
];

function Cell({ label, force, children }: { label: string; force?: Forced; children: ReactNode }) {
  return (
    <div className="grid content-start justify-items-start gap-2" data-kit-force={force}>
      <p className="text-xs font-semibold text-text-muted">{label}</p>
      {children}
    </div>
  );
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-border border-t pt-4">
      <h3>{name}</h3>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">{children}</div>
    </div>
  );
}

/**
 * A live action through useAction: a real request (the e2e spec delays it), pending ring, one
 * request for a double press, a quiet result in place and one haptic tick.
 */
function LiveAction() {
  const [done, setDone] = useState(false);
  const approve = useAction(
    async (signal) => {
      const res = await fetch('/__kit?action=ping', { signal, cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
    },
    {
      onSuccess: () => {
        setDone(true);
        tick();
      },
    },
  );
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button
        variant="primary"
        icon="check-circle"
        loading={approve.pending}
        onClick={() => void approve.run()}
        data-testid="kit-live-action"
      >
        Approve
      </Button>
      <p role="status" className="text-sm text-text-body">
        {done
          ? 'Approved. Priya can check in now.'
          : approve.error
            ? 'That did not go through. Try again.'
            : ''}
      </p>
    </div>
  );
}

export function ControlStates({ section }: { section: (children: ReactNode) => ReactNode }) {
  return section(
    <div className="grid gap-6">
      <Row name="Live: press, pending, result">
        <LiveAction />
      </Row>
      {BUTTONS.map((b) => (
        <Row key={b.variant} name={b.role}>
          <Cell label="Rest">
            <Button variant={b.variant} icon={b.icon}>
              {b.label}
            </Button>
          </Cell>
          {FORCED.map((f) => (
            <Cell key={f.state} label={f.label} force={f.state}>
              <Button variant={b.variant} icon={b.icon}>
                {b.label}
              </Button>
            </Cell>
          ))}
          <Cell label="Pending">
            <Button variant={b.variant} icon={b.icon} loading>
              {b.label}
            </Button>
          </Cell>
          <Cell label="Disabled">
            <div>
              <Button
                variant={b.variant}
                icon={b.icon}
                disabledReason={b.reason ?? 'Ask Urmi first.'}
              >
                {b.label}
              </Button>
            </div>
          </Cell>
        </Row>
      ))}

      <Row name="Chip">
        <Cell label="Rest">
          <Chip type="checkbox" value="rest" label="Late" count={3} />
        </Cell>
        {FORCED.map((f) => (
          <Cell key={f.state} label={f.label} force={f.state}>
            <Chip type="checkbox" value={f.state} label="Late" count={3} />
          </Cell>
        ))}
        <Cell label="Selected">
          <Chip type="checkbox" value="on" label="Late" count={3} defaultChecked />
        </Cell>
        <Cell label="Disabled">
          <Chip type="checkbox" value="off" label="Late" count={3} disabled />
        </Cell>
      </Row>

      <Row name="Row">
        {[{ label: 'Rest' }, ...FORCED].map((f) => (
          <Cell
            key={f.label}
            label={f.label}
            force={'state' in f ? (f.state as Forced) : undefined}
          >
            <List className="w-[17rem]">
              <ListRow
                title="Priya Solanki"
                subtitle="In 10:02, 40 m so far"
                onClick={() => undefined}
              />
            </List>
          </Cell>
        ))}
      </Row>

      <Row name="Toggle">
        {[{ label: 'Off' }, ...FORCED].map((f) => (
          <Cell
            key={f.label}
            label={f.label}
            force={'state' in f ? (f.state as Forced) : undefined}
          >
            <Switch label="Selfie on check-in: off" className="w-[15rem]" />
          </Cell>
        ))}
        <Cell label="On">
          <Switch label="Selfie on check-in: on" defaultChecked className="w-[15rem]" />
        </Cell>
        <Cell label="Disabled">
          <Switch label="Selfie on check-in: off" disabled className="w-[15rem]" />
        </Cell>
      </Row>

      <Row name="Nav (tab bar, rail) and the sheet close">
        {[{ label: 'Rest' }, ...FORCED].map((f) => (
          <Cell
            key={f.label}
            label={f.label}
            force={'state' in f ? (f.state as Forced) : undefined}
          >
            <div className="flex items-center gap-4">
              <TabBar label={`Tabs, ${f.label}`} className="w-[5.5rem] border-t-0">
                <TabBarItem icon="calendar-blank" label="Month" href="#month" />
              </TabBar>
              <RailNav label={`Rail, ${f.label}`} className="w-[11rem]">
                <RailGroup>
                  <RailItem icon="users" label="Staff" href="#staff" />
                </RailGroup>
              </RailNav>
              <IconButton icon="x" label={`Close, ${f.label}`} className="fs-sheet__close" />
            </div>
          </Cell>
        ))}
        <Cell label="Current, badge">
          <div className="flex items-center gap-4">
            <TabBar label="Tabs, current" className="w-[5.5rem] border-t-0">
              <TabBarItem icon="warning-circle" label="Actions" href="#actions" current badge={9} />
            </TabBar>
            <RailNav label="Rail, current" className="w-[11rem]">
              <RailGroup>
                <RailItem
                  icon="warning-circle"
                  label="Needs action"
                  href="#actions"
                  current
                  badge={9}
                />
              </RailGroup>
            </RailNav>
          </div>
        </Cell>
      </Row>
    </div>,
  );
}
