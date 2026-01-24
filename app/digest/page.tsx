'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { DigestItemsView } from '@/src/components/digest/digest-items-view';
import { SynthesisPage } from '@/src/components/synthesis/synthesis-page';

type DigestType = 'newsletter' | 'podcast' | null;

export default function DigestPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeType, setActiveType] = useState<DigestType>(null);

  const handleBack = () => {
    startTransition(() => {
      router.push('/');
    });
  };

  if (activeType) {
    return (
      <div>
        <button
          onClick={() => setActiveType(null)}
          className="mb-4 flex items-center gap-2 text-sm text-muted hover:text-black transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Digest Library
        </button>
        <SynthesisPage type={activeType} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Header */}
      <header className="border-b border-surface-border fixed top-0 left-0 right-0 z-20 bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
            {/* Title with back button */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={handleBack}
                  disabled={isPending}
                  className="p-1 rounded-md transition-colors hover:bg-gray-100 text-gray-600 hover:text-black disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Back to home"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-2xl sm:text-3xl font-bold">Generate Digest</h1>
              </div>
              <p className="text-muted mt-2 text-sm sm:text-base ml-9">
                Create newsletters or podcasts from your curated content
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setActiveType('newsletter')}
                className="px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors bg-white border border-gray-400 text-black hover:bg-gray-50 whitespace-nowrap"
                title="Generate newsletters"
              >
                Generate Newsletter
              </button>
              <button
                onClick={() => setActiveType('podcast')}
                className="px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors bg-white border border-gray-400 text-black hover:bg-gray-50 whitespace-nowrap"
                title="Generate podcast episodes"
              >
                Generate Podcast
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Spacer for fixed header */}
      <div className="h-[140px] sm:h-28" aria-hidden="true"></div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <DigestItemsView />
      </main>
    </div>
  );
}
