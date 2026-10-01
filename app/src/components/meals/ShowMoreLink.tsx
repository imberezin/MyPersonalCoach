import Link from "next/link";
import ui from "@/components/ui/ui.module.css";
import { getTranslations } from "@/i18n/server";

/**
 * "Show more": a link that looks like the secondary button. `ButtonLink` has no `scroll` prop, and
 * `scroll={false}` is what keeps the person's place on the page when the next meals load.
 */
export async function ShowMoreLink({ href }: { href: string }) {
  const t = await getTranslations("meals");
  return (
    <Link href={href} scroll={false} className={`${ui.button} ${ui.secondary}`}>
      {t("more")}
    </Link>
  );
}
