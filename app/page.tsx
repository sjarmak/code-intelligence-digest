"use client";

import { Suspense, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ItemsGrid, { AvailableProduct } from "@/src/components/feeds/items-grid";
import SearchPage from "@/src/components/search/search-page";
import QAPage from "@/src/components/qa/qa-page";
import StarredItems from "@/src/components/feeds/starred-items";
import { useAppConfig } from "@/src/hooks/useAppConfig";
import {
  ProductFilter,
  MobileProductFilter,
  ProductFilterState,
  createEmptyProductFilter,
} from "@/src/components/filters/product-filter";
import { AccountBadge } from "@/src/components/account/account-badge";

export const dynamic = "force-dynamic";

type Period = "day" | "week" | "month" | "all";
type TabType = "resources" | "search" | "ask" | "starred";

function Loading() {
  return <div className="text-center py-12 text-muted">Loading...</div>;
}

export default function Home() {
  const { config } = useAppConfig();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("week");
  const [activeCategory, setActiveCategory] = useState<string>("newsletters");
  const [activeTab, setActiveTab] = useState<TabType>("resources");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileCategoryOpen, setMobileCategoryOpen] = useState(false);
  const [mobilePeriodOpen, setMobilePeriodOpen] = useState(false);
  const [mobileProductFilterOpen, setMobileProductFilterOpen] = useState(false);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  // Research: filter by when indexed (ADS sync) vs paper publication date
  const [researchDateFilter, setResearchDateFilter] = useState<
    "indexed" | "published"
  >("indexed");

  // Product filtering state
  const [productFilter, setProductFilter] = useState<ProductFilterState>(
    createEmptyProductFilter(),
  );
  const [availableProducts, setAvailableProducts] = useState<
    AvailableProduct[]
  >([]);

  // Handle quick filter from clicking product badge
  const handleProductClick = useCallback((productId: string) => {
    setProductFilter((prev) => {
      const newSelected = new Set(prev.selectedProducts);
      if (newSelected.has(productId)) {
        newSelected.delete(productId);
      } else {
        newSelected.add(productId);
      }
      return { ...prev, selectedProducts: newSelected };
    });
  }, []);

  // Reset product filter when category changes
  const handleCategoryChange = useCallback((categoryId: string) => {
    setActiveCategory(categoryId);
    setProductFilter(createEmptyProductFilter());
    setAvailableProducts([]);
  }, []);

  const handleNavigation = (path: string) => {
    setNavigatingTo(path);
    router.push(path);
    // Reset loading state after navigation (component may unmount, but this handles edge cases)
    setTimeout(() => setNavigatingTo(null), 3000);
  };

  const categories = [
    { id: "newsletters", label: "Newsletters" },
    { id: "podcasts", label: "Podcasts" },
    { id: "tech_articles", label: "Tech Articles" },
    { id: "ai_news", label: "AI News" },
    { id: "ai_dev", label: "AI Dev" },
    { id: "product_news", label: "Product News" },
    { id: "community", label: "Community" },
    { id: "research", label: "Research" },
    { id: "marketing", label: "Marketing" },
  ];

  const periods = [
    { id: "day", label: "Daily" },
    { id: "week", label: "Weekly" },
    { id: "month", label: "Monthly" },
    { id: "all", label: "All-time" },
  ];

  const getCategoryLabel = (id: string) =>
    categories.find((c) => c.id === id)?.label || id;
  const getPeriodLabel = (id: string) =>
    periods.find((p) => p.id === id)?.label || id;

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Header */}
      <header className="border-b border-surface-border sticky top-0 z-20 bg-surface w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex justify-between items-center">
            {/* Title */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 sm:gap-3">
                <h1 className="text-xl sm:text-3xl font-bold truncate">
                  Code Intelligence Digest
                </h1>
                <img
                  src="/icons/cid_book_prompt.svg"
                  alt=""
                  className="h-8 w-8 sm:h-10 sm:w-10 shrink-0"
                />
              </div>
              <p className="text-muted mt-1 sm:mt-2 text-sm sm:text-base hidden sm:block">
                Daily, weekly, and monthly digests of code intelligence, tools,
                and AI agents
              </p>
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-md hover:bg-gray-100 ml-2"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : (
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              )}
            </button>

            {/* Account (multi-account testing) + Sign out */}
            <AccountBadge />
            {/* Settings icon - only in dev (desktop) */}
            {config.adminUIEnabled && (
              <a
                href="/admin"
                className="hidden md:block p-1 rounded-md transition-colors hover:bg-gray-100 ml-4"
                title="Manage relevance tuning and content sync"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-surface-border bg-surface">
            <nav className="px-4 py-2 space-y-1">
              <button
                onClick={() => {
                  setActiveTab("resources");
                  setMobileMenuOpen(false);
                }}
                className={`block w-full text-left px-3 py-2 rounded-md text-sm font-medium ${
                  activeTab === "resources"
                    ? "bg-black text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                Resources
              </button>
              <button
                onClick={() => {
                  setActiveTab("search");
                  setMobileMenuOpen(false);
                }}
                className={`block w-full text-left px-3 py-2 rounded-md text-sm font-medium ${
                  activeTab === "search"
                    ? "bg-black text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                Search
              </button>
              <button
                onClick={() => {
                  setActiveTab("ask");
                  setMobileMenuOpen(false);
                }}
                className={`block w-full text-left px-3 py-2 rounded-md text-sm font-medium ${
                  activeTab === "ask"
                    ? "bg-black text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                Ask
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleNavigation("/digest");
                }}
                disabled={navigatingTo === "/digest"}
                className={`block w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 ${
                  navigatingTo === "/digest" ? "animate-pulse" : ""
                }`}
              >
                {navigatingTo === "/digest" ? "Loading..." : "Generate Digest"}
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleNavigation("/libraries");
                }}
                disabled={navigatingTo === "/libraries"}
                className={`block w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 ${
                  navigatingTo === "/libraries" ? "animate-pulse" : ""
                }`}
              >
                {navigatingTo === "/libraries" ? "Loading..." : "Libraries"}
              </button>
              {config.adminUIEnabled && (
                <a
                  href="/admin"
                  className="block w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Settings
                </a>
              )}
              <Link
                href="/api/auth/logout"
                className="block w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Sign out
              </Link>
            </nav>
          </div>
        )}
      </header>

      {/* Desktop Main Tabs */}
      <div className="hidden md:block border-b border-surface-border bg-surface sticky top-[73px] z-10 w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex overflow-x-auto gap-6" role="tablist">
            <button
              onClick={() => setActiveTab("resources")}
              className={`px-1 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === "resources"
                  ? "border-black text-black"
                  : "border-transparent text-muted hover:text-black"
              }`}
              role="tab"
              aria-selected={activeTab === "resources"}
            >
              Resources
            </button>
            <button
              onClick={() => setActiveTab("search")}
              className={`px-1 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === "search"
                  ? "border-black text-black"
                  : "border-transparent text-muted hover:text-black"
              }`}
              role="tab"
              aria-selected={activeTab === "search"}
            >
              Search
            </button>
            <button
              onClick={() => setActiveTab("ask")}
              className={`px-1 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === "ask"
                  ? "border-black text-black"
                  : "border-transparent text-muted hover:text-black"
              }`}
              role="tab"
              aria-selected={activeTab === "ask"}
            >
              Ask
            </button>
            <button
              onClick={() => handleNavigation("/digest")}
              disabled={navigatingTo === "/digest"}
              className={`px-1 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors border-transparent text-muted hover:text-black disabled:opacity-50 ${
                navigatingTo === "/digest" ? "animate-pulse" : ""
              }`}
            >
              {navigatingTo === "/digest" ? "Loading..." : "Generate Digest"}
            </button>
            <button
              onClick={() => handleNavigation("/libraries")}
              disabled={navigatingTo === "/libraries"}
              className={`px-1 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors border-transparent text-muted hover:text-black disabled:opacity-50 ${
                navigatingTo === "/libraries" ? "animate-pulse" : ""
              }`}
            >
              {navigatingTo === "/libraries" ? "Loading..." : "Libraries"}
            </button>
          </nav>
        </div>
      </div>

      {/* Category and Period Filters (only show for resources tab) */}
      {activeTab === "resources" && (
        <>
          {/* Desktop Category Tabs */}
          <div className="hidden md:block border-b border-surface-border bg-surface sticky top-[121px] z-10 w-full">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <nav className="flex overflow-x-auto gap-2" role="tablist">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryChange(cat.id)}
                    className={`px-4 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                      activeCategory === cat.id
                        ? "border-black text-black"
                        : "border-transparent text-muted hover:text-black"
                    }`}
                    role="tab"
                    aria-selected={activeCategory === cat.id}
                  >
                    {cat.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Desktop Time Period Filter Row */}
          <div className="hidden md:block bg-surface sticky top-[169px] z-10 py-4 w-full">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex flex-wrap items-center gap-2">
                {periods.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPeriod(p.id as Period)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors border ${
                      period === p.id
                        ? "bg-black text-white border-black"
                        : "bg-white border-gray-300 text-black hover:bg-gray-50"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                <button className="px-4 py-2 rounded-md text-sm font-medium transition-colors border bg-white border-gray-300 text-black hover:bg-gray-50">
                  Custom Range
                </button>

                {/* Research date filter: indexed (when synced) vs published (paper date) */}
                {activeCategory === "research" && (
                  <div className="flex items-center gap-1 ml-2 pl-2 border-l border-gray-200">
                    <span className="text-xs text-muted mr-1">Date by:</span>
                    {[
                      { id: "indexed" as const, label: "Indexed" },
                      { id: "published" as const, label: "Published" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setResearchDateFilter(opt.id)}
                        className={`px-3 py-1.5 rounded text-sm transition-colors ${
                          researchDateFilter === opt.id
                            ? "bg-gray-800 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                        title={
                          opt.id === "indexed"
                            ? "When synced from ADS"
                            : "Paper publication date"
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Product Filter */}
                <div className="ml-auto">
                  <ProductFilter
                    value={productFilter}
                    onChange={setProductFilter}
                    availableProducts={availableProducts}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Mobile Filters */}
          <div className="md:hidden bg-surface border-b border-surface-border sticky top-[57px] z-20 w-full">
            <div className="px-4 py-3 flex gap-2">
              {/* Category Dropdown */}
              <div className="relative flex-1">
                <button
                  onClick={() => {
                    setMobileCategoryOpen(!mobileCategoryOpen);
                    setMobilePeriodOpen(false);
                    setMobileProductFilterOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium"
                >
                  <span className="truncate">
                    {getCategoryLabel(activeCategory)}
                  </span>
                  <svg
                    className={`w-4 h-4 ml-2 transition-transform ${mobileCategoryOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {mobileCategoryOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-30">
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => {
                          handleCategoryChange(cat.id);
                          setMobileCategoryOpen(false);
                        }}
                        className={`block w-full text-left px-3 py-2 text-sm ${
                          activeCategory === cat.id
                            ? "bg-gray-100 font-medium"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Period Dropdown */}
              <div className="relative flex-1">
                <button
                  onClick={() => {
                    setMobilePeriodOpen(!mobilePeriodOpen);
                    setMobileCategoryOpen(false);
                    setMobileProductFilterOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium"
                >
                  <span className="truncate">{getPeriodLabel(period)}</span>
                  <svg
                    className={`w-4 h-4 ml-2 transition-transform ${mobilePeriodOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {mobilePeriodOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-30">
                    {periods.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setPeriod(p.id as Period);
                          setMobilePeriodOpen(false);
                        }}
                        className={`block w-full text-left px-3 py-2 text-sm ${
                          period === p.id
                            ? "bg-gray-100 font-medium"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                    <button
                      onClick={() => setMobilePeriodOpen(false)}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      Custom Range
                    </button>
                  </div>
                )}
              </div>

              {/* Research date filter (mobile) */}
              {activeCategory === "research" && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted">Date:</span>
                  {(["indexed", "published"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setResearchDateFilter(opt)}
                      className={`px-2 py-1 rounded text-xs ${
                        researchDateFilter === opt
                          ? "bg-gray-800 text-white"
                          : "bg-gray-100"
                      }`}
                    >
                      {opt === "indexed" ? "Indexed" : "Published"}
                    </button>
                  ))}
                </div>
              )}

              {/* Mobile Product Filter */}
              <div className="relative flex-1">
                <MobileProductFilter
                  value={productFilter}
                  onChange={setProductFilter}
                  availableProducts={availableProducts}
                  isOpen={mobileProductFilterOpen}
                  onToggle={() => {
                    setMobileProductFilterOpen(!mobileProductFilterOpen);
                    setMobileCategoryOpen(false);
                    setMobilePeriodOpen(false);
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Click outside to close dropdowns */}
      {(mobileCategoryOpen || mobilePeriodOpen || mobileProductFilterOpen) && (
        <div
          className="fixed inset-0 z-[15] md:hidden"
          onClick={() => {
            setMobileCategoryOpen(false);
            setMobilePeriodOpen(false);
            setMobileProductFilterOpen(false);
          }}
        />
      )}

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {activeTab === "resources" && (
          <Suspense fallback={<Loading />}>
            <ItemsGrid
              category={activeCategory}
              period={period}
              productFilter={productFilter}
              researchDateFilter={
                activeCategory === "research" ? researchDateFilter : undefined
              }
              onAvailableProductsChange={setAvailableProducts}
              onProductClick={handleProductClick}
            />
          </Suspense>
        )}
        {activeTab === "search" && <SearchPage />}
        {activeTab === "ask" && <QAPage />}
        {activeTab === "starred" && (
          <Suspense fallback={<Loading />}>
            <StarredItems />
          </Suspense>
        )}
      </main>
    </div>
  );
}
