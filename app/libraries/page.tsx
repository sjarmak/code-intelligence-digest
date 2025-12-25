'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { LibrariesView } from '@/src/components/libraries/libraries-view';
import { PapersQA } from '@/src/components/libraries/papers-qa';

export const dynamic = 'force-dynamic';

export default function LibrariesPage() {
   const papersQARef = useRef<{
     addPaper: (paper: { bibcode: string; title?: string }) => void;
     setSelectedLibrary: (library: { id: string; name: string; numPapers: number }) => void;
   } | null>(null);

   const handleAddPaperToQA = (paper: { bibcode: string; title?: string }) => {
     papersQARef.current?.addPaper(paper);
   };

   const handleSelectLibrary = (library: { id: string; name: string; numPapers: number }) => {
     papersQARef.current?.setSelectedLibrary(library);
   };

   return (
     <div className="min-h-screen bg-white text-black">
       {/* Header */}
       <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
         <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="space-y-4">
            {/* Back Button */}
            <div>
              <Link
                href="/"
                className="inline-block px-4 py-2 rounded-md text-sm font-medium transition-colors bg-surface border border-surface-border text-muted hover:text-foreground"
              >
                ← Back to Home
              </Link>
            </div>
            <div>
              <h1 className="text-3xl font-bold">Research Libraries</h1>
              <p className="text-muted mt-2">
                Curated research papers from ADS/SciX libraries with AI-powered analysis
              </p>
            </div>
          </div>
         </div>
       </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Q&A Panel */}
        <PapersQA ref={papersQARef} />

        {/* Libraries */}
        <div>
          <h2 className="text-2xl font-bold mb-4">Libraries</h2>
          <LibrariesView onAddPaperToQA={handleAddPaperToQA} onSelectLibraryForQA={handleSelectLibrary} />
        </div>
      </main>
    </div>
  );
}
