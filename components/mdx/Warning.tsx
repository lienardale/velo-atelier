import { useTranslations } from "next-intl";

import { Callout, type CalloutTone } from "@/components/ui-ext/Callout";

export type WarningLevel = "info" | "caution" | "danger";

const TONES: Readonly<Record<WarningLevel, CalloutTone>> = {
  info: "info",
  caution: "warning",
  danger: "danger",
};

/**
 * `<Warning level="caution">…</Warning>` inside a guide. The level is spoken as
 * the callout title ("Attention", "Danger"), so it never depends on colour
 * alone. It is part of the page, not a reaction to an action: no `role="alert"`.
 */
export function Warning({
  level,
  children,
}: {
  level: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const t = useTranslations("guides");
  const known: WarningLevel = level === "caution" || level === "danger" ? level : "info";

  return (
    // eslint-disable-next-line security/detect-object-injection -- `known` is narrowed to WarningLevel above
    <Callout tone={TONES[known]} title={t(`warning.${known}`)} data-warning={known}>
      {children}
    </Callout>
  );
}
