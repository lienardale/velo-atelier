import type { Metadata } from "next";
import "@/styles/globals.css";

/**
 * Temporary root layout.
 *
 * The real shell is `app/[locale]/layout.tsx` (next-intl, fonts, providers,
 * skip link), written by W0-T2 — which also deletes this file. It exists only
 * so that `next build` has a root layout while `app/[locale]/page.tsx` is a
 * bare placeholder.
 */
export const metadata: Metadata = {
  title: "vélo-atelier",
  description: "Apprendre à entretenir et réparer son vélo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
