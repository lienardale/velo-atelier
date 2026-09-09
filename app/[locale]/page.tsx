/**
 * Placeholder home page.
 *
 * W0-T2 replaces this with the real localized shell (`setRequestLocale`,
 * `hasLocale` guard, decision-tree Suspense boundary). Nothing here may be
 * relied upon: it exists so the scaffold builds and CI has something to render.
 */
export default async function LocaleHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">vélo-atelier</h1>
      <p>Scaffold placeholder — locale: {locale}</p>
    </main>
  );
}
