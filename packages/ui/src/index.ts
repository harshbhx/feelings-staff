/**
 * @fs/ui: the Feelings design system (PRD 12). Radix primitives restyled with the brand tokens,
 * Phosphor regular icons, Plus Jakarta Sans. Owner: WP-2.
 *
 * Styles: import '@fs/ui/styles.css' once (app/src/main.tsx does). Component strings such as
 * aria labels come from the `ui` i18n namespace; everything a user reads otherwise is a prop.
 */

export { Avatar, type AvatarProps, initials } from './components/Avatar';
export { Badge, type BadgeProps, type BadgeTone } from './components/Badge';
export { Banner, type BannerProps } from './components/Banner';
export { Bindi, type BindiProps, type BindiSize } from './components/Bindi';
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  IconButton,
  type IconButtonProps,
} from './components/Button';
export { Card, type CardProps } from './components/Card';
export {
  Chip,
  type ChipCheckboxGroupProps,
  ChipGroup,
  type ChipGroupProps,
  type ChipOption,
  type ChipProps,
  type ChipRadioGroupProps,
} from './components/Chip';
export {
  Checkbox,
  type CheckboxProps,
  RadioGroup,
  type RadioGroupProps,
  type RadioOption,
  Switch,
  type SwitchProps,
} from './components/Choice';
export { EmptyState, type EmptyStateProps } from './components/EmptyState';
export {
  Field,
  FieldError,
  type FieldProps,
  Input,
  type InputProps,
  PasswordInput,
  type PasswordInputProps,
  Textarea,
  type TextareaProps,
  useFieldContext,
} from './components/Field';
export {
  CodeField,
  type CodeFieldProps,
  formatIndianMobile,
  formatJoinCode,
  normaliseJoinCode,
  PhoneField,
  type PhoneFieldProps,
  parseTime24,
  TimeField,
  type TimeFieldProps,
} from './components/FormattedInputs';
export { List, type ListProps, ListRow, type ListRowProps } from './components/ListRow';
export { PinPad, type PinPadProps } from './components/PinPad';
export { Popover, type PopoverProps, Tooltip, type TooltipProps } from './components/Popover';
export {
  type ProgressSegment,
  ProgressStrip,
  type ProgressStripProps,
} from './components/ProgressStrip';
export {
  RailGroup,
  type RailGroupProps,
  RailItem,
  type RailItemProps,
  RailNav,
  type RailNavProps,
} from './components/Rail';
export { Select, type SelectOption, type SelectProps } from './components/Select';
export { Sheet, type SheetProps } from './components/Sheet';
export {
  type ShiftSpan,
  ShiftTimeline,
  type ShiftTimelineProps,
} from './components/ShiftTimeline';
export {
  Skeleton,
  SkeletonGroup,
  type SkeletonGroupProps,
  SkeletonList,
  type SkeletonListProps,
  type SkeletonProps,
} from './components/Skeleton';
export {
  StatChipGroup,
  type StatChipGroupProps,
  type StatOption,
  type StatTone,
} from './components/StatChip';
export {
  type DayStatus,
  STATUS_HAS_LETTER,
  STATUS_ICON,
  StatusChip,
  type StatusChipProps,
} from './components/StatusChip';
export { Stepper, type StepperProps } from './components/Stepper';
export { TabBar, TabBarItem, type TabBarItemProps, type TabBarProps } from './components/TabBar';
export { type TabItem, Tabs, type TabsProps } from './components/Tabs';
export {
  Toast,
  type ToastAction,
  type ToastInput,
  type ToastProps,
  ToastProvider,
  type ToastProviderProps,
  type ToastTone,
  useToast,
} from './components/Toast';
export { ICON_NAMES, Icon, type IconName, type IconProps } from './icons/Icon';
export { cx } from './lib/cx';
export { hapticTick, prefersReducedMotion } from './lib/motion';
