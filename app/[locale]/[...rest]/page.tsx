import { notFound } from "next/navigation";

/**
 * Catch-all for unknown paths under a valid locale (`/en/does-not-exist`):
 * renders `app/[locale]/not-found.tsx` inside the locale layout, with a real
 * 404 status. Without it, Next falls back to its unstyled, unlocalized 404.
 *
 * The status is only a 404 because no Suspense boundary sits between the
 * locale layout and this page: an `app/[locale]/loading.tsx` would flush the
 * shell (status 200) before `notFound()` runs — verified on Next 16.3.4, see
 * tests/e2e/smoke.spec.ts. Loading boundaries belong below the segment that
 * decides a 404.
 */
export default function UnknownPage(): never {
  notFound();
}
