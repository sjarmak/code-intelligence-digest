"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, X, Filter } from "lucide-react";
import { useProducts } from "@/src/hooks/useProducts";

/**
 * State for product filtering
 */
export interface ProductFilterState {
  /** Product IDs to filter TO (only show items mentioning these) */
  selectedProducts: Set<string>;
  /** Product IDs to filter OUT (exclude items mentioning these) */
  excludedProducts: Set<string>;
  /** Only show items mentioning competitor products */
  competitorsOnly: boolean;
  /** Exclude items mentioning own products (Sourcegraph/Cody) */
  excludeOwn: boolean;
}

/**
 * Create empty/default filter state
 */
export function createEmptyProductFilter(): ProductFilterState {
  return {
    selectedProducts: new Set(),
    excludedProducts: new Set(),
    competitorsOnly: false,
    excludeOwn: false,
  };
}

/**
 * Check if any filters are active
 */
export function hasActiveFilters(state: ProductFilterState): boolean {
  return (
    state.selectedProducts.size > 0 ||
    state.excludedProducts.size > 0 ||
    state.competitorsOnly ||
    state.excludeOwn
  );
}

/**
 * Count active filters
 */
export function countActiveFilters(state: ProductFilterState): number {
  let count = 0;
  if (state.selectedProducts.size > 0) count++;
  if (state.excludedProducts.size > 0) count++;
  if (state.competitorsOnly) count++;
  if (state.excludeOwn) count++;
  return count;
}

interface ProductFilterProps {
  value: ProductFilterState;
  onChange: (state: ProductFilterState) => void;
  /** Products available in current results (for showing relevant options) */
  availableProducts?: Array<{ id: string; name: string; category: string }>;
  disabled?: boolean;
}

/**
 * Product filter component with collapsible panel
 * Features:
 * - Multi-select for include/exclude products
 * - Toggle switches for competitors only / exclude own
 * - Active filter count badge
 * - Clear all button
 */
