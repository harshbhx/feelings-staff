# Documentation index

Find the page you need. Plain-language guides for the salon come first, then the pages for whoever runs the system, then the technical reference.

## For the owner and staff

| Page | Read it when |
|---|---|
| [Owner guide](guides/owner.md) | You are Urmi: signing in, adding staff, approvals, Time credits, roll-call, payroll |
| [Staff guide](guides/staff.md) | You work at the salon: installing the app, checking in, leave, payslips |
| [FAQ](faq.md) | You want a quick answer |

## For whoever runs the system

| Page | Read it when |
|---|---|
| [Production setup guide](guides/production-setup.md) | Putting the app live for the first time: Cloudflare, secrets, domain, first sign-in, staff, phones, door code |
| [Daily and monthly operations](runbooks/operations.md) | You want the routine checks and the payroll month close |
| [Troubleshooting](runbooks/troubleshooting.md) | A person cannot check in, the location is wrong, a phone is lost, a payslip is wrong, push does not arrive |
| [Update and rollback](runbooks/update-rollback.md) | A change is going out, or must be undone |
| [Backup and restore](runbooks/backup-restore.md) | Taking, verifying or restoring a copy of the data |
| [Secrets](runbooks/secrets.md) | Rotating a secret |
| [Owner cutover](runbooks/owner-cutover.md) | Moving the owner to its own host behind Cloudflare Access, and rolling it back |
| [Incident](runbooks/incident.md) | A leak, abuse or an outage |
| [Retention purge](runbooks/retention-purge.md) | What is deleted and when, and deleting a person's data on request |
| [Ops log](ops-log.md) | Recording a manual action on production |
| [Deploy guide](deploy.md) | The full detail behind the setup guide, plus the preview environment |

## For people who change the code

| Page | What is in it |
|---|---|
| [Setup and local development](setup.md) | How to work on the code, the workflows and scripts |
| [Architecture](architecture.md) | Overview, diagrams, packages and owners |
| [API reference](api.md) | Endpoints, errors, conventions |
| [Data model](data-model.md) | Tables, retention, storage layout, migrations |
| [Decisions](decisions/README.md) | Architecture decision records |
| [Product requirements](PRD.md) | The source of truth for what the app does |
| [Brand and stack](research/brand-and-stack.md) | Brand tokens, voice and stack |
| [Domain research](research/domain.md) | Background research behind the PRD: the salon, pay, leave and attendance rules |

## Checking the links

`pnpm run check:docs` checks that every relative link and heading link in the Markdown files resolves. It reads files only and finishes in a second, so it is fine to run locally.
