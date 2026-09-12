/**
 * Locale-aware navigation APIs, bound to `routing`.
 *
 * ALWAYS import `Link`, `redirect`, `permanentRedirect`, `usePathname`,
 * `useRouter` and `getPathname` from here — never from `next/link` or
 * `next/navigation`. These take the internal pathname key of
 * `routing.pathnames` (`/velo/[id]`) plus `params`, and produce the localized,
 * locale-prefixed URL (`/en/bike/demo`).
 *
 * Tests: `tests/setup.ts` mocks this module globally (the tagged
 * `I18N_REDIRECT` error, a plain `<a>` Link). A test that needs the real URL
 * mapping calls `vi.unmock("@/lib/i18n/navigation")`.
 */
import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

export const { Link, redirect, permanentRedirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
