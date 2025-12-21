'use client';

import { useRef } from 'react';
import { LibrariesView } from '@/src/components/libraries/libraries-view';
import { PapersQA } from '@/src/components/libraries/papers-qa';

export const dynamic = 'force-dynamic';

export default function ResearchPage() {
  const papersQARef = useRef<{
    addPaper: (paper: { bibcode: string; title?: string }) => void;
    setSelectedLibrary: (library: { id: string; name: string; numPapers: number } | null) => void;
  } | null>(null);

  const handleAddPaperToQA = (paper: { bibcode: string; title?: string }) => {
    papersQARef.current?.addPaper(paper);
  };

  const handleSelectLibrary = (library: { id: string; name: string; numPapers: number }) => {
    papersQARef.current?.setSelectedLibrary(library);
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div>
            <h1 className="text-3xl font-bold">Research Libraries</h1>
            <p className="text-muted mt-2">
              Curated research papers from your ADS libraries with AI-powered analysis
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Q&A Panel */}
        <PapersQA ref={papersQARef} />

        {/* Libraries */}
        <div>
          <h2 className="text-2xl font-bold mb-4">My Libraries</h2>
          <LibrariesView onAddPaperToQA={handleAddPaperToQA} onSelectLibraryForQA={handleSelectLibrary} />
        </div>
      </main>
    </div>
  );
}
