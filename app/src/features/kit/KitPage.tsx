/**
 * The kit (PRD 12.6, 14.5): every @fs/ui component in its states, at 390 px and 1280 px.
 * Visual baselines and axe run against this page (e2e/tests/kit). Copy is sample copy from the PRD;
 * the page never ships to production, so it is not in the i18n catalogs.
 */
import {
  Avatar,
  Banner,
  Bindi,
  Button,
  ChipGroup,
  type DayStatus,
  EmptyState,
  Field,
  ICON_NAMES,
  Icon,
  IconButton,
  Input,
  List,
  ListRow,
  PasswordInput,
  PinPad,
  Sheet,
  Skeleton,
  SkeletonGroup,
  StatusChip,
  TabBar,
  TabBarItem,
  Textarea,
  type ToastInput,
  ToastProvider,
  useToast,
} from '@fs/ui';
import { type ReactNode, useEffect, useState } from 'react';

const STATUSES: DayStatus[] = [
  'present',
  'late',
  'half',
  'absent',
  'leave',
  'off',
  'holiday',
  'flag',
  'waiting',
  'venue',
];

const SWATCHES = [
  ['bg', '--bg'],
  ['bg-soft', '--bg-soft'],
  ['bg-tint', '--bg-tint'],
  ['bg-deep', '--bg-deep'],
  ['text', '--text'],
  ['text-body', '--text-body'],
  ['text-muted', '--text-muted'],
  ['accent', '--accent'],
  ['border', '--border'],
  ['border-strong', '--border-strong'],
  ['border-control', '--border-control'],
] as const;

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section
      data-kit-section={id}
      aria-labelledby={`kit-${id}`}
      className="grid gap-6 border-t border-border py-10"
    >
      <div className="grid max-w-[40rem] gap-1">
        <h2 id={`kit-${id}`}>{title}</h2>
        <p className="text-sm text-text-muted">{intro}</p>
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-3">
      <p className="text-xs font-semibold text-text-muted">{label}</p>
      {children}
    </div>
  );
}

/** A phone-sized frame. `transform` makes it the containing block for fixed children (sheets, bars). */
function PhoneFrame({
  label,
  children,
  onFrame,
}: {
  label: string;
  children?: ReactNode;
  onFrame?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <Specimen label={label}>
      <div
        ref={onFrame}
        className="relative h-[30rem] w-full max-w-[24.375rem] overflow-hidden rounded-lg border border-border bg-bg [transform:translateZ(0)]"
      >
        {children}
      </div>
    </Specimen>
  );
}

function StaticToast(props: ToastInput) {
  const show = useToast();
  // biome-ignore lint/correctness/useExhaustiveDependencies: show the sample once
  useEffect(() => show({ ...props, duration: Number.POSITIVE_INFINITY }), []);
  return null;
}

function Foundations() {
  return (
    <Section
      id="foundations"
      title="Foundations"
      intro="Brand tokens, Plus Jakarta Sans in four weights, Phosphor regular icons and the bindi."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <Specimen label="Semantic colours">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SWATCHES.map(([name, token]) => (
              <li key={name} className="flex items-center gap-3">
                <span
                  className="size-10 flex-none rounded-md border border-border"
                  style={{ background: `var(${token})` }}
                />
                <span className="text-sm font-semibold text-text">{name}</span>
              </li>
            ))}
          </ul>
        </Specimen>
        <Specimen label="Type">
          <div className="grid gap-3">
            <p className="text-3xl leading-tight font-extrabold tracking-h1 text-text tabular-nums">
              10:02
            </p>
            <p className="text-xl font-extrabold tracking-display text-text">
              Good morning, <em className="text-accent">Priya</em>
              <Bindi />
            </p>
            <p className="text-lg font-bold text-text">Who's in</p>
            <p>You're in since 10:02 · 3 h 14 m so far.</p>
            <p className="text-sm text-text-muted">
              Late by 25 min. 10 min grace, so 15 min count.
            </p>
            <p className="text-xs font-bold uppercase tracking-eyebrow text-text-muted">
              October payroll
            </p>
          </div>
        </Specimen>
      </div>
      <Specimen label={`Icons (${ICON_NAMES.length}, Phosphor regular)`}>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-3 gap-y-4">
          {ICON_NAMES.map((name) => (
            <li key={name} className="grid justify-items-start gap-1 text-text">
              <Icon name={name} className="size-6" />
              <span className="text-xs text-text-muted">{name}</span>
            </li>
          ))}
        </ul>
      </Specimen>
      <Specimen label="Bindi: heading full stop, nav marker, success">
        <div className="flex items-end gap-8">
          <p className="text-xl font-extrabold tracking-display text-text">
            You're in at 10:02
            <Bindi />
          </p>
          <Bindi size="marker" />
          <Bindi size="success" />
        </div>
      </Specimen>
    </Section>
  );
}

