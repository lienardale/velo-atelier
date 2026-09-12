"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { usePathname } from "@/lib/i18n/navigation";

/**
 * The header's navigation below the `lg` breakpoint: a 44×44 menu button that
 * opens a left-hand sheet. The sheet is a native modal `<dialog>`
 * (`showModal()`): the rest of the page is inert while it is open, so focus
 * stays inside it, Escape closes it, and focus returns to the menu button on
 * close — all without a focus-trap library.
 *
 * It closes on a backdrop click, on the close button, on any link inside it,
 * and whenever the route changes.
 */
export function MobileNav({
  title,
  openLabel,
  closeLabel,
  children,
}: {
  title: string;
  openLabel: string;
  closeLabel: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const titleId = useId();
  const pathname = usePathname();

  useEffect(() => {
    // A navigation happened (link click, back button): the sheet must not survive it.
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
  }, [pathname]);

  const openMenu = () => {
    dialogRef.current?.showModal();
    setOpen(true);
  };

  // `close()` also fires the dialog's `close` event (→ `onClose`), but that
  // event is queued; update the button state right away.
  const closeMenu = () => {
    dialogRef.current?.close();
    setOpen(false);
  };

  const onDialogClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    const target = event.target as Element;
    // The dialog box has no padding: a click whose target is the dialog itself
    // landed on the ::backdrop.
    if (target === event.currentTarget || target.closest("a[href]")) closeMenu();
  };

  return (
    <>
      <button
        type="button"
        className="tap-target -ml-2 rounded-md text-ink hover:bg-paper-2 lg:hidden"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={openMenu}
      >
        <Menu aria-hidden="true" className="size-6" />
        <span className="sr-only">{openLabel}</span>
      </button>

      <dialog
        id={dialogId}
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={onDialogClick}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none bg-paper p-0 text-ink shadow-xl backdrop:bg-black/50"
      >
        <div className="flex h-full flex-col gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between border-b border-rule pb-2">
            <p id={titleId} className="font-display text-lg font-semibold">
              {title}
            </p>
            <button
              type="button"
              className="tap-target -mr-2 rounded-md hover:bg-paper-2"
              onClick={closeMenu}
            >
              <X aria-hidden="true" className="size-6" />
              <span className="sr-only">{closeLabel}</span>
            </button>
          </div>
          <nav aria-labelledby={titleId}>{children}</nav>
        </div>
      </dialog>
    </>
  );
}
