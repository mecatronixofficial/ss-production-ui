"use client";

import { useState } from "react";
import { Plus, ReceiptText, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm-store";
import { money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardHead, Field } from "./fields";
import { localDate, numeric, shortDate, type FabricFlow } from "./types";

export function ExpenseLedger({ flow, reload }: { flow: FabricFlow; reload: () => Promise<void> }) {
  const [form, setForm] = useState({ expenseDate: localDate(), category: "Transport", description: "", amount: "" });
  const [saving, setSaving] = useState(false);
  const set = (changes: Partial<typeof form>) => setForm((current) => ({ ...current, ...changes }));

  const add = async () => {
    setSaving(true);
    try {
      await api(`/production/fabric-flows/${flow.id}/expenses`, { method: "POST", body: JSON.stringify({ ...form, amount: numeric(form.amount), description: form.description || undefined }) });
      set({ description: "", amount: "" });
      await reload();
    } finally { setSaving(false); }
  };
  const remove = async (id: string, label: string) => {
    const ok = await confirmDialog({ title: `Delete ${label} expense?`, description: "This removes the cost from this production batch.", confirmLabel: "Delete expense", tone: "danger" });
    if (!ok) return;
    await api(`/production/fabric-flows/${flow.id}/expenses/${id}`, { method: "DELETE" });
    await reload();
  };

  return <section className="production-card">
    <CardHead eyebrow="Batch expenses" title="Other production expenses" />
    <div className="production-card__body space-y-4">
      <p className="text-xs text-gray-500">Record every additional cost against this batch. Yarn and process charges are already included automatically.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date"><Input type="date" value={form.expenseDate} onChange={(e) => set({ expenseDate: e.target.value })} /></Field>
        <Field label="Category"><select className="erp-input" value={form.category} onChange={(e) => set({ category: e.target.value })}><option>Transport</option><option>Labour</option><option>Power</option><option>Packing</option><option>Repair</option><option>Testing</option><option>Other</option></select></Field>
        <Field label="Description"><Input placeholder="What was this cost for?" value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label="Amount" hint="₹"><Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
      </div>
      <Button className="w-full" disabled={saving || !form.expenseDate || !form.category || numeric(form.amount) <= 0} onClick={() => void add()}><Plus size={15} />{saving ? "Saving…" : "Add expense"}</Button>
      {flow.expenses.length > 0 && <ul className="divide-y rounded-xl border">
        {flow.expenses.map((expense) => <li key={expense.id} className="flex items-center gap-3 px-3 py-2.5">
          <ReceiptText size={15} className="shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1"><strong className="block text-sm text-gray-800">{expense.category}</strong><small className="block truncate text-gray-500">{shortDate(expense.expenseDate)}{expense.description ? ` · ${expense.description}` : ""}</small></span>
          <strong className="text-sm text-gray-900">{money(expense.amount)}</strong>
          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => void remove(expense.id, expense.category)} aria-label={`Delete ${expense.category} expense`}><Trash2 size={14} /></Button>
        </li>)}
      </ul>}
    </div>
  </section>;
}