export function ProductFilter({
  value,
  onChange,
  availableProducts,
  disabled = false,
}: ProductFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { products, competitors, getProductName } = useProducts();

  const activeCount = countActiveFilters(value);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleToggleProduct = (
    productId: string,
    list: "selected" | "excluded",
  ) => {
    const newState = { ...value };
    const targetSet =
      list === "selected"
        ? newState.selectedProducts
        : newState.excludedProducts;
    const otherSet =
      list === "selected"
        ? newState.excludedProducts
        : newState.selectedProducts;

    const newTargetSet = new Set(targetSet);
    const newOtherSet = new Set(otherSet);

    if (newTargetSet.has(productId)) {
      newTargetSet.delete(productId);
    } else {
      newTargetSet.add(productId);
      // Remove from other set if present (can't include and exclude same product)
      newOtherSet.delete(productId);
    }

    if (list === "selected") {
      newState.selectedProducts = newTargetSet;
      newState.excludedProducts = newOtherSet;
    } else {
      newState.excludedProducts = newTargetSet;
      newState.selectedProducts = newOtherSet;
    }

    onChange(newState);
  };

  const handleToggleCompetitorsOnly = () => {
    onChange({
      ...value,
      competitorsOnly: !value.competitorsOnly,
    });
  };

  const handleToggleExcludeOwn = () => {
    onChange({
      ...value,
      excludeOwn: !value.excludeOwn,
    });
  };

  const handleClearAll = () => {
    onChange(createEmptyProductFilter());
  };

  // Always show all products for filtering (not just those in current results)
  const displayProducts = products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
  }));

  return (
    <div ref={panelRef} className="relative">
      {/* Toggle Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors border ${
          activeCount > 0
            ? "bg-black text-white border-black"
            : "bg-white border-gray-300 text-black hover:bg-gray-50"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <Filter className="w-4 h-4" />
        <span className="hidden sm:inline">Products</span>
        {activeCount > 0 && (
          <span
            className={`px-1.5 py-0.5 rounded-full text-xs ${
              activeCount > 0
                ? "bg-white text-black"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            {activeCount}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                Filter by Products
              </h3>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Clear all
                </button>
              )}
            </div>

            {/* Quick Toggles */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.competitorsOnly}
                  onChange={handleToggleCompetitorsOnly}
                  disabled={disabled}
                  className="rounded border-gray-300 text-black focus:ring-black accent-black"
                />
                <span className="text-sm text-gray-700">Competitors only</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.excludeOwn}
                  onChange={handleToggleExcludeOwn}
                  disabled={disabled}
                  className="rounded border-gray-300 text-black focus:ring-black accent-black"
                />
                <span className="text-sm text-gray-700">
                  Exclude Sourcegraph/Cody
                </span>
              </label>
            </div>

            {/* Divider */}
            <hr className="border-gray-200" />

            {/* Include Products */}
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Include Products
              </h4>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {displayProducts.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">
                    No products detected in results
                  </p>
                ) : (
                  displayProducts.map((product) => (
                    <label
                      key={`include-${product.id}`}
                      className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={value.selectedProducts.has(product.id)}
                        onChange={() =>
                          handleToggleProduct(product.id, "selected")
                        }
                        disabled={disabled}
                        className="rounded border-gray-300 text-black focus:ring-black accent-black"
                      />
                      <span className="text-sm text-gray-700">
                        {product.name}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Exclude Products */}
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Exclude Products
              </h4>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {displayProducts.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">
                    No products detected in results
                  </p>
                ) : (
                  displayProducts.map((product) => (
                    <label
                      key={`exclude-${product.id}`}
                      className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={value.excludedProducts.has(product.id)}
                        onChange={() =>
                          handleToggleProduct(product.id, "excluded")
                        }
                        disabled={disabled}
                        className="rounded border-gray-300 text-black focus:ring-black accent-black"
                      />
                      <span className="text-sm text-gray-700">
                        {product.name}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Selected Summary */}
            {(value.selectedProducts.size > 0 ||
              value.excludedProducts.size > 0) && (
              <>
                <hr className="border-gray-200" />
                <div className="text-xs text-gray-500">
                  {value.selectedProducts.size > 0 && (
                    <p>
                      Including:{" "}
                      {Array.from(value.selectedProducts)
                        .map((id) => getProductName(id))
                        .join(", ")}
                    </p>
                  )}
                  {value.excludedProducts.size > 0 && (
                    <p>
                      Excluding:{" "}
                      {Array.from(value.excludedProducts)
                        .map((id) => getProductName(id))
                        .join(", ")}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mobile-friendly version of product filter
 * Full-width dropdown style matching other mobile filters
 */
interface MobileProductFilterProps {
  value: ProductFilterState;
  onChange: (state: ProductFilterState) => void;
  availableProducts?: Array<{ id: string; name: string; category: string }>;
  disabled?: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

export function MobileProductFilter({
  value,
  onChange,
  availableProducts,
  disabled = false,
  isOpen,
  onToggle,
}: MobileProductFilterProps) {
  const { products, getProductName } = useProducts();
  const activeCount = countActiveFilters(value);

  const handleToggleProduct = (
    productId: string,
    list: "selected" | "excluded",
  ) => {
    const newState = { ...value };
    const targetSet =
      list === "selected"
        ? newState.selectedProducts
        : newState.excludedProducts;
    const otherSet =
      list === "selected"
        ? newState.excludedProducts
        : newState.selectedProducts;

    const newTargetSet = new Set(targetSet);
    const newOtherSet = new Set(otherSet);

    if (newTargetSet.has(productId)) {
      newTargetSet.delete(productId);
    } else {
      newTargetSet.add(productId);
      newOtherSet.delete(productId);
    }

    if (list === "selected") {
      newState.selectedProducts = newTargetSet;
      newState.excludedProducts = newOtherSet;
    } else {
      newState.excludedProducts = newTargetSet;
      newState.selectedProducts = newOtherSet;
    }

    onChange(newState);
  };

  // Always show all products for filtering (not just those in current results)
  const displayProducts = products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
  }));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium"
      >
        <span className="truncate flex items-center gap-2">
          <Filter className="w-4 h-4" />
          Products {activeCount > 0 && `(${activeCount})`}
        </span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-30 max-h-80 overflow-y-auto">
          <div className="p-3 space-y-3">
            {/* Quick Toggles */}
            <label className="flex items-center gap-2 cursor-pointer px-2 py-1">
              <input
                type="checkbox"
                checked={value.competitorsOnly}
                onChange={() =>
                  onChange({
                    ...value,
                    competitorsOnly: !value.competitorsOnly,
                  })
                }
                disabled={disabled}
                className="rounded border-gray-300 text-black focus:ring-black accent-black"
              />
              <span className="text-sm">Competitors only</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer px-2 py-1">
              <input
                type="checkbox"
                checked={value.excludeOwn}
                onChange={() =>
                  onChange({ ...value, excludeOwn: !value.excludeOwn })
                }
                disabled={disabled}
                className="rounded border-gray-300 text-black focus:ring-black accent-black"
              />
              <span className="text-sm">Exclude Sourcegraph/Cody</span>
            </label>

            <hr className="border-gray-200" />

            {/* Products List */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">
                Filter by product
              </p>
              {displayProducts.map((product) => (
                <label
                  key={product.id}
                  className="flex items-center gap-2 cursor-pointer px-2 py-1.5 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={value.selectedProducts.has(product.id)}
                    onChange={() => handleToggleProduct(product.id, "selected")}
                    disabled={disabled}
                    className="rounded border-gray-300 text-black focus:ring-black accent-black"
                  />
                  <span className="text-sm">{product.name}</span>
                </label>
              ))}
            </div>

            {/* Clear Button */}
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => onChange(createEmptyProductFilter())}
                className="w-full text-center text-sm text-gray-500 hover:text-gray-700 py-2"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
