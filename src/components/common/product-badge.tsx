"use client";

import { useProducts } from "@/src/hooks/useProducts";

interface ProductBadgeProps {
  /** Product ID from the products config */
  productId: string;
  /** Optional click handler to filter by this product */
  onClick?: (productId: string) => void;
  /** Size variant */
  size?: "sm" | "md";
}

/**
 * Badge component for displaying product mentions on item cards
 * Color-coded by product type:
 * - Competitors: blue
 * - Own products (Sourcegraph/Cody): purple
 * - Other (frameworks, etc.): gray
 */
export function ProductBadge({
  productId,
  onClick,
  size = "sm",
}: ProductBadgeProps) {
  const { getProductName, isCompetitor, isOwnProduct } = useProducts();

  const name = getProductName(productId);
  const competitor = isCompetitor(productId);
  const own = isOwnProduct(productId);

  // Determine color scheme based on product type
  let colorClasses: string;
  if (own) {
    colorClasses = "bg-purple-50 text-purple-700 border-purple-200";
  } else if (competitor) {
    colorClasses = "bg-blue-50 text-blue-700 border-blue-200";
  } else {
    colorClasses = "bg-gray-100 text-gray-700 border-gray-300";
  }

  const sizeClasses =
    size === "sm" ? "text-xs px-1.5 py-0.5" : "text-sm px-2 py-1";

  const baseClasses = `inline-block rounded border font-medium ${sizeClasses} ${colorClasses}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(productId)}
        className={`${baseClasses} cursor-pointer hover:opacity-80 transition-opacity`}
        title={`Filter by ${name}`}
      >
        {name}
      </button>
    );
  }

  return (
    <span className={baseClasses} title={name}>
      {name}
    </span>
  );
}

/**
 * Component to display a list of product badges
 */
interface ProductBadgeListProps {
  /** Array of product IDs */
  productIds: string[];
  /** Optional click handler for badges */
  onProductClick?: (productId: string) => void;
  /** Size variant */
  size?: "sm" | "md";
}

export function ProductBadgeList({
  productIds,
  onProductClick,
  size = "sm",
}: ProductBadgeListProps) {
  if (!productIds || productIds.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {productIds.map((productId) => (
        <ProductBadge
          key={productId}
          productId={productId}
          onClick={onProductClick}
          size={size}
        />
      ))}
    </div>
  );
}
