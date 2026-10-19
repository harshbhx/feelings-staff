import { type HTMLAttributes, type ReactNode, useId } from 'react';
import { cx } from '../lib/cx';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** An h2 (or `headingLevel`) in the card's header. Without it the card has no header. */
  title?: ReactNode;
  headingLevel?: 2 | 3 | undefined;
  /** A muted line under the title. */
  description?: ReactNode;
  /** One small action at the header's end (a ghost button or a link). */
  action?: ReactNode;
  /** A hairline-topped strip at the bottom (totals, a secondary action). */
  footer?: ReactNode;
  /** `plain` (white, default) or `soft` (blush, for a grouped surface). */
  tone?: 'plain' | 'soft' | undefined;
  /** No body padding: a `List` inside runs edge to edge with its rows padded to the card. */
  flush?: boolean | undefined;
  children?: ReactNode;
}

/**
 * A grouped surface (PRD 12.5): white, 1 px hairline, 12 px corners, no shadow. A `section`
 * labelled by its title when it has one.
 */
export function Card({
  title,
  headingLevel = 2,
  description,
  action,
  footer,
  tone = 'plain',
  flush = false,
  className,
  children,
  ...rest
}: CardProps) {
  const id = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section
      className={cx('fs-card', className)}
      data-tone={tone}
      data-flush={flush ? '' : undefined}
      aria-labelledby={title ? id : undefined}
      {...rest}
    >
      {title || action ? (
        <header className="fs-card__header">
          <div className="fs-card__titles">
            {title ? (
              <Heading id={id} className="fs-card__title">
                {title}
              </Heading>
            ) : null}
            {description ? <p className="fs-card__desc">{description}</p> : null}
          </div>
          {action ? <div className="fs-card__action">{action}</div> : null}
        </header>
      ) : null}
      {children !== undefined ? <div className="fs-card__body">{children}</div> : null}
      {footer ? <div className="fs-card__footer">{footer}</div> : null}
    </section>
  );
}
