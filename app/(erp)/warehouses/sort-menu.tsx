"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowDownAZ, ArrowDownZA, ArrowUpDown, CalendarArrowDown, CalendarArrowUp, Check, ChevronDown, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortKey = "newest" | "oldest" | "az" | "za" | "code-az" | "code-za";

const SORTS: Array<{ group: string; options: Array<{ value: SortKey; label: string; icon: typeof ArrowDownAZ }> }> = [
  {
    group: "Date",
    options: [
      { value: "newest", label: "Newest first", icon: CalendarArrowDown },
      { value: "oldest", label: "Oldest first", icon: CalendarArrowUp },
    ],
  },
  {
    group: "Name",
    options: [
      { value: "az", label: "A to Z", icon: ArrowDownAZ },
      { value: "za", label: "Z to A", icon: ArrowDownZA },
    ],
  },
  {
    group: "Code",
    options: [
      { value: "code-az", label: "Code A to Z", icon: Hash },
      { value: "code-za", label: "Code Z to A", icon: Hash },
    ],
  },
];
const SORT_KEYS = SORTS.flatMap((g) => g.options.map((o) => o.value));

/** The sort in the address (`?sort=`), newest first when missing or unknown. */
export const parseSort = (value: string | null): SortKey => (SORT_KEYS.includes(value as SortKey) ? (value as SortKey) : "newest");

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** `rows` in the chosen order. Rows without a date go last in both date orders. */
export function sortRows<T>(rows: T[], sort: SortKey, keyOf: (row: T) => { date?: string | null; name: string; code: string }): T[] {
  const keyed = rows.map((row) => ({ row, key: keyOf(row) }));
  keyed.sort(({ key: a }, { key: b }) => {
    if (sort === "newest" || sort === "oldest") {
      if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
      return sort === "newest" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
    }
    if (sort === "az") return collator.compare(a.name, b.name) || collator.compare(a.code, b.code);
    if (sort === "za") return collator.compare(b.name, a.name) || collator.compare(b.code, a.code);
    return sort === "code-az" ? collator.compare(a.code, b.code) : collator.compare(b.code, a.code);
  });
  return keyed.map(({ row }) => row);
}

/** Sort control for the warehouse tables: by date, name (A to Z / Z to A) or code. */
export function SortMenu({ value, onChange }: { value: SortKey; onChange: (value: SortKey) => void }) {
  const current = SORTS.flatMap((g) => g.options).find((o) => o.value === value) ?? SORTS[0].options[0];
  const Icon = current.icon;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="wh-sort" aria-label={`Sort: ${current.label}`}>
          <ArrowUpDown size={14} className="text-gray-400" />
          <span className="wh-sort__label">Sort</span>
          <Icon size={14} />
          <b>{current.label}</b>
          <ChevronDown size={14} className="text-gray-400" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="wh-sort__menu">
          {SORTS.map((group, index) => (
            <DropdownMenu.Group key={group.group}>
              {index > 0 && <DropdownMenu.Separator className="wh-sort__sep" />}
              <DropdownMenu.Label className="wh-sort__group">{group.group}</DropdownMenu.Label>
              {group.options.map((option) => (
                <DropdownMenu.Item key={option.value} className={cn("wh-sort__item", option.value === value && "is-current")} onSelect={() => onChange(option.value)}>
                  <option.icon size={15} />
                  <span className="flex-1">{option.label}</span>
                  {option.value === value && <Check size={14} className="text-emerald-600" />}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