function Buttons() {
  return (
    <Section
      id="buttons"
      title="Buttons"
      intro="One sindoor button per view. Secondary is a white pill, destructive is a secondary pill with absent-red text and a confirm step."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <Specimen label="Variants, 48 px">
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" icon="sign-in">
              Check in
            </Button>
            <Button variant="secondary" icon="phone">
              Call
            </Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger-secondary">Reject</Button>
          </div>
        </Specimen>
        <Specimen label="Small, 40 px (44 px target)">
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" size="sm">
              Approve
            </Button>
            <Button variant="secondary" size="sm" icon="whatsapp-logo">
              WhatsApp
            </Button>
            <Button variant="ghost" size="sm" iconEnd="arrow-right">
              See all
            </Button>
            <Button variant="danger-secondary" size="sm">
              Revoke
            </Button>
          </div>
        </Specimen>
        <Specimen label="Loading and disabled">
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" loading loadingLabel="Checking in…">
              Check in
            </Button>
            <Button variant="primary" disabled>
              Check out
            </Button>
            <Button variant="secondary" disabled>
              Download PDF
            </Button>
          </div>
        </Specimen>
        <Specimen label="Full width, and a link drawn as a button">
          <div className="grid max-w-[24rem] gap-3">
            <Button variant="primary" block icon="sign-out">
              Check out
            </Button>
            <Button variant="secondary" block asChild icon="file-pdf">
              <a href="#kit-buttons">Download PDF</a>
            </Button>
          </div>
        </Specimen>
        <Specimen label="Icon buttons, 44 px">
          <div className="flex flex-wrap items-center gap-3">
            <IconButton icon="bell" label="Notifications" />
            <IconButton icon="bell" label="Notifications, 3 new" dot />
            <IconButton icon="x" label="Close" />
            <IconButton icon="minus" label="Fewer minutes" variant="outline" />
            <IconButton icon="plus" label="More minutes" variant="outline" />
            <IconButton icon="share-network" label="Share" disabled />
          </div>
        </Specimen>
        <Specimen label="On the maroon band">
          <div className="fs-on-deep flex flex-wrap gap-3 rounded-md bg-bg-deep p-5">
            <Button variant="primary">Done</Button>
            <Button variant="secondary">Pair this screen</Button>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

function Fields() {
  return (
    <Section
      id="fields"
      title="Fields"
      intro="Hints and errors sit above the field so the phone keyboard never covers them. Inputs are 16 px or more."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <Field label="Your name" hint="As Urmi knows you. She sees this on the register.">
          <Input defaultValue="Priya Shah" autoComplete="name" />
        </Field>
        <Field
          label="Phone number"
          error="Type the 10-digit number, without +91."
          hint="The number Urmi has for you."
        >
          <Input start="+91" inputMode="numeric" defaultValue="98765 4321" autoComplete="tel" />
        </Field>
        <Field label="Password" hint="10 characters or more.">
          <PasswordInput defaultValue="salon-2026" autoComplete="current-password" />
        </Field>
        <Field label="Join code" disabled>
          <Input defaultValue="K7Q-4MZ2P" />
        </Field>
        <Field label="Note for Urmi" optional>
          <Textarea placeholder="Stuck in traffic near J J Tower." />
        </Field>
        <Field label="Search staff" labelHidden>
          <Input type="search" placeholder="Search by name" />
        </Field>
      </div>
    </Section>
  );
}

function Chips() {
  const [filter, setFilter] = useState('present');
  return (
    <Section
      id="chips"
      title="Chips"
      intro="Real radios and checkboxes drawn as pills. Arrow keys move between radios; Space ticks a checkbox."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <ChipGroup
          legend="Show"
          layout="scroll"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'present', label: 'Present', count: 8 },
            { value: 'late', label: 'Late', count: 2 },
            { value: 'not-in', label: 'Not in yet', count: 3 },
            { value: 'leave', label: 'On leave', count: 1 },
            { value: 'off', label: 'Week off', count: 1 },
            { value: 'venue', label: 'At a venue', count: 1 },
          ]}
        />
        <ChipGroup
          type="checkbox"
          legend="What went wrong"
          hint="Pick all that apply."
          defaultValue={['missed-out']}
          options={[
            { value: 'missed-in', label: 'Missed check-in' },
            { value: 'missed-out', label: 'Missed check-out' },
            { value: 'wrong-time', label: 'Wrong time' },
            { value: 'venue', label: 'Was at a venue', disabled: true },
          ]}
        />
        <ChipGroup
          legend="Leave type"
          layout="grid"
          defaultValue="casual"
          options={[
            { value: 'casual', label: 'Casual', description: '2 days left' },
            { value: 'sick', label: 'Sick', description: '3 days left' },
            { value: 'unpaid', label: 'Unpaid', description: 'Cut from this month’s pay' },
          ]}
        />
        <ChipGroup
          legend="Mode"
          error="Choose how staff check in at the venue."
          options={[
            { value: 'gps', label: 'Location', icon: 'map-pin' },
            { value: 'qr', label: 'Door code', icon: 'qr-code' },
            { value: 'selfie', label: 'Selfie', icon: 'camera' },
          ]}
        />
      </div>
    </Section>
  );
}

