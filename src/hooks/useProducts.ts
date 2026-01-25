/**
 * Hook for accessing product data client-side
 * Provides lookup functions and product lists for filtering and display
 */

import {
  PRODUCTS,
  PRODUCT_CATEGORIES,
  getProductById,
  getCompetitorProducts,
  getOwnProducts,
  getProductsByCategory,
  type Product,
  type ProductCategory,
  type ProductCategoryConfig,
} from '@/src/config/products';

export interface UseProductsReturn {
  /** All products */
  products: readonly Product[];
  /** All product categories */
  categories: readonly ProductCategoryConfig[];
  /** Competitor products only */
  competitors: readonly Product[];
  /** Own products (Sourcegraph, Cody) */
  ownProducts: readonly Product[];
  /** Get product display name by ID */
  getProductName: (id: string) => string;
  /** Get product category by ID */
  getProductCategory: (id: string) => ProductCategory | 'unknown';
  /** Check if product is a competitor */
  isCompetitor: (id: string) => boolean;
  /** Check if product is own product */
  isOwnProduct: (id: string) => boolean;
  /** Get product by ID */
  getProduct: (id: string) => Product | undefined;
  /** Get products by category */
  getByCategory: (category: ProductCategory) => readonly Product[];
}

/**
 * Hook for accessing product data
 * Product data is static, so no state/effects needed
 */
export function useProducts(): UseProductsReturn {
  const getProductName = (id: string): string => {
    return getProductById(id)?.name || id;
  };

  const getProductCategory = (id: string): ProductCategory | 'unknown' => {
    return getProductById(id)?.category || 'unknown';
  };

  const isCompetitor = (id: string): boolean => {
    return getProductById(id)?.isCompetitor === true;
  };

  const isOwnProduct = (id: string): boolean => {
    return getProductById(id)?.isOwnProduct === true;
  };

  return {
    products: PRODUCTS,
    categories: PRODUCT_CATEGORIES,
    competitors: getCompetitorProducts(),
    ownProducts: getOwnProducts(),
    getProductName,
    getProductCategory,
    isCompetitor,
    isOwnProduct,
    getProduct: getProductById,
    getByCategory: getProductsByCategory,
  };
}
