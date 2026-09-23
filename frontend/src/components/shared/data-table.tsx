"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "./empty-state";
import { SearchBar } from "./search-bar";
import { TableSkeleton } from "./loading-skeleton";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Applied to both th and td — use for responsive hiding (spec §11 column priority) */
    className?: string;
    align?: "left" | "right";
  }
}

interface DataTableProps<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  data: T[] | undefined;
  getRowId: (row: T) => string;
  /** Text the search box matches against. Omit to hide search. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** Extra filter controls rendered next to the search box */
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
  isLoading?: boolean;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  /** True when page-level filters (outside the search box) are applied */
  filtersActive?: boolean;
  /** Clears page-level filters from the empty state */
  onClearFilters?: () => void;
  className?: string;
}

/** Table pattern — spec §11: sticky header, 36px rows, hover raised, no zebra, numbers right. */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  searchText,
  searchPlaceholder = "Search…",
  toolbar,
  onRowClick,
  selectedId,
  isLoading,
  pageSize = 25,
  emptyTitle = "No results",
  emptyDescription,
  filtersActive,
  onClearFilters,
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q || !searchText) return data;
    return data.filter((r) => searchText(r).toLowerCase().includes(q));
  }, [data, query, searchText]);

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (row) => getRowId(row),
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const { pageIndex } = table.getState().pagination;
  const total = rows.length;
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  const hasFilters = query.length > 0 || Boolean(filtersActive);

  return (
    <div className={cn("flex min-w-0 flex-col rounded-lg border bg-panel", className)}>
      {searchText || toolbar ? (
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          {searchText ? (
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder={searchPlaceholder}
              className="w-full sm:w-64"
            />
          ) : null}
          {toolbar}
        </div>
      ) : null}

      {isLoading ? (
        <TableSkeleton rows={8} columns={Math.min(columns.length, 6)} />
      ) : (
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-panel">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn("eyebrow h-9 px-3", meta?.align === "right" && "text-right", meta?.className)}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "group inline-flex items-center gap-1 uppercase hover:text-foreground",
                            sorted && "text-foreground",
                            meta?.align === "right" && "flex-row-reverse",
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-0 group-hover:opacity-60" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.id === selectedId ? "selected" : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter") onRowClick(row.original);
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  "h-11 hover:bg-raised data-[state=selected]:bg-brand/10",
                  onRowClick && "cursor-pointer focus-visible:bg-raised",
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta;
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "px-3 py-1.5 text-small",
                        meta?.align === "right" && "text-right tabular-nums",
                        meta?.className,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!isLoading && total === 0 ? (
        <EmptyState
          variant={hasFilters ? "filtered" : "default"}
          title={emptyTitle}
          description={emptyDescription}
          action={
            hasFilters ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery("");
                  onClearFilters?.();
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {!isLoading && total > pageSize ? (
        <div className="flex items-center justify-between border-t px-3 py-2 text-caption text-muted-foreground">
          <span className="tabular-nums">
            {from}–{to} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : !isLoading && total > 0 ? (
        <div className="border-t px-3 py-2 text-caption text-muted-foreground tabular-nums">
          {total} {total === 1 ? "row" : "rows"}
        </div>
      ) : null}
    </div>
  );
}
