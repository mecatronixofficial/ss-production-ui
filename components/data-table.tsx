"use client";
import { useState } from "react";
import {
  type ColumnDef,
  type Row,
  type Table,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * "#" column numbered by *display* position, so numbering stays 1..n after
 * sorting, filtering and paging (row.index is the original data index).
 */
export function serialColumn<T>(): ColumnDef<T> {
  return {
    header: "#",
    id: "serial",
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ row, table }: { row: Row<T>; table: Table<T> }) => {
      const { pageIndex, pageSize } = table.getState().pagination;
      const position = table.getRowModel().rows.findIndex((r) => r.id === row.id);
      return <span className="text-gray-400">{pageIndex * pageSize + position + 1}</span>;
    },
  };
}

/** Columns opt into right alignment (numbers) with `meta: { align: "right" }`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const alignOf = (def: ColumnDef<any, any>) => (def.meta as { align?: "left" | "right" } | undefined)?.align;

export function DataTable<T>({
  columns,
  data,
  searchPlaceholder = "Search...",
  filter: controlledFilter,
  onFilterChange,
  hideSearch = false,
  emptyTitle = "No records found",
  emptyDescription,
  minWidth = 800,
  pageSize = 10,
  getRowId,
  showFooter = false,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  data: T[];
  searchPlaceholder?: string;
  filter?: string;
  onFilterChange?: (value: string) => void;
  hideSearch?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  minWidth?: number;
  pageSize?: number;
  getRowId?: (row: T) => string;
  /** Renders each column's `footer` (e.g. totals) below the rows. */
  showFooter?: boolean;
}) {
  const [internalFilter, setInternalFilter] = useState("");
  const filter = controlledFilter ?? internalFilter;
  const setFilter = onFilterChange ?? setInternalFilter;
  const table = useReactTable({
    data,
    columns,
    state: { globalFilter: filter },
    onGlobalFilterChange: setFilter,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: true,
    initialState: { pagination: { pageSize } },
  });
  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination;

  return (
    <div>
      {!hideSearch && (
        <div className="mb-4 flex max-w-sm items-center gap-2">
          <Search className="text-gray-400" size={17} aria-hidden />
          <Input
            placeholder={searchPlaceholder}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={searchPlaceholder}
          />
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const label = flexRender(h.column.columnDef.header, h.getContext());
                  return (
                    <th
                      key={h.id}
                      className={cn("px-4 py-3 font-semibold", alignOf(h.column.columnDef) === "right" && "text-right")}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    >
                      {h.isPlaceholder ? null : h.column.getCanSort() ? (
                        <button
                          type="button"
                          className={cn(
                            "flex items-center gap-1 uppercase hover:text-gray-800",
                            alignOf(h.column.columnDef) === "right" && "ml-auto flex-row-reverse",
                          )}
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {label}
                          {sorted === "asc" ? (
                            <ArrowUp size={12} />
                          ) : sorted === "desc" ? (
                            <ArrowDown size={12} />
                          ) : (
                            <ArrowUpDown size={12} className="opacity-50" />
                          )}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="bg-white hover:bg-gray-50/70">
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className={cn("px-4 py-3.5", alignOf(c.column.columnDef) === "right" && "text-right tabular-nums")}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr className="bg-white">
                <td colSpan={table.getVisibleLeafColumns().length} className="px-4 py-12 text-center">
                  <Inbox className="mx-auto mb-2 text-gray-300" size={26} />
                  <p className="font-semibold text-gray-600">{filter ? "No matching records" : emptyTitle}</p>
                  {(filter || emptyDescription) && (
                    <p className="mt-1 text-xs text-gray-400">
                      {filter ? `Nothing matches “${filter}”.` : emptyDescription}
                    </p>
                  )}
                </td>
              </tr>
            )}
          </tbody>
          {showFooter && filteredCount > 0 && (
            <tfoot className="dt-footer border-t-2 border-gray-200 bg-gray-50 text-sm font-semibold text-gray-800">
              {table.getFooterGroups().map((fg) => (
                <tr key={fg.id}>
                  {fg.headers.map((h) => (
                    <td key={h.id} className={cn("px-4 py-3", alignOf(h.column.columnDef) === "right" && "text-right tabular-nums")}>
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.footer, h.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
      <div className="dt-pagination mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
        <span>
          {filteredCount === 0
            ? "0 records"
            : `Showing ${pageIndex * currentPageSize + 1}–${Math.min((pageIndex + 1) * currentPageSize, filteredCount)} of ${filteredCount}`}
        </span>
        <div className="flex items-center gap-2">
          <select
            className={cn("erp-input h-9 w-auto py-0 pr-8 text-xs")}
            value={currentPageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
          <span className="dt-page-info">
            Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="dt-page-btn"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="dt-page-btn"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Next page"
          >
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>
    </div>
  );
}
