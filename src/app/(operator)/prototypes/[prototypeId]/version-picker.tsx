"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";
import { formStyles } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import styles from "./prototype.module.css";

/**
 * "Version n of m" with a picker for any other version (versions spec,
 * "Viewing an earlier version"). A GET form, so it works without JavaScript;
 * with JavaScript, choosing a version opens it at once.
 */
export function VersionPicker({ action, versions, shown, keep }: { action: string; versions: readonly number[]; shown: number; keep: Record<string, string> }) {
  const router = useRouter();
  const id = useId();
  const latest = versions.at(-1);
  return (
    <form action={action} method="get" className={styles.picker}>
      {Object.entries(keep).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <label htmlFor={id} className={styles.pickerLabel} data-version-label="">
        {`Version ${shown} of ${versions.length}`}
      </label>
      <span className={formStyles.selectWrap}>
        <select
          id={id}
          name="v"
          defaultValue={shown}
          className={[formStyles.select, formStyles.small].join(" ")}
          onChange={(event) => {
            const params = new URLSearchParams(keep);
            if (Number(event.target.value) !== latest) params.set("v", event.target.value);
            router.push(`${action}${params.size ? `?${params}` : ""}`, { scroll: false });
          }}
        >
          {[...versions].reverse().map((number) => (
            <option key={number} value={number}>
              {number === latest ? `v${number} (latest)` : `v${number}`}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={14} className={formStyles.chevron} />
      </span>
      <noscript>
        <button type="submit">Show</button>
      </noscript>
    </form>
  );
}
