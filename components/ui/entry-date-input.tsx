"use client";

import { forwardRef } from "react";
import { Input } from "./input";
import { rememberEntryDate } from "@/lib/entry-date";
import type { InputHTMLAttributes } from "react";

/** Choosing an actual entry date also supplies the default for the next process form. */
export const EntryDateInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  ({ onChange, ...props }, ref) => <Input {...props} ref={ref} type="date" onChange={event => { rememberEntryDate(event.target.value); onChange?.(event); }} />,
);
EntryDateInput.displayName = "EntryDateInput";
