# Status chips and hard-coded colors

Most screens pick up the new theme automatically from the CSS variables. A few places use
fixed Tailwind colors; switch them so all states follow the Nexus rule:
orange = waiting on someone, teal = done, red = refunded or disputed, grey = closed.

| State | Classes |
|---|---|
| CREATED, ACCEPTED, FUNDED, PAID | `border-accent/40 bg-accent/10 text-accent` |
| COMPLETED | `border-primary/40 bg-primary/10 text-primary` |
| REFUNDED, DISPUTED | `border-destructive/40 bg-destructive/10 text-destructive` |
| CLOSED | `border-border bg-secondary text-muted-foreground` |

Replace these fixed classes wherever they appear in src/ (search for them):
| Find | Replace with |
|---|---|
| `bg-emerald-50`, `dark:bg-emerald-950/40` | `bg-primary/10` |
| `border-emerald-300`, `dark:border-emerald-700` | `border-primary/40` |
| `text-emerald-800`, `dark:text-emerald-200` | `text-primary` |
| `text-green-500`, `text-green-600` | `text-primary` |
| `bg-green-500` (online dot) | `bg-primary` |
| `bg-amber-100`, `bg-amber-500/10`, `dark:bg-amber-900/40` | `bg-accent/10` |
| `border-amber-500`, `border-amber-500/50` | `border-accent/40` |
| `text-amber-400/500/600/700`, `dark:text-amber-400` | `text-accent` |
| `fill-amber-400` (rating stars) | keep as is |

Headings on inside pages (Offers, Trade, Profile, Disputes): add `font-display`.
