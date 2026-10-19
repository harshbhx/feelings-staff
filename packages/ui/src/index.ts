/**
 * @fs/ui: the Feelings design system (PRD 12). Radix primitives restyled with the brand tokens,
 * Phosphor regular icons, Plus Jakarta Sans. Owner: WP-2.
 *
 * Styles: import '@fs/ui/styles.css' once (app/src/main.tsx does). Component strings such as
 * aria labels come from the `ui` i18n namespace; everything a user reads otherwise is a prop.
 */

export { Avatar, type AvatarProps, initials } from './components/Avatar';
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
export {
  Chip,
  type ChipCheckboxGroupProps,
  ChipGroup,
  type ChipGroupProps,
  type ChipOption,
  type ChipProps,
  type ChipRadioGroupProps,
} from './components/Chip';
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
export { List, type ListProps, ListRow, type ListRowProps } from './components/ListRow';
export { PinPad, type PinPadProps } from './components/PinPad';
export { Sheet, type SheetProps } from './components/Sheet';
export {
  Skeleton,
  SkeletonGroup,
  type SkeletonGroupProps,
  type SkeletonProps,
} from './components/Skeleton';
export {
  type DayStatus,
  STATUS_HAS_LETTER,
  STATUS_ICON,
  StatusChip,
  type StatusChipProps,
} from './components/StatusChip';
export { TabBar, TabBarItem, type TabBarItemProps, type TabBarProps } from './components/TabBar';
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