function Statuses() {
  return (
    <Section
      id="status"
      title="Status"
      intro="Colour, icon and a word or letter. Never colour alone, never clickable-looking."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <Specimen label="Words">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusChip key={s} status={s} />
            ))}
          </div>
        </Specimen>
        <Specimen label="Letters (calendar and register)">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusChip key={s} status={s} variant="letter" />
            ))}
          </div>
        </Specimen>
        <Specimen label="With detail">
          <div className="flex flex-wrap gap-2">
            <StatusChip status="late" label="Late 18 m" />
            <StatusChip status="flag" label="Edge of the fence" />
            <StatusChip status="waiting" label="Waiting for Urmi" />
            <StatusChip status="venue" label="Hotel Aram" />
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

function Lists() {
  return (
    <Section
      id="lists"
      title="Lists"
      intro="Hairline rows, 56 px or taller. Avatars are initials on blush, never photos."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <Specimen label="Who's in">
          <List>
            <ListRow
              leading={<Avatar name="Priya Shah" />}
              title="Priya Shah"
              subtitle="In at 10:28 · at the salon"
              trailing={<StatusChip status="late" label="+18 m" />}
              onClick={() => undefined}
            />
            <ListRow
              leading={<Avatar name="Neha Patel" />}
              title="Neha Patel"
              subtitle="In at 09:56 · 3 h 14 m so far"
              trailing={<StatusChip status="present" />}
              onClick={() => undefined}
            />
            <ListRow
              leading={<Avatar name="Kajal Mehta" />}
              title="Kajal Mehta"
              subtitle="Hotel Aram · venue duty"
              trailing={<StatusChip status="venue" />}
              onClick={() => undefined}
            />
          </List>
        </Specimen>
        <Specimen label="Static rows with values">
          <List framed>
            <ListRow
              leading={<Icon name="currency-inr" />}
              title="March"
              subtitle="Paid 3 Apr by UPI"
              trailing="₹14,032"
            />
            <ListRow
              leading={<Icon name="calendar-check" />}
              title="Casual leave"
              subtitle="12–13 Nov · 2 days"
              trailing={<StatusChip status="waiting" />}
            />
            <ListRow
              leading={<Icon name="clock" />}
              title="Shift"
              subtitle="Full day"
              trailing="10:00–20:00"
            />
          </List>
        </Specimen>
        <Specimen label="Avatars">
          <div className="flex items-center gap-3">
            <Avatar name="Urmi" size="lg" labelled />
            <Avatar name="Priya Shah" labelled />
            <Avatar name="Neha Patel" size="sm" labelled />
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

function States() {
  return (
    <Section
      id="states"
      title="Loading, empty, banners"
      intro="Skeletons keep the final layout and breathe at most six times. Empty states are one sentence and one action."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <Specimen label="Skeleton (loading Who's in)">
          <SkeletonGroup label="Loading who's in">
            {['a', 'b', 'c'].map((k) => (
              <div key={k} className="flex items-center gap-3">
                <Skeleton shape="circle" />
                <div className="grid flex-1 gap-2">
                  <Skeleton width="55%" />
                  <Skeleton width="35%" height="0.75rem" />
                </div>
              </div>
            ))}
            <Skeleton shape="pill" width="9rem" />
          </SkeletonGroup>
        </Specimen>
        <div className="grid content-start gap-6">
          <Specimen label="Empty">
            <EmptyState>All clear. Nothing waiting.</EmptyState>
          </Specimen>
          <Specimen label="Empty with one action">
            <EmptyState
              action={
                <Button variant="secondary" size="sm" icon="plus">
                  Ask for leave
                </Button>
              }
            >
              No requests yet.
            </EmptyState>
          </Specimen>
        </div>
      </div>
      <Specimen label="Banners">
        <div className="grid gap-3">
          <Banner icon="wifi-slash" live>
            You're offline. Showing what we had at 10:05.
          </Banner>
          <Banner icon="hourglass" live>
            1 check-in is waiting to send. It goes as soon as you're online.
          </Banner>
          <Banner
            icon="arrows-clockwise"
            tone="plain"
            action={
              <Button size="sm" variant="secondary">
                Update
              </Button>
            }
          >
            A new version is ready.
          </Banner>
        </div>
      </Specimen>
    </Section>
  );
}

function Overlays() {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <Section
      id="overlays"
      title="Sheet and toast"
      intro="A bottom sheet on phones and a centred dialog from 48rem. Toasts sit above the action bar, one at a time."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <PhoneFrame label="Sheet, open (phone)" onFrame={setFrame}>
          <div className="grid gap-2 p-5">
            <p className="text-lg font-bold text-text">Today</p>
            <p className="text-sm text-text-muted">The page stays readable under the sheet.</p>
          </div>
          {frame ? (
            <Sheet
              open
              modal={false}
              noAutoFocus
              container={frame}
              title="Send to Urmi"
              description="We couldn't confirm you're at the salon."
              footer={
                <>
                  <Button variant="primary" block>
                    Send to Urmi
                  </Button>
                  <Button variant="ghost" block>
                    Cancel
                  </Button>
                </>
              }
            >
              <Field label="Note" optional>
                <Textarea defaultValue="At the bridal trial at Hotel Aram since 9." />
              </Field>
            </Sheet>
          ) : null}
        </PhoneFrame>
        <PhoneFrame label="Toast (phone)">
          <ToastProvider>
            <StaticToast title="You're in at 10:02." tone="success" />
          </ToastProvider>
          <div className="grid gap-2 p-5">
            <p className="text-lg font-bold text-text">Today</p>
            <p className="text-sm text-text-muted">One toast at a time, ink on white.</p>
          </div>
        </PhoneFrame>
      </div>
      <Specimen label="Try them">
        <div className="flex flex-wrap gap-3">
          <Sheet
            open={open}
            onOpenChange={setOpen}
            trigger={<Button variant="secondary">Open a sheet</Button>}
            title="Edit day"
            description="Urmi's change shows on Priya's day with the reason."
            footer={
              <>
                <Button variant="primary" block onClick={() => setOpen(false)}>
                  Save
                </Button>
                <Button variant="ghost" block onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </>
            }
          >
            <Field label="Reason" hint="Priya sees this.">
              <Textarea defaultValue="Was at bridal trial, I asked her to." />
            </Field>
          </Sheet>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: 'A new version is ready.',
                action: { label: 'Update', altText: 'Update the app', onClick: () => undefined },
              })
            }
          >
            Show a toast
          </Button>
        </div>
      </Specimen>
    </Section>
  );
}

function PinPads() {
  const [pin, setPin] = useState('');
  return (
    <Section
      id="pinpad"
      title="PIN pad"
      intro="A real password input behind the keys, so screen readers, keyboards and password managers work. Dots fill with sindoor."
    >
      <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-4">
        <PinPad label="Enter your PIN" value={pin} onValueChange={setPin} />
        <PinPad label="Enter your PIN" defaultValue="12" />
        <PinPad
          label="Enter your PIN"
          defaultValue="4821"
          error="That PIN didn't match. 4 tries left."
        />
        <PinPad label="Owner PIN" length={6} defaultValue="482193" disabled />
      </div>
    </Section>
  );
}

function Navigation() {
  return (
    <Section
      id="navigation"
      title="Tab bar"
      intro="Five items, icon and label. The bindi marks the active one."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <Specimen label="Staff">
          <TabBar label="Staff">
            <TabBarItem href="#kit-navigation" icon="clock" label="Today" current />
            <TabBarItem href="#kit-navigation" icon="calendar-blank" label="Month" />
            <TabBarItem href="#kit-navigation" icon="airplane-tilt" label="Requests" />
            <TabBarItem href="#kit-navigation" icon="currency-inr" label="Payslips" />
            <TabBarItem href="#kit-navigation" icon="user" label="Me" />
          </TabBar>
        </Specimen>
        <Specimen label="Owner (phone)">
          <TabBar label="Owner">
            <TabBarItem href="#kit-navigation" icon="clock" label="Today" />
            <TabBarItem
              href="#kit-navigation"
              icon="check-circle"
              label="Needs action"
              badge={3}
              current
            />
            <TabBarItem href="#kit-navigation" icon="calendar-blank" label="Register" />
            <TabBarItem href="#kit-navigation" icon="users" label="Staff" />
            <TabBarItem href="#kit-navigation" icon="gear" label="More" />
          </TabBar>
        </Specimen>
      </div>
    </Section>
  );
}

export function KitPage() {
  useEffect(() => {
    document.title = 'Kit · Feelings Staff';
  }, []);
  return (
    <ToastProvider>
      <main className="mx-auto w-[min(100%-2*var(--gutter),var(--container))] pt-10 pb-24">
        <header className="grid gap-2 pb-6">
          <h1>
            Feelings Staff kit
            <Bindi />
          </h1>
          <p className="max-w-[40rem] text-text-muted">
            Every component of @fs/ui in its states. Preview builds only.
          </p>
        </header>
        <Foundations />
        <Buttons />
        <Fields />
        <Chips />
        <Statuses />
        <Lists />
        <States />
        <Overlays />
        <PinPads />
        <Navigation />
      </main>
    </ToastProvider>
  );
}
